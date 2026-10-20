import { z } from "zod";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { sha256 } from "../lib/util.js";
import { parse } from "../lib/validate.js";
import { signFileLink, sniffMime, storage, verifyFileLink } from "../providers/storage.js";
import { notify } from "./notifications.js";

const MAX_BYTES = 5 * 1024 * 1024;
const PURPOSES = ["identity_document", "driving_license", "vehicle_rc", "vehicle_insurance", "profile_photo"];

// ---- Files -----------------------------------------------------------------
export const uploadFile = async (user, purpose, declaredType, buffer) => {
  if (!PURPOSES.includes(purpose)) throw badRequest("Unknown document type.");
  enforce(`upload:${user.id}`, 20, 60 * 60 * 1000, "Too many uploads. Try again later.");
  if (!buffer?.length) throw badRequest("The file is empty.");
  if (buffer.length > MAX_BYTES) throw badRequest("Files must be 5 MB or smaller.");
  const sniffed = sniffMime(buffer);
  if (!sniffed) throw badRequest("Upload a JPEG, PNG or PDF file.");
  if (declaredType && declaredType !== sniffed) throw badRequest("The file's contents do not match its type.");
  if (purpose === "profile_photo" && sniffed === "application/pdf") throw badRequest("Profile photos must be JPEG or PNG.");
  const key = await storage.put(buffer);
  const file = await db.one(
    `INSERT INTO files (owner_id, purpose, mime_type, size_bytes, sha256, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, purpose, mime_type, size_bytes, created_at`,
    [user.id, purpose, sniffed, buffer.length, sha256(buffer), key]
  );
  return file;
};

const canViewFile = (user, file) => file.owner_id === user.id || user.permissions.includes("admin.verifications.review");

export const fileLink = async (user, fileId) => {
  const file = await db.one("SELECT id, owner_id FROM files WHERE id = $1 AND deleted_at IS NULL", [fileId]);
  if (!file || !canViewFile(user, file)) throw notFound("File");
  if (file.owner_id !== user.id) {
    await audit({ actor: user, action: "file.view", entityType: "file", entityId: fileId });
  }
  return { url: signFileLink(fileId, user.id), expiresInSeconds: 300 };
};

export const readFile = async (user, fileId, exp, sig) => {
  if (!verifyFileLink(fileId, user.id, exp, sig)) throw forbidden("This link has expired. Open the document again.");
  const file = await db.one("SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL", [fileId]);
  if (!file || !canViewFile(user, file)) throw notFound("File");
  return { file, data: await storage.read(file.storage_key) };
};

const ownedFile = async (userId, fileId, purposes) => {
  if (!fileId) return null;
  const f = await db.one("SELECT id, purpose FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [fileId, userId]);
  if (!f || !purposes.includes(f.purpose)) throw badRequest("Upload the document first, then submit it.");
  return f.id;
};

// ---- Identity and licence ------------------------------------------------------
const identitySchema = z.object({
  kind: z.enum(["government_id", "driving_license"]),
  documentType: z.enum(["aadhaar", "pan", "passport", "voter_id", "driving_license"]),
  documentLast4: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/, "Enter the last 4 characters of the document number."),
  fileId: z.string().uuid(),
  expiresAt: z.string().date().optional(),
});

export const submitIdentity = async (user, body) => {
  const input = parse(identitySchema, body);
  if (input.kind === "driving_license" && input.documentType !== "driving_license") throw badRequest("Choose driving licence as the document type.");
  if (input.kind === "government_id" && input.documentType === "driving_license") throw badRequest("Choose Aadhaar, PAN, passport or voter ID.");
  const fileId = await ownedFile(user.id, input.fileId, input.kind === "driving_license" ? ["driving_license"] : ["identity_document"]);
  return db.tx(async (t) => {
    const pending = await t.one(
      "SELECT id FROM identity_verifications WHERE user_id = $1 AND kind = $2 AND status = 'pending_review'",
      [user.id, input.kind]
    );
    if (pending) throw conflict("already_pending", "This document is already waiting for review.");
    const row = await t.one(
      `INSERT INTO identity_verifications (user_id, kind, document_type, document_last4, document_file_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status, submitted_at`,
      [user.id, input.kind, input.documentType, input.documentLast4, fileId, input.expiresAt || null]
    );
    if (input.kind === "driving_license") {
      await t.query(
        `INSERT INTO driver_profiles (user_id, license_last4, license_expiry) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET license_last4 = $2, license_expiry = $3, updated_at = now()`,
        [user.id, input.documentLast4, input.expiresAt || null]
      );
    }
    await audit({ actor: user, action: "verification.submit", entityType: "identity_verification", entityId: row.id, details: { kind: input.kind }, client: t });
    return row;
  });
};

// ---- Vehicles ---------------------------------------------------------------
const vehicleVerificationSchema = z.object({
  rcFileId: z.string().uuid(),
  insuranceFileId: z.string().uuid(),
  insuranceExpiry: z.string().date(),
});

export const submitVehicleVerification = async (user, vehicleId, body) => {
  const input = parse(vehicleVerificationSchema, body);
  const vehicle = await db.one("SELECT id FROM vehicles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [vehicleId, user.id]);
  if (!vehicle) throw notFound("Vehicle");
  if (new Date(input.insuranceExpiry) < new Date()) throw badRequest("The insurance has expired. Upload a current policy.");
  const rc = await ownedFile(user.id, input.rcFileId, ["vehicle_rc"]);
  const ins = await ownedFile(user.id, input.insuranceFileId, ["vehicle_insurance"]);
  return db.tx(async (t) => {
    const pending = await t.one("SELECT id FROM vehicle_verifications WHERE vehicle_id = $1 AND status = 'pending_review'", [vehicleId]);
    if (pending) throw conflict("already_pending", "This vehicle is already waiting for review.");
    const row = await t.one(
      `INSERT INTO vehicle_verifications (vehicle_id, rc_file_id, insurance_file_id, insurance_expiry)
       VALUES ($1, $2, $3, $4) RETURNING id, status, submitted_at`,
      [vehicleId, rc, ins, input.insuranceExpiry]
    );
    await audit({ actor: user, action: "vehicle_verification.submit", entityType: "vehicle_verification", entityId: row.id, client: t });
    return row;
  });
};

export const vehicleVerificationStatus = async (vehicleId, client = db) => {
  const r = await client.one(
    `SELECT id, status, insurance_expiry, reviewer_notes, submitted_at, reviewed_at FROM vehicle_verifications
      WHERE vehicle_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
    [vehicleId]
  );
  if (!r) return { status: "not_submitted" };
  const expired = r.status === "verified" && r.insurance_expiry && new Date(r.insurance_expiry) < new Date();
  return {
    id: r.id,
    status: expired ? "expired" : r.status,
    insuranceExpiry: r.insurance_expiry,
    reviewerNotes: r.status === "verified" ? null : r.reviewer_notes,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
  };
};

// ---- Admin review -----------------------------------------------------------------
const decisionSchema = z.object({
  decision: z.enum(["verified", "rejected", "needs_info"]),
  notes: z.string().trim().max(500).optional(),
  expiresAt: z.string().date().optional(),
});

export const listQueue = async ({ type, status = "pending_review", limit, offset }) => {
  if (type === "vehicle") {
    return db.many(
      `SELECT vv.id, vv.status, vv.submitted_at, vv.reviewed_at, vv.insurance_expiry, vv.rc_file_id, vv.insurance_file_id, vv.reviewer_notes,
              v.id AS vehicle_id, v.make, v.model, v.color, v.plate_number, v.seats, v.owner_id,
              coalesce(p.full_name, 'No name yet') AS owner_name
         FROM vehicle_verifications vv JOIN vehicles v ON v.id = vv.vehicle_id LEFT JOIN user_profiles p ON p.user_id = v.owner_id
        WHERE vv.status = $1 ORDER BY vv.submitted_at LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
  }
  return db.many(
    `SELECT iv.id, iv.kind, iv.document_type, iv.document_last4, iv.status, iv.submitted_at, iv.reviewed_at, iv.expires_at,
            iv.document_file_id, iv.reviewer_notes, iv.user_id, coalesce(p.full_name, 'No name yet') AS user_name
       FROM identity_verifications iv LEFT JOIN user_profiles p ON p.user_id = iv.user_id
      WHERE iv.status = $1 ORDER BY iv.submitted_at LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );
};

export const decide = async (admin, type, id, body) => {
  const input = parse(decisionSchema, body);
  if (input.decision !== "verified" && !input.notes) throw badRequest("Tell the person what to fix or why it was rejected.");
  const table = type === "vehicle" ? "vehicle_verifications" : "identity_verifications";
  const result = await db.tx(async (t) => {
    const row = await t.one(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!row) throw notFound("Submission");
    if (row.status !== "pending_review") throw conflict("already_decided", "This submission has already been reviewed.");
    const ownerId = type === "vehicle"
      ? (await t.one("SELECT owner_id FROM vehicles WHERE id = $1", [row.vehicle_id])).owner_id
      : row.user_id;
    if (ownerId === admin.id) throw forbidden("You cannot review your own documents.");
    const extra = type === "vehicle" ? "" : ", expires_at = COALESCE($5::timestamptz, expires_at)";
    const params = [id, input.decision, admin.id, input.notes || null];
    if (type !== "vehicle") params.push(input.expiresAt || null);
    await t.query(
      `UPDATE ${table} SET status = $2, reviewer_id = $3, reviewer_notes = $4, reviewed_at = now()${extra} WHERE id = $1`,
      params
    );
    if (type !== "vehicle" && row.kind === "driving_license" && input.decision === "verified") {
      await t.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'driver', $2) ON CONFLICT DO NOTHING", [ownerId, admin.id]);
    }
    await audit({ actor: admin, action: `verification.${input.decision}`, entityType: table, entityId: id, details: { notes: input.notes }, client: t });
    return { ownerId, kind: type === "vehicle" ? "vehicle" : row.kind };
  });
  const label = { government_id: "ID", driving_license: "driving licence", vehicle: "vehicle documents" }[result.kind];
  const message = {
    verified: `Your ${label} has been verified.`,
    rejected: `Your ${label} was not accepted: ${input.notes}`,
    needs_info: `We need more information about your ${label}: ${input.notes}`,
  }[input.decision];
  await notify([result.ownerId], { type: "verification.result", title: "Verification update", body: message, data: { type, id, decision: input.decision } });
  return { id, status: input.decision };
};
