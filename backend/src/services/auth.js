import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { otpProvider } from "../providers/messaging.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { otpCode, normalisePhone, randomToken, safeEqual, sha256, hmacHex } from "../lib/util.js";
import { parse } from "../lib/validate.js";
import { permissionsFor, primaryRole } from "../lib/permissions.js";
import { audit } from "../lib/audit.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 30 * 1000;

const requestSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("sms"), phone: z.string() }),
  z.object({ channel: z.literal("email"), email: z.string().trim().toLowerCase().email().max(120) }),
]);

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

const codeHash = (challengeId, code) => hmacHex(config.sessionSecret, `${challengeId}:${code}`);

const destinationOf = (input) => {
  if (input.channel === "sms") {
    const phone = normalisePhone(input.phone);
    if (!phone) throw badRequest("Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.");
    return phone;
  }
  return input.email;
};

export const requestOtp = async (body, ip) => {
  const input = parse(requestSchema, body);
  const destination = destinationOf(input);
  enforce(`otp-ip:${ip}`, 10, 15 * 60 * 1000, "Too many code requests from this network. Try again in 15 minutes.");
  enforce(`otp-dest:${destination}`, 5, 60 * 60 * 1000, "Too many codes sent to this number or email. Try again in an hour.");

  const recent = await db.one(
    "SELECT created_at FROM otp_challenges WHERE destination = $1 ORDER BY created_at DESC LIMIT 1",
    [destination]
  );
  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_GAP_MS) {
    throw badRequest("Please wait 30 seconds before requesting another code.");
  }

  const code = otpCode();
  const challenge = await db.one(
    `INSERT INTO otp_challenges (channel, destination, code_hash, ip, expires_at)
     VALUES ($1, $2, 'pending', $3, $4) RETURNING id`,
    [input.channel, destination, ip, new Date(Date.now() + OTP_TTL_MS)]
  );
  await db.query("UPDATE otp_challenges SET code_hash = $2 WHERE id = $1", [challenge.id, codeHash(challenge.id, code)]);
  const delivery = await otpProvider.send(input.channel, destination, code);
  if (delivery.status === "failed") throw badRequest("We could not send the code. Please try again shortly.");

  return {
    challengeId: challenge.id,
    channel: input.channel,
    expiresInSeconds: OTP_TTL_MS / 1000,
    // Development only: config.js refuses OTP_PROVIDER=dev in production.
    ...(otpProvider.revealsCode ? { devCode: code, devNotice: "Development sign-in code. Real deployments send it by SMS or email." } : {}),
  };
};

export const verifyOtp = async (body, meta) => {
  const input = parse(verifySchema, body);
  enforce(`otp-verify-ip:${meta.ip}`, 30, 15 * 60 * 1000);

  return db.tx(async (t) => {
    const ch = await t.one("SELECT * FROM otp_challenges WHERE id = $1 FOR UPDATE", [input.challengeId]);
    if (!ch || ch.consumed_at) throw badRequest("This code is no longer valid. Request a new one.");
    if (new Date(ch.expires_at) < new Date()) throw badRequest("This code has expired. Request a new one.");
    if (ch.attempts >= ch.max_attempts) throw badRequest("Too many wrong attempts. Request a new code.");

    if (!safeEqual(ch.code_hash, codeHash(ch.id, input.code))) {
      await t.query("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1", [ch.id]);
      const left = ch.max_attempts - ch.attempts - 1;
      // Commit the attempt count, then report the failure.
      return { error: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code." };
    }
    await t.query("UPDATE otp_challenges SET consumed_at = now() WHERE id = $1", [ch.id]);

    const field = ch.channel === "sms" ? "phone" : "email";
    const lookup = field === "phone" ? "phone = $1" : "lower(email) = lower($1)";
    let user = await t.one(`SELECT * FROM users WHERE ${lookup} FOR UPDATE`, [ch.destination]);
    let isNew = false;
    if (!user) {
      isNew = true;
      user = await t.one(
        `INSERT INTO users (${field}, ${field}_verified_at) VALUES ($1, now()) RETURNING *`,
        [ch.destination]
      );
      await t.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'passenger')", [user.id]);
      await t.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [user.id]);
    } else {
      if (user.status === "suspended") throw forbidden("This account is suspended. Contact support for help.");
      if (user.status === "deleted") throw forbidden("This account has been deleted.");
      if (user.status === "deactivated") {
        await t.query("UPDATE users SET status = 'active', status_reason = NULL, updated_at = now() WHERE id = $1", [user.id]);
      }
      await t.query(`UPDATE users SET ${field}_verified_at = COALESCE(${field}_verified_at, now()) WHERE id = $1`, [user.id]);
    }

    const token = randomToken(32);
    await t.query(
      `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, sha256(token), (meta.userAgent || "").slice(0, 200), meta.ip, new Date(Date.now() + config.sessionDays * 86400000)]
    );
    await audit({ actor: { id: user.id }, action: isNew ? "auth.register" : "auth.login", entityType: "user", entityId: user.id, details: { channel: ch.channel }, client: t });
    return { token, isNew, userId: user.id };
  }).then((result) => {
    if (result.error) throw badRequest(result.error);
    return result;
  });
};

// Resolve a session token to the signed-in user with roles and permissions.
export const sessionUser = async (token) => {
  if (!token) return null;
  const row = await db.one(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.*,
            COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
      GROUP BY s.id, u.id`,
    [sha256(token)]
  );
  if (!row) return null;
  if (row.status !== "active") return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60 * 1000) {
    db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]).catch(() => {});
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    phone: row.phone,
    email: row.email,
    status: row.status,
    isDemo: row.is_demo,
    roles: row.roles,
    primaryRole: primaryRole(row.roles),
    permissions: permissionsFor(row.roles),
  };
};

export const logout = async (user) => {
  if (!user) throw unauthorized();
  await db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [user.sessionId]);
};

export const logoutEverywhere = async (userId) => {
  await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
};
