import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { randomToken, sha256 } from "../lib/util.js";
import { parse } from "../lib/validate.js";
import { smsProvider } from "../providers/messaging.js";
import { hub } from "../realtime/hub.js";
import { notify } from "./notifications.js";
import { getSetting } from "./settings.js";

const STALE_AFTER_S = 60;

// Who may see a ride's live state: its driver and passengers on board or confirmed.
export const rideAccess = async (user, rideId) => {
  const ride = await db.one("SELECT id, driver_id, status, location_sharing FROM rides WHERE id = $1", [rideId]);
  if (!ride) throw notFound("Ride");
  if (ride.driver_id === user.id) return { ride, role: "driver" };
  const b = await db.one(
    "SELECT id, status FROM bookings WHERE ride_id = $1 AND passenger_id = $2 AND status IN ('CONFIRMED','IN_PROGRESS') LIMIT 1",
    [rideId, user.id]
  );
  if (b) return { ride, role: "passenger", bookingId: b.id };
  throw notFound("Ride");
};

// ---- Reports ----------------------------------------------------------------------
const reportSchema = z.object({
  category: z.enum(["unsafe_driving", "harassment", "no_show", "fraud", "vehicle_mismatch", "payment_dispute", "emergency", "other"]),
  description: z.string().trim().min(10, "Describe what happened (at least 10 characters).").max(2000),
  rideId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  subjectUserId: z.string().uuid().optional(),
  blockSubject: z.boolean().default(false),
});

const SEVERITY = { emergency: "critical", harassment: "high", unsafe_driving: "high", fraud: "high", vehicle_mismatch: "medium", payment_dispute: "medium", no_show: "low", other: "low" };

export const createReport = async (user, body) => {
  const input = parse(reportSchema, body);
  enforce(`report:${user.id}`, 10, 60 * 60 * 1000, "You have filed several reports recently. Contact support if this is urgent.");
  if (input.subjectUserId === user.id) throw badRequest("You cannot report yourself.");
  // A report about a trip must come from someone on that trip.
  if (input.rideId) {
    const involved = await db.one(
      `SELECT 1 FROM rides r WHERE r.id = $1 AND (r.driver_id = $2 OR EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = r.id AND b.passenger_id = $2))`,
      [input.rideId, user.id]
    );
    if (!involved) throw notFound("Ride");
  }
  const severity = SEVERITY[input.category];
  const report = await db.tx(async (t) => {
    const r = await t.one(
      `INSERT INTO safety_reports (reporter_id, subject_user_id, ride_id, booking_id, category, severity, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, category, severity, status, created_at`,
      [user.id, input.subjectUserId || null, input.rideId || null, input.bookingId || null, input.category, severity, input.description]
    );
    if (severity === "high" || severity === "critical") {
      await t.query(
        `INSERT INTO support_tickets (user_id, category, subject, description, priority, safety_report_id, escalated, escalation_reason)
         VALUES ($1, 'safety', $2, $3, $4, $5, true, 'Safety report')`,
        [user.id, `Safety report: ${input.category.replace(/_/g, " ")}`, input.description, severity === "critical" ? "urgent" : "high", r.id]
      );
    }
    if (input.blockSubject && input.subjectUserId) {
      await t.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, input.subjectUserId]);
    }
    await audit({ actor: user, action: "safety.report", entityType: "safety_report", entityId: r.id, details: { category: input.category, severity }, client: t });
    return r;
  });
  if (severity === "high" || severity === "critical") await alertStaff(`Safety report (${severity})`, `${input.category.replace(/_/g, " ")} reported. Review it in the safety queue.`, { reportId: report.id });
  return report;
};

const alertStaff = async (title, body, data) => {
  const staff = await db.many("SELECT DISTINCT user_id FROM user_roles WHERE role IN ('admin','support')");
  await notify(staff.map((s) => s.user_id), { type: "safety.alert", title, body, data });
};

export const myReports = (user) =>
  db.many("SELECT id, category, severity, status, description, resolution, created_at, updated_at FROM safety_reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 50", [user.id]);

// ---- Emergency --------------------------------------------------------------------
export const emergencyInfo = async () => {
  const s = await getSetting("safety");
  return {
    number: s.emergency_number,
    label: s.emergency_label,
    notice: "Green Way support is not an emergency service. In danger, call the emergency number first.",
  };
};

// SOS: records a critical report with the latest location, alerts staff, and
// texts trusted contacts through the SMS provider. The response says exactly
// which texts were sent, logged in development, or could not be sent.
export const triggerSos = async (user, body) => {
  const input = parse(z.object({ rideId: z.string().uuid().optional(), lat: z.number().optional(), lng: z.number().optional(), note: z.string().trim().max(300).optional() }), body || {});
  enforce(`sos:${user.id}`, 5, 10 * 60 * 1000);
  let rideInfo = null;
  if (input.rideId) {
    const { ride } = await rideAccess(user, input.rideId);
    rideInfo = await db.one(
      `SELECT r.origin_label, r.destination_label, v.make, v.model, v.color, v.plate_number
         FROM rides r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = $1`,
      [ride.id]
    );
  }
  const report = await db.one(
    `INSERT INTO safety_reports (reporter_id, ride_id, category, severity, description)
     VALUES ($1, $2, 'emergency', 'critical', $3) RETURNING id, created_at`,
    [user.id, input.rideId || null, `SOS pressed${input.note ? `: ${input.note}` : ""}${input.lat ? ` at ${input.lat.toFixed(5)},${input.lng.toFixed(5)}` : ""}`]
  );
  await db.query(
    `INSERT INTO support_tickets (user_id, category, subject, description, priority, safety_report_id, escalated, escalation_reason)
     VALUES ($1, 'safety', 'SOS alert', 'SOS button pressed in the app.', 'urgent', $2, true, 'SOS')`,
    [user.id, report.id]
  );
  await audit({ actor: user, action: "safety.sos", entityType: "safety_report", entityId: report.id, details: { rideId: input.rideId } });
  await alertStaff("SOS alert", "A member pressed SOS. Contact them now.", { reportId: report.id });

  const profile = await db.one("SELECT full_name FROM user_profiles WHERE user_id = $1", [user.id]);
  const contacts = await db.many("SELECT name, phone FROM trusted_contacts WHERE user_id = $1", [user.id]);
  const where = input.lat ? ` Last location: https://www.openstreetmap.org/?mlat=${input.lat}&mlon=${input.lng}` : "";
  const car = rideInfo ? ` In ${rideInfo.color} ${rideInfo.make} ${rideInfo.model} ${rideInfo.plate_number}, ${rideInfo.origin_label} to ${rideInfo.destination_label}.` : "";
  const text = `${profile?.full_name || "A Green Way member"} pressed SOS in the Green Way app.${car}${where} Call them, or call 112 if you cannot reach them.`;
  const contactResults = [];
  for (const c of contacts) {
    const r = await smsProvider.send(c.phone, text);
    contactResults.push({ name: c.name, status: r.status });
  }
  return { reportId: report.id, emergency: await emergencyInfo(), contacts: contactResults, smsProvider: smsProvider.name };
};

// ---- Trip sharing ---------------------------------------------------------------------
export const createShare = async (user, rideId) => {
  await rideAccess(user, rideId);
  const s = await getSetting("safety");
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + s.trip_share_hours * 3600000);
  const row = await db.one(
    "INSERT INTO trip_shares (ride_id, created_by, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id, expires_at",
    [rideId, user.id, sha256(token), expiresAt]
  );
  return { id: row.id, url: `${config.publicAppUrl}/share/${token}`, token, expiresAt: row.expires_at };
};

export const revokeShare = async (user, shareId) => {
  const r = await db.query("UPDATE trip_shares SET revoked_at = now() WHERE id = $1 AND created_by = $2 AND revoked_at IS NULL", [shareId, user.id]);
  if (!r.rowCount) throw notFound("Share link");
};

export const listShares = (user, rideId) =>
  db.many("SELECT id, expires_at, revoked_at, created_at FROM trip_shares WHERE ride_id = $1 AND created_by = $2 ORDER BY created_at DESC", [rideId, user.id]);

// Public, read-only view for someone holding a share link. Shows only what a
// trusted contact needs: first name, car, route, status and last location.
export const viewShare = async (token) => {
  const s = await db.one(
    `SELECT ts.expires_at, r.id AS ride_id, r.status, r.origin_label, r.destination_label, r.departure_at, r.est_arrival_at,
            r.location_sharing, r.route_geometry, v.make, v.model, v.color, v.plate_number,
            split_part(coalesce(p.full_name, 'Driver'), ' ', 1) AS driver_first_name
       FROM trip_shares ts JOIN rides r ON r.id = ts.ride_id JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN user_profiles p ON p.user_id = r.driver_id
      WHERE ts.token_hash = $1 AND ts.revoked_at IS NULL AND ts.expires_at > now()`,
    [sha256(token)]
  );
  if (!s) throw notFound("Share link");
  const loc = s.status === "in_progress" && s.location_sharing ? await latestLocation(s.ride_id) : null;
  return {
    status: s.status,
    origin: s.origin_label,
    destination: s.destination_label,
    departureAt: s.departure_at,
    estArrivalAt: s.est_arrival_at,
    route: s.route_geometry,
    driverFirstName: s.driver_first_name,
    vehicle: { make: s.make, model: s.model, color: s.color, plateNumber: s.plate_number },
    location: loc,
    linkExpiresAt: s.expires_at,
    emergency: await emergencyInfo(),
  };
};

// ---- Live location ----------------------------------------------------------------------
const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().int().min(0).max(10000).optional() });

export const latestLocation = async (rideId) => {
  const l = await db.one("SELECT lat, lng, accuracy_m, recorded_at FROM trip_locations WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT 1", [rideId]);
  if (!l) return null;
  const ageS = Math.round((Date.now() - new Date(l.recorded_at).getTime()) / 1000);
  return { lat: l.lat, lng: l.lng, accuracyM: l.accuracy_m, recordedAt: l.recorded_at, ageSeconds: ageS, stale: ageS > STALE_AFTER_S };
};

export const postLocation = async (user, rideId, body) => {
  const input = parse(locationSchema, body);
  const { ride, role } = await rideAccess(user, rideId);
  if (role !== "driver") throw forbidden("Only the driver shares trip location.");
  if (ride.status !== "in_progress") throw conflict("not_in_progress", "Location is only shared while the ride is in progress.");
  if (!ride.location_sharing) throw conflict("sharing_off", "Turn on location sharing for this trip first.");
  enforce(`loc:${rideId}`, 1, 4000, "Location updates are limited to one every few seconds.");
  const row = await db.one(
    "INSERT INTO trip_locations (ride_id, user_id, lat, lng, accuracy_m) VALUES ($1, $2, $3, $4, $5) RETURNING recorded_at",
    [rideId, user.id, input.lat, input.lng, input.accuracyM ?? null]
  );
  hub.toRide(rideId, "location", { rideId, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM ?? null, recordedAt: row.recorded_at });
  return { recordedAt: row.recorded_at };
};

export const setLocationSharing = async (user, rideId, body) => {
  const { enabled } = parse(z.object({ enabled: z.boolean() }), body);
  const { ride, role } = await rideAccess(user, rideId);
  if (role !== "driver") throw forbidden("Only the driver controls location sharing.");
  if (ride.status !== "in_progress" && enabled) throw conflict("not_in_progress", "Location sharing can be turned on once the ride starts.");
  if (enabled && !(await getSetting("features")).live_location) throw conflict("disabled", "Live location is turned off right now.");
  await db.query("UPDATE rides SET location_sharing = $2, updated_at = now() WHERE id = $1", [rideId, enabled]);
  hub.toRide(rideId, "location.sharing", { rideId, enabled });
  return { enabled };
};

export const getLiveState = async (user, rideId) => {
  const { ride, role } = await rideAccess(user, rideId);
  return { rideId, role, status: ride.status, locationSharing: ride.location_sharing, location: ride.location_sharing ? await latestLocation(rideId) : null };
};

// Worker step: delete trip locations past the retention period.
export const purgeLocations = async () => {
  const s = await getSetting("safety");
  const r = await db.query("DELETE FROM trip_locations WHERE recorded_at < now() - make_interval(days => $1)", [s.location_retention_days]);
  // Rides that ended without the driver completing them stop sharing too.
  await db.query("UPDATE rides SET location_sharing = false WHERE location_sharing AND status <> 'in_progress'");
  return r.rowCount;
};
