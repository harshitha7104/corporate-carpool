import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { base, createUser, db, pngBytes, resetLimits, useTestServer } from "./helpers.js";

useTestServer();
beforeEach(() => resetLimits());

const upload = (u, purpose, bytes = pngBytes, type = "image/png") =>
  u.api.post(`/files?purpose=${purpose}`, bytes, { "Content-Type": type });

describe("document uploads", () => {
  it("accepts JPEG/PNG/PDF by content, not by the declared type", async () => {
    const u = await createUser();
    const ok = await upload(u, "identity_document");
    assert.equal(ok.status, 201);
    assert.equal(ok.body.mime_type, "image/png");
    const exe = await upload(u, "identity_document", Buffer.from("MZ\x90\x00 pretend executable"), "image/png");
    assert.equal(exe.status, 400);
    const mismatch = await upload(u, "identity_document", pngBytes, "application/pdf");
    assert.equal(mismatch.status, 400);
    const pdf = await upload(u, "vehicle_rc", Buffer.from("%PDF-1.7\n%test\n"), "application/pdf");
    assert.equal(pdf.status, 201);
  });

  it("serves documents only through short-lived links bound to the viewer", async () => {
    const owner = await createUser();
    const other = await createUser();
    const admin = await createUser({ roles: ["admin"] });
    const f = (await upload(owner, "identity_document")).body;
    assert.equal((await other.api.get(`/files/${f.id}/link`)).status, 404, "other members cannot see it");
    const link = (await owner.api.get(`/files/${f.id}/link`)).body;
    const res = await fetch(`${base}${link.url}`, { headers: { Cookie: owner.cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const stolen = await fetch(`${base}${link.url}`, { headers: { Cookie: other.cookie } });
    assert.notEqual(stolen.status, 200, "a link copied to someone else does not work");
    const expired = link.url.replace(/exp=\d+/, "exp=1000");
    assert.equal((await fetch(`${base}${expired}`, { headers: { Cookie: owner.cookie } })).status, 403);
    const adminLink = await admin.api.get(`/files/${f.id}/link`);
    assert.equal(adminLink.status, 200);
    const viewed = await db.one("SELECT action FROM audit_logs WHERE action = 'file.view' AND entity_id = $1", [f.id]);
    assert.ok(viewed, "admin access to a document is audited");
  });
});

describe("verification pipeline", () => {
  it("moves through not submitted, pending, needs info, verified and expired", async () => {
    const u = await createUser({ name: "Kiran Shetty" });
    const admin = await createUser({ roles: ["admin"] });
    const me = async () => (await u.api.get("/auth/me")).body.verification.driving_license.status;
    assert.equal(await me(), "not_submitted");

    const file = (await upload(u, "driving_license")).body;
    const sub = await u.api.post("/users/me/verification", { kind: "driving_license", documentType: "driving_license", documentLast4: "ab12", fileId: file.id, expiresAt: "2035-01-31" });
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    assert.equal(await me(), "pending_review");
    assert.equal((await u.api.post("/users/me/verification", { kind: "driving_license", documentType: "driving_license", documentLast4: "AB12", fileId: file.id })).status, 409, "one pending submission at a time");

    const queue = await admin.api.get("/admin/verifications?type=identity");
    const item = queue.body.items.find((i) => i.user_id === u.id);
    assert.ok(item);
    assert.equal((await admin.api.post(`/admin/verifications/identity/${item.id}/decision`, { decision: "needs_info" })).status, 400, "a reason is required");
    await admin.api.post(`/admin/verifications/identity/${item.id}/decision`, { decision: "needs_info", notes: "The photo is blurry." });
    const status = (await u.api.get("/auth/me")).body.verification.driving_license;
    assert.equal(status.status, "needs_info");
    assert.equal(status.reviewerNotes, "The photo is blurry.");
    assert.equal((await admin.api.post(`/admin/verifications/identity/${item.id}/decision`, { decision: "verified" })).status, 409, "decided submissions are final");

    const file2 = (await upload(u, "driving_license")).body;
    const again = await u.api.post("/users/me/verification", { kind: "driving_license", documentType: "driving_license", documentLast4: "AB12", fileId: file2.id, expiresAt: "2035-01-31" });
    await admin.api.post(`/admin/verifications/identity/${again.body.id}/decision`, { decision: "verified" });
    assert.equal(await me(), "verified");
    const roles = await db.many("SELECT role FROM user_roles WHERE user_id = $1", [u.id]);
    assert.ok(roles.some((r) => r.role === "driver"), "a verified licence grants the driver role");

    await db.query("UPDATE identity_verifications SET expires_at = now() - interval '1 day' WHERE id = $1", [again.body.id]);
    assert.equal(await me(), "expired");
    const notes = await db.many("SELECT type FROM notifications WHERE user_id = $1", [u.id]);
    assert.equal(notes.filter((n) => n.type === "verification.result").length, 2);
  });

  it("does not let an admin review their own documents or a member use someone else's file", async () => {
    const admin = await createUser({ roles: ["admin"] });
    const f = (await upload(admin, "identity_document")).body;
    const s = await admin.api.post("/users/me/verification", { kind: "government_id", documentType: "pan", documentLast4: "123F", fileId: f.id });
    assert.equal((await admin.api.post(`/admin/verifications/identity/${s.body.id}/decision`, { decision: "verified" })).status, 403);
    const thief = await createUser();
    assert.equal((await thief.api.post("/users/me/verification", { kind: "government_id", documentType: "pan", documentLast4: "123F", fileId: f.id })).status, 400);
  });

  it("invalidates a vehicle's verification when its registration changes", async () => {
    const u = await createUser();
    const admin = await createUser({ roles: ["admin"] });
    const v = (await u.api.post("/vehicles", { make: "Tata", model: "Punch", color: "Green", plateNumber: "KA03AB9876", seats: 4 })).body;
    const rc = (await upload(u, "vehicle_rc")).body;
    const ins = (await upload(u, "vehicle_insurance")).body;
    const sub = await u.api.post(`/vehicles/${v.id}/verification`, { rcFileId: rc.id, insuranceFileId: ins.id, insuranceExpiry: "2030-12-31" });
    assert.equal(sub.status, 201);
    await admin.api.post(`/admin/verifications/vehicle/${sub.body.id}/decision`, { decision: "verified" });
    assert.equal((await u.api.get("/vehicles")).body.items[0].verification.status, "verified");
    await u.api.patch(`/vehicles/${v.id}`, { plateNumber: "KA03AB9999" });
    assert.equal((await u.api.get("/vehicles")).body.items[0].verification.status, "expired");
  });
});

describe("object-level access (IDOR)", () => {
  it("keeps each member's private records private", async () => {
    const a = await createUser();
    const b = await createUser();
    const v = (await a.api.post("/vehicles", { make: "Kia", model: "Sonet", color: "Black", plateNumber: "KA04ZZ1111", seats: 4 })).body;
    assert.equal((await b.api.patch(`/vehicles/${v.id}`, { color: "Pink" })).status, 404);
    assert.equal((await b.api.del(`/vehicles/${v.id}`)).status, 404);
    const place = (await a.api.post("/users/me/places", { label: "Home", address: "HSR Layout", lat: 12.91, lng: 77.64 })).body;
    assert.equal((await b.api.del(`/users/me/places/${place.id}`)).status, 404);
    const contact = (await a.api.post("/users/me/trusted-contacts", { name: "Amma", phone: "9845011111" })).body;
    assert.equal((await b.api.del(`/users/me/trusted-contacts/${contact.id}`)).status, 404);
    const profile = (await b.api.get(`/users/${a.id}/profile`)).body;
    assert.equal(profile.phone, undefined);
    assert.equal(profile.email, undefined);
    assert.equal(profile.gender, undefined);
  });
});
