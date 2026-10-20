import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { anon, base, client, createUser, db, resetLimits, useTestServer } from "./helpers.js";

useTestServer();

const signIn = async (phone) => {
  const api = anon();
  const r = await api.post("/auth/otp/request", { channel: "sms", phone });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await fetch(`${base}/api/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ challengeId: r.body.challengeId, code: r.body.devCode }),
  });
  return { status: v.status, body: await v.json(), cookie: (v.headers.get("set-cookie") || "").split(";")[0] };
};

describe("phone OTP sign-in", () => {
  beforeEach(() => resetLimits());

  it("registers a new number, sets an HttpOnly session cookie and returns the profile", async () => {
    const res = await signIn("98450 12345");
    assert.equal(res.status, 200);
    assert.equal(res.body.isNew, true);
    assert.match(res.cookie, /^gw_session=/);
    const me = await client(res.cookie).get("/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.phone, "+919845012345");
    assert.deepEqual(me.body.roles, ["passenger"]);
    assert.equal(me.body.verification.government_id.status, "not_submitted");
  });

  it("signs an existing number back in to the same account", async () => {
    const first = await signIn("9845099999");
    resetLimits();
    await db.query("UPDATE otp_challenges SET created_at = now() - interval '1 minute'");
    const second = await signIn("+91 98450 99999");
    assert.equal(second.body.isNew, false);
    const a = await client(first.cookie).get("/auth/me");
    const b = await client(second.cookie).get("/auth/me");
    assert.equal(a.body.id, b.body.id);
  });

  it("rejects numbers that are not Indian mobile numbers", async () => {
    for (const phone of ["12345", "5845012345", "+14155550100"]) {
      const r = await anon().post("/auth/otp/request", { channel: "sms", phone });
      assert.equal(r.status, 400, phone);
    }
  });

  it("counts wrong codes and locks the challenge after five", async () => {
    const r = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500001" });
    for (let i = 0; i < 5; i++) {
      const wrong = r.body.devCode === "000000" ? "111111" : "000000";
      const v = await anon().post("/auth/otp/verify", { challengeId: r.body.challengeId, code: wrong });
      assert.equal(v.status, 400);
    }
    const right = await anon().post("/auth/otp/verify", { challengeId: r.body.challengeId, code: r.body.devCode });
    assert.equal(right.status, 400, "a correct code after the lockout must still fail");
    assert.match(right.body.error.message, /Too many wrong attempts/);
  });

  it("refuses an expired code and a code used twice", async () => {
    const r = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500002" });
    await db.query("UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1", [r.body.challengeId]);
    const v = await anon().post("/auth/otp/verify", { challengeId: r.body.challengeId, code: r.body.devCode });
    assert.equal(v.status, 400);
    assert.match(v.body.error.message, /expired/);

    resetLimits();
    await db.query("UPDATE otp_challenges SET created_at = now() - interval '1 minute'");
    const r2 = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500002" });
    assert.equal((await anon().post("/auth/otp/verify", { challengeId: r2.body.challengeId, code: r2.body.devCode })).status, 200);
    assert.equal((await anon().post("/auth/otp/verify", { challengeId: r2.body.challengeId, code: r2.body.devCode })).status, 400);
  });

  it("enforces a resend gap and an hourly limit per number", async () => {
    const first = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500003" });
    assert.equal(first.status, 200);
    const tooSoon = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500003" });
    assert.equal(tooSoon.status, 400);
    let last;
    for (let i = 0; i < 6; i++) {
      await db.query("UPDATE otp_challenges SET created_at = now() - interval '1 minute'");
      last = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500003" });
    }
    assert.equal(last.status, 429);
  });

  it("logs out by revoking the session", async () => {
    const u = await createUser();
    assert.equal((await u.api.get("/auth/me")).status, 200);
    assert.equal((await u.api.post("/auth/logout")).status, 204);
    assert.equal((await u.api.get("/auth/me")).status, 401);
  });

  it("blocks suspended accounts from signing in or using old sessions", async () => {
    const u = await createUser({ phone: "+919876500004" });
    await db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [u.id]);
    assert.equal((await u.api.get("/auth/me")).status, 401);
    const r = await anon().post("/auth/otp/request", { channel: "sms", phone: "9876500004" });
    const v = await anon().post("/auth/otp/verify", { challengeId: r.body.challengeId, code: r.body.devCode });
    assert.equal(v.status, 403);
  });

  it("rejects state-changing requests from untrusted origins (CSRF)", async () => {
    const u = await createUser();
    const res = await fetch(`${base}/api/v1/auth/logout`, { method: "POST", headers: { Cookie: u.cookie, Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    assert.equal((await u.api.get("/auth/me")).status, 200, "session must survive the forged request");
  });
});
