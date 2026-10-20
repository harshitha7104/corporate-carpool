// Shared test harness: each test file gets its own throwaway PostgreSQL
// server (embedded-postgres, non-persistent) and a real HTTP server.
process.env.NODE_ENV = "test";
process.env.WORKER_ENABLED = "false";

import http from "node:http";
import { after, before } from "node:test";

const { startDevDatabase } = await import("../src/db/devServer.js");
const { closePool, db, initPool } = await import("../src/db/index.js");
const { migrate } = await import("../src/db/migrate.js");
const { createApp } = await import("../src/app.js");
const { randomToken, sha256 } = await import("../src/lib/util.js");
const { resetRateLimits } = await import("../src/lib/rateLimit.js");
const { clearSettingsCache } = await import("../src/services/settings.js");

export { db };

let pg;
let server;
export let base;

export const useTestServer = () => {
  before(async () => {
    pg = await startDevDatabase({ name: `test-${process.pid}`, persistent: false });
    initPool(pg.url);
    await migrate();
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePool();
    await pg.stop();
  });
};

export const resetLimits = () => resetRateLimits();
export const resetSettings = () => clearSettingsCache();

let phoneSeq = 0;
const nextPhone = () => `+9198${String(process.pid % 1000).padStart(3, "0")}${String(++phoneSeq).padStart(5, "0")}`;

// Create a user directly (skipping OTP) and give them a session cookie.
export const createUser = async ({ name = "Test Person", gender = "female", roles = [], phone = nextPhone(), email = null } = {}) => {
  const u = await db.one("INSERT INTO users (phone, email, phone_verified_at) VALUES ($1, $2, now()) RETURNING id", [phone, email]);
  await db.query("INSERT INTO user_profiles (user_id, full_name, gender) VALUES ($1, $2, $3)", [u.id, name, gender]);
  await db.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [u.id]);
  for (const role of ["passenger", ...roles]) await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [u.id, role]);
  const token = randomToken();
  await db.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [u.id, sha256(token)]);
  return { id: u.id, phone, cookie: `gw_session=${token}`, api: client(`gw_session=${token}`) };
};

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c63f8cfc0f01f00050002015d0d6e1a0000000049454e44ae426082", "hex");
export const pngBytes = PNG;

let plateSeq = 0;
// Verified ID, licence and vehicle, so the user can publish rides.
export const createVerifiedDriver = async (opts = {}) => {
  const user = await createUser({ name: "Driver Person", ...opts, roles: ["driver", ...(opts.roles || [])] });
  const admin = await adminUser();
  const file = (purpose) =>
    db.one("INSERT INTO files (owner_id, purpose, mime_type, size_bytes, sha256, storage_key) VALUES ($1, $2, 'image/png', 10, 'x', $3) RETURNING id", [user.id, purpose, randomToken()]).then((r) => r.id);
  await db.query("INSERT INTO identity_verifications (user_id, kind, document_type, document_last4, document_file_id, status, reviewer_id, reviewed_at) VALUES ($1, 'government_id', 'aadhaar', '1234', $2, 'verified', $3, now())", [user.id, await file("identity_document"), admin.id]);
  await db.query("INSERT INTO identity_verifications (user_id, kind, document_type, document_last4, document_file_id, status, reviewer_id, reviewed_at) VALUES ($1, 'driving_license', 'driving_license', '5678', $2, 'verified', $3, now())", [user.id, await file("driving_license"), admin.id]);
  const plate = `KA01TT${String(++plateSeq + (process.pid % 900)).padStart(4, "0")}`;
  const v = await db.one("INSERT INTO vehicles (owner_id, make, model, color, plate_number, seats) VALUES ($1, 'Hyundai', 'Creta', 'White', $2, $3) RETURNING id", [user.id, plate, opts.seats || 4]);
  await db.query("INSERT INTO vehicle_verifications (vehicle_id, rc_file_id, insurance_file_id, insurance_expiry, status, reviewer_id, reviewed_at) VALUES ($1, $2, $3, now() + interval '1 year', 'verified', $4, now())", [v.id, await file("vehicle_rc"), await file("vehicle_insurance"), admin.id]);
  return { ...user, vehicleId: v.id };
};

let cachedAdmin;
export const adminUser = async () => {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = await createUser({ name: "Admin Person", roles: ["admin"] });
  return cachedAdmin;
};

// Minimal fetch wrapper carrying the session cookie and a trusted Origin.
export const client = (cookie) => {
  const send = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (p, h) => send("GET", p, undefined, h),
    post: (p, b, h) => send("POST", p, b ?? {}, h),
    patch: (p, b, h) => send("PATCH", p, b, h),
    put: (p, b, h) => send("PUT", p, b, h),
    del: (p, h) => send("DELETE", p, undefined, h),
  };
};

export const anon = () => client(null);

// Real Bengaluru points along a Whitefield -> Manyata commute.
export const P = {
  phoenix: { label: "Phoenix Marketcity", lat: 12.9975, lng: 77.6966 },
  krPuram: { label: "KR Puram", lat: 13.0076, lng: 77.695 },
  hebbal: { label: "Hebbal", lat: 13.0358, lng: 77.597 },
  manyata: { label: "Manyata Tech Park", lat: 13.045, lng: 77.626 },
  koramangala: { label: "Koramangala", lat: 12.9352, lng: 77.6245 },
  electronicCity: { label: "Electronic City", lat: 12.8452, lng: 77.6602 },
  mysore: { label: "Mysuru Palace", lat: 12.3052, lng: 76.6552 },
};

export const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();

let keySeq = 0;
export const idemKey = () => `test-key-${process.pid}-${Date.now()}-${++keySeq}`;

// Publish a ride as `driver` and return it.
export const publishRide = async (driver, overrides = {}) => {
  const res = await driver.api.post("/rides", {
    vehicleId: driver.vehicleId,
    origin: P.phoenix,
    destination: P.manyata,
    stops: [P.krPuram],
    departureAt: hoursFromNow(6),
    seatsTotal: 3,
    pricePerSeatPaise: 5000,
    bookingMode: "instant",
    publish: true,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`publishRide failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

export const book = (passenger, rideId, { seats = 1, pickup = P.phoenix, dropoff = P.manyata, key = idemKey() } = {}) =>
  passenger.api.post(`/rides/${rideId}/bookings`, { seats, pickup, dropoff }, { "Idempotency-Key": key });

// Pay for an ACCEPTED booking through the simulated gateway.
export const pay = async (passenger, bookingId, outcome = "success") => {
  const co = await passenger.api.post("/payments/checkout", { bookingId }, { "Idempotency-Key": idemKey() });
  if (co.status !== 201) throw new Error(`checkout failed: ${co.status} ${JSON.stringify(co.body)}`);
  return passenger.api.post(`/payments/${co.body.payment.id}/simulate`, { outcome });
};
