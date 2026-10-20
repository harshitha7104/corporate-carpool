import { z } from "zod";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { maskEmail, maskPhone, normalisePhone } from "../lib/util.js";
import { parse, point } from "../lib/validate.js";
import { logoutEverywhere } from "./auth.js";

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(80),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).nullable().optional(),
  bio: z.string().trim().max(300).nullable().optional(),
  homeArea: z.string().trim().max(80).nullable().optional(),
  workArea: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(120).nullable().optional(),
});

const VERIFICATION_KINDS = ["government_id", "driving_license"];

// Latest submission per kind, with "expired" applied on read.
export const verificationSummary = async (userId, client = db) => {
  const rows = await client.many(
    `SELECT DISTINCT ON (kind) id, kind, document_type, document_last4, status, reviewer_notes, submitted_at, reviewed_at, expires_at
       FROM identity_verifications WHERE user_id = $1 ORDER BY kind, submitted_at DESC`,
    [userId]
  );
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
  return Object.fromEntries(
    VERIFICATION_KINDS.map((kind) => {
      const r = byKind[kind];
      if (!r) return [kind, { status: "not_submitted" }];
      const expired = r.status === "verified" && r.expires_at && new Date(r.expires_at) < new Date();
      return [kind, {
        id: r.id,
        status: expired ? "expired" : r.status,
        documentType: r.document_type,
        documentLast4: r.document_last4,
        reviewerNotes: r.status === "verified" ? null : r.reviewer_notes,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        expiresAt: r.expires_at,
      }];
    })
  );
};

export const isVerifiedDriver = async (userId, client = db) => {
  const v = await verificationSummary(userId, client);
  return v.government_id.status === "verified" && v.driving_license.status === "verified";
};

export const getMe = async (user) => {
  const row = await db.one(
    `SELECT u.id, u.phone, u.email, u.phone_verified_at, u.email_verified_at, u.status, u.is_demo, u.created_at,
            p.full_name, p.gender, p.bio, p.home_area, p.work_area,
            pr.notify_email, pr.notify_sms, pr.notify_whatsapp,
            d.user_id IS NOT NULL AS has_driver_profile, d.license_last4, d.license_expiry, d.years_driving
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_preferences pr ON pr.user_id = u.id
       LEFT JOIN driver_profiles d ON d.user_id = u.id
      WHERE u.id = $1`,
    [user.id]
  );
  const rating = await db.one(
    "SELECT round(avg(rating)::numeric, 2)::float AS average, count(*) AS count FROM reviews WHERE reviewee_id = $1",
    [user.id]
  );
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    phoneVerified: Boolean(row.phone_verified_at),
    emailVerified: Boolean(row.email_verified_at),
    status: row.status,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    profileComplete: Boolean(row.full_name),
    profile: row.full_name ? { fullName: row.full_name, gender: row.gender, bio: row.bio, homeArea: row.home_area, workArea: row.work_area } : null,
    preferences: { notifyEmail: row.notify_email ?? true, notifySms: row.notify_sms ?? true, notifyWhatsapp: row.notify_whatsapp ?? false },
    driver: row.has_driver_profile ? { licenseLast4: row.license_last4, licenseExpiry: row.license_expiry, yearsDriving: row.years_driving } : null,
    roles: user.roles,
    permissions: user.permissions,
    verification: await verificationSummary(user.id),
    rating: { average: rating.average, count: rating.count },
  };
};

export const updateProfile = async (user, body) => {
  const input = parse(profileSchema, body);
  await db.tx(async (t) => {
    await t.query(
      `INSERT INTO user_profiles (user_id, full_name, gender, bio, home_area, work_area)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET full_name = $2, gender = $3, bio = $4, home_area = $5, work_area = $6, updated_at = now()`,
      [user.id, input.fullName, input.gender ?? null, input.bio ?? null, input.homeArea ?? null, input.workArea ?? null]
    );
    if (input.email !== undefined && input.email !== user.email) {
      if (input.email) {
        const taken = await t.one("SELECT id FROM users WHERE lower(email) = $1 AND id <> $2", [input.email, user.id]);
        if (taken) throw conflict("email_taken", "That email is already used by another account.");
      }
      if (!input.email && !user.phone) throw badRequest("Your account needs a phone number or an email.");
      // A changed email is unverified until the person signs in with it.
      await t.query("UPDATE users SET email = $2, email_verified_at = NULL, updated_at = now() WHERE id = $1", [user.id, input.email]);
    }
  });
  return getMe(user);
};

export const updatePreferences = async (user, body) => {
  const input = parse(z.object({ notifyEmail: z.boolean(), notifySms: z.boolean(), notifyWhatsapp: z.boolean() }), body);
  await db.query(
    `INSERT INTO user_preferences (user_id, notify_email, notify_sms, notify_whatsapp) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET notify_email = $2, notify_sms = $3, notify_whatsapp = $4, updated_at = now()`,
    [user.id, input.notifyEmail, input.notifySms, input.notifyWhatsapp]
  );
  return input;
};

// Public card for another person: no phone, no email, no gender.
export const publicProfile = async (userId, client = db) => {
  const row = await client.one(
    `SELECT u.id, u.status, u.is_demo, u.created_at, p.full_name, p.bio,
            (SELECT round(avg(rating)::numeric, 1)::float FROM reviews WHERE reviewee_id = u.id) AS rating,
            (SELECT count(*) FROM reviews WHERE reviewee_id = u.id) AS review_count,
            (SELECT count(*) FROM rides WHERE driver_id = u.id AND status = 'completed') AS rides_driven,
            (SELECT count(*) FROM bookings WHERE passenger_id = u.id AND status = 'COMPLETED') AS rides_taken
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  if (!row || row.status === "deleted") throw notFound("Person");
  const v = await verificationSummary(userId, client);
  const first = (row.full_name || "Green Way member").split(" ")[0];
  return {
    id: row.id,
    displayName: row.full_name ? `${first} ${row.full_name.split(" ").slice(1).map((s) => `${s[0]}.`).join(" ")}`.trim() : "Green Way member",
    initials: (row.full_name || "G W").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase(),
    bio: row.bio,
    memberSince: row.created_at,
    isDemo: row.is_demo,
    idVerified: v.government_id.status === "verified",
    licenceVerified: v.driving_license.status === "verified",
    rating: row.review_count > 0 ? row.rating : null,
    reviewCount: row.review_count,
    ridesDriven: row.rides_driven,
    ridesTaken: row.rides_taken,
  };
};

// ---- Saved places ----------------------------------------------------------
const savedSchema = point.extend({ address: z.string().trim().min(2).max(200), label: z.string().trim().min(1).max(40) });

export const listSaved = (user) => db.many("SELECT id, label, address, lat, lng FROM saved_locations WHERE user_id = $1 ORDER BY created_at", [user.id]);

export const addSaved = async (user, body) => {
  const input = parse(savedSchema, body);
  const { count } = await db.one("SELECT count(*) FROM saved_locations WHERE user_id = $1", [user.id]);
  if (count >= 20) throw badRequest("You can save up to 20 places.");
  return db.one(
    "INSERT INTO saved_locations (user_id, label, address, lat, lng) VALUES ($1, $2, $3, $4, $5) RETURNING id, label, address, lat, lng",
    [user.id, input.label, input.address, input.lat, input.lng]
  );
};

export const removeSaved = async (user, id) => {
  const r = await db.query("DELETE FROM saved_locations WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (!r.rowCount) throw notFound("Saved place");
};

// ---- Trusted contacts -------------------------------------------------------
const contactSchema = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string(),
  relationship: z.string().trim().max(30).nullable().optional(),
});

export const listContacts = (user) => db.many("SELECT id, name, phone, relationship FROM trusted_contacts WHERE user_id = $1 ORDER BY created_at", [user.id]);

export const addContact = async (user, body) => {
  const input = parse(contactSchema, body);
  const phone = normalisePhone(input.phone);
  if (!phone) throw badRequest("Enter a valid 10-digit Indian mobile number.");
  const { count } = await db.one("SELECT count(*) FROM trusted_contacts WHERE user_id = $1", [user.id]);
  if (count >= 5) throw badRequest("You can add up to 5 trusted contacts.");
  return db.one(
    "INSERT INTO trusted_contacts (user_id, name, phone, relationship) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, relationship",
    [user.id, input.name, phone, input.relationship ?? null]
  );
};

export const removeContact = async (user, id) => {
  const r = await db.query("DELETE FROM trusted_contacts WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (!r.rowCount) throw notFound("Contact");
};

// ---- Blocking and favourites -------------------------------------------------
export const block = async (user, otherId) => {
  if (otherId === user.id) throw badRequest("You cannot block yourself.");
  await db.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, otherId]);
  await db.query("DELETE FROM favourite_drivers WHERE user_id = $1 AND driver_id = $2", [user.id, otherId]);
};
export const unblock = (user, otherId) => db.query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [user.id, otherId]);
export const listBlocked = (user) =>
  db.many(
    `SELECT b.blocked_id AS id, coalesce(p.full_name, 'Green Way member') AS name, b.created_at
       FROM user_blocks b LEFT JOIN user_profiles p ON p.user_id = b.blocked_id WHERE b.blocker_id = $1`,
    [user.id]
  );

export const isBlockedEitherWay = async (a, b, client = db) =>
  Boolean(await client.one("SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)", [a, b]));

export const addFavourite = async (user, driverId) => {
  if (driverId === user.id) throw badRequest("You cannot favourite yourself.");
  const isDriver = await db.one("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'driver'", [driverId]);
  if (!isDriver) throw notFound("Driver");
  await db.query("INSERT INTO favourite_drivers (user_id, driver_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, driverId]);
};
export const removeFavourite = (user, driverId) => db.query("DELETE FROM favourite_drivers WHERE user_id = $1 AND driver_id = $2", [user.id, driverId]);
export const listFavourites = async (user) => {
  const rows = await db.many("SELECT driver_id FROM favourite_drivers WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
  return Promise.all(rows.map((r) => publicProfile(r.driver_id)));
};

// ---- Account lifecycle --------------------------------------------------------
const ACTIVE_BOOKINGS = "('REQUESTED','ACCEPTED','CONFIRMED','IN_PROGRESS')";

export const deactivate = async (user) => {
  await db.query("UPDATE users SET status = 'deactivated', status_reason = 'self', updated_at = now() WHERE id = $1", [user.id]);
  await logoutEverywhere(user.id);
  await audit({ actor: user, action: "account.deactivate", entityType: "user", entityId: user.id });
};

// Deletion keeps rows other people depend on (bookings, payments, reviews)
// but strips personal data. Blocked while trips or payments are open.
export const deleteAccount = async (user) => {
  await db.tx(async (t) => {
    const open = await t.one(
      `SELECT (SELECT count(*) FROM bookings WHERE passenger_id = $1 AND status IN ${ACTIVE_BOOKINGS})
            + (SELECT count(*) FROM rides WHERE driver_id = $1 AND status IN ('published','in_progress')) AS n`,
      [user.id]
    );
    if (open.n > 0) throw conflict("open_trips", "Cancel or finish your upcoming rides and bookings before deleting your account.");
    await t.query("UPDATE users SET status = 'deleted', phone = NULL, email = NULL, deleted_at = now(), updated_at = now() WHERE id = $1", [user.id]);
    await t.query("UPDATE user_profiles SET full_name = 'Deleted member', bio = NULL, gender = NULL, home_area = NULL, work_area = NULL WHERE user_id = $1", [user.id]);
    for (const table of ["saved_locations", "trusted_contacts", "passenger_commutes", "favourite_drivers", "sessions"]) {
      await t.query(`DELETE FROM ${table} WHERE user_id = $1`, [user.id]);
    }
    // Identity documents: mark for removal; the worker deletes the stored files.
    await t.query("UPDATE files SET retention_until = now() WHERE owner_id = $1 AND deleted_at IS NULL", [user.id]);
    await audit({ actor: user, action: "account.delete", entityType: "user", entityId: user.id, client: t });
  });
};

export const contactSummary = (u) => ({ phone: maskPhone(u.phone), email: maskEmail(u.email) });
