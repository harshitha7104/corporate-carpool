import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { maps } from "../providers/maps/index.js";
import { emailProvider, otpProvider, smsProvider } from "../providers/messaging.js";
import { paymentsProvider } from "../providers/payments.js";
import { logoutEverywhere } from "./auth.js";
import { notify } from "./notifications.js";
import { verificationSummary } from "./users.js";
import { workerStatus } from "../workers/status.js";

const windowSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  includeDemo: z.enum(["true", "false"]).default("false"),
});

const resolveWindow = (q) => {
  const to = q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : new Date(to.getTime() - 30 * 86400000);
  if (from > to) throw badRequest("The start date must be before the end date.");
  return { from, to, includeDemo: q.includeDemo === "true" };
};

const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

// Definitions live in docs/metrics.md; keep both in step.
export const metrics = async (query) => {
  const { from, to, includeDemo } = resolveWindow(parse(windowSchema, query));
  const p = [from, to, includeDemo];
  const demo = (alias) => `($3 OR NOT ${alias}.is_demo)`;
  // Declare the parameter types once; not every metric query uses every one.
  const one = (sql) => db.one(`WITH _params AS (SELECT $1::timestamptz AS from_at, $2::timestamptz AS to_at, $3::boolean AS include_demo) ${sql}`, p);
  const [users, drivers, rides, requests, acceptance, cancels, searches, utilisation, recurring, money, safety, tickets, payFail] = await Promise.all([
    one(`SELECT count(*) FILTER (WHERE u.created_at >= $1 AND u.created_at < $2) AS registered, count(*) FILTER (WHERE u.status = 'active') AS active_total FROM users u WHERE ${demo("u")} AND u.status <> 'deleted'`),
    one(`SELECT count(*) AS verified FROM users u WHERE ${demo("u")} AND u.status = 'active'
           AND EXISTS (SELECT 1 FROM identity_verifications v WHERE v.user_id = u.id AND v.kind = 'government_id' AND v.status = 'verified' AND (v.expires_at IS NULL OR v.expires_at > now()))
           AND EXISTS (SELECT 1 FROM identity_verifications v WHERE v.user_id = u.id AND v.kind = 'driving_license' AND v.status = 'verified' AND (v.expires_at IS NULL OR v.expires_at > now()))`),
    one(`SELECT count(*) FILTER (WHERE r.published_at >= $1 AND r.published_at < $2) AS published,
                count(*) FILTER (WHERE r.completed_at >= $1 AND r.completed_at < $2) AS completed
           FROM rides r WHERE ${demo("r")}`),
    one(`SELECT count(*) AS requests FROM bookings b WHERE b.requested_at >= $1 AND b.requested_at < $2 AND ${demo("b")}`),
    one(`SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.to_status = 'ACCEPTED' AND e.actor_role = 'driver')) AS accepted,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.from_status = 'REQUESTED'
                                   AND (e.to_status IN ('ACCEPTED','REJECTED') OR (e.to_status = 'EXPIRED' AND e.actor_role = 'system')))) AS decided
           FROM bookings b JOIN rides r ON r.id = b.ride_id
          WHERE r.booking_mode = 'request' AND b.requested_at >= $1 AND b.requested_at < $2 AND ${demo("b")}`),
    one(`SELECT count(*) FILTER (WHERE b.status IN ('CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER')) AS cancelled,
                count(*) FILTER (WHERE b.status IN ('CANCELLED_BY_PASSENGER')) AS by_passenger,
                count(*) FILTER (WHERE b.status IN ('CANCELLED_BY_DRIVER')) AS by_driver,
                count(*) AS base
           FROM bookings b WHERE b.accepted_at IS NOT NULL AND b.requested_at >= $1 AND b.requested_at < $2 AND ${demo("b")}`),
    one(`SELECT count(*) AS searches FROM search_events s WHERE s.created_at >= $1 AND s.created_at < $2 AND ($3 OR true)`),
    one(`SELECT coalesce(sum(x.booked), 0) AS seats_used, coalesce(sum(x.seats_total), 0) AS seats_offered, count(*) AS rides
           FROM (SELECT r.id, r.seats_total, (SELECT coalesce(sum(b.seats), 0) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'COMPLETED') AS booked
                   FROM rides r WHERE r.completed_at >= $1 AND r.completed_at < $2 AND ${demo("r")}) x`),
    one(`SELECT count(*) FILTER (WHERE r.recurring_rule_id IS NOT NULL) AS from_commutes, count(*) AS total,
                (SELECT count(*) FROM recurring_commute_rules c WHERE c.status = 'active' AND ($3 OR NOT c.is_demo)) AS active_rules
           FROM rides r WHERE r.published_at >= $1 AND r.published_at < $2 AND ${demo("r")}`),
    one(`SELECT coalesce(sum(p.amount_paise), 0)::bigint AS captured, coalesce(sum(p.refunded_paise), 0)::bigint AS refunded,
                coalesce(sum(p.platform_fee_paise), 0)::bigint AS fees
           FROM payments p WHERE p.captured_at >= $1 AND p.captured_at < $2 AND ${demo("p")}`),
    one(`SELECT count(*) AS total, count(*) FILTER (WHERE severity IN ('high','critical')) AS serious, count(*) FILTER (WHERE status IN ('open','investigating')) AS open
           FROM safety_reports s WHERE s.created_at >= $1 AND s.created_at < $2 AND ($3 OR true)`),
    one(`SELECT count(*) AS opened, count(*) FILTER (WHERE status IN ('resolved','closed')) AS resolved FROM support_tickets t WHERE t.created_at >= $1 AND t.created_at < $2 AND ($3 OR true)`),
    one(`SELECT count(*) FILTER (WHERE p.status = 'failed') AS failed, count(*) AS attempts FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 AND ${demo("p")}`),
  ]);
  return {
    window: { from, to, includeDemo, timezone: "Asia/Kolkata" },
    registeredUsers: users.registered,
    activeUsers: users.active_total,
    verifiedDrivers: drivers.verified,
    ridesPublished: rides.published,
    ridesCompleted: rides.completed,
    bookingRequests: requests.requests,
    acceptanceRate: { value: rate(acceptance.accepted, acceptance.decided), accepted: acceptance.accepted, decided: acceptance.decided },
    cancellationRate: { value: rate(cancels.cancelled, cancels.base), byPassenger: cancels.by_passenger, byDriver: cancels.by_driver, base: cancels.base },
    searchToBooking: { value: rate(requests.requests, searches.searches), searches: searches.searches, requests: requests.requests },
    seatUtilisation: { value: rate(utilisation.seats_used, utilisation.seats_offered), seatsUsed: utilisation.seats_used, seatsOffered: utilisation.seats_offered, averageSeatsPerRide: utilisation.rides ? Math.round((utilisation.seats_used / utilisation.rides) * 100) / 100 : null },
    recurringAdoption: { value: rate(recurring.from_commutes, recurring.total), fromCommutes: recurring.from_commutes, activeRules: recurring.active_rules },
    contributionVolume: { capturedPaise: money.captured, refundedPaise: money.refunded, netPaise: money.captured - money.refunded, platformFeesPaise: money.fees },
    safety: { reports: safety.total, serious: safety.serious, open: safety.open },
    support: { opened: tickets.opened, resolved: tickets.resolved },
    paymentFailures: { value: rate(payFail.failed, payFail.attempts), failed: payFail.failed, attempts: payFail.attempts },
  };
};

// ---- Users ---------------------------------------------------------------------------------
export const listUsers = async (query) => {
  const q = parse(z.object({ q: z.string().trim().max(80).optional(), status: z.enum(["active", "suspended", "deactivated", "deleted"]).optional(), role: z.enum(["passenger", "driver", "admin", "support"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }), query);
  const like = q.q ? `%${q.q.toLowerCase()}%` : null;
  const rows = await db.many(
    `SELECT u.id, u.phone, u.email, u.status, u.is_demo, u.created_at, p.full_name,
            (SELECT array_agg(role ORDER BY role) FROM user_roles r WHERE r.user_id = u.id) AS roles,
            (SELECT count(*) FROM safety_reports s WHERE s.subject_user_id = u.id) AS reports_against
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE ($1::text IS NULL OR lower(coalesce(p.full_name, '')) LIKE $1 OR coalesce(u.phone, '') LIKE $1 OR lower(coalesce(u.email, '')) LIKE $1)
        AND ($2::text IS NULL OR u.status = $2)
        AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = $3))
      ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
    [like, q.status || null, q.role || null, q.limit, q.offset]
  );
  return rows;
};

export const userDetail = async (admin, id) => {
  const u = await db.one(
    `SELECT u.*, p.full_name, p.gender, p.home_area, p.work_area,
            (SELECT array_agg(role ORDER BY role) FROM user_roles r WHERE r.user_id = u.id) AS roles
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [id]
  );
  if (!u) throw notFound("User");
  await audit({ actor: admin, action: "admin.user.view", entityType: "user", entityId: id });
  const [vehicles, rides, bookings, reports, sessions] = await Promise.all([
    db.many("SELECT id, make, model, color, plate_number, seats, deleted_at FROM vehicles WHERE owner_id = $1", [id]),
    db.many("SELECT id, status, origin_label, destination_label, departure_at FROM rides WHERE driver_id = $1 ORDER BY departure_at DESC LIMIT 20", [id]),
    db.many("SELECT b.id, b.status, b.total_paise, r.origin_label, r.destination_label, r.departure_at FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.passenger_id = $1 ORDER BY b.created_at DESC LIMIT 20", [id]),
    db.many("SELECT id, category, severity, status, created_at, reporter_id = $1 AS filed_by_user FROM safety_reports WHERE reporter_id = $1 OR subject_user_id = $1 ORDER BY created_at DESC LIMIT 20", [id]),
    db.one("SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS active FROM sessions WHERE user_id = $1", [id]),
  ]);
  return {
    id: u.id, phone: u.phone, email: u.email, status: u.status, statusReason: u.status_reason, isDemo: u.is_demo, createdAt: u.created_at,
    fullName: u.full_name, homeArea: u.home_area, workArea: u.work_area, roles: u.roles || [],
    verification: await verificationSummary(id), vehicles, rides, bookings, reports, activeSessions: sessions.active,
  };
};

export const setUserStatus = async (admin, id, body) => {
  const input = parse(z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(5, "Record why (at least 5 characters).").max(300) }), body);
  if (id === admin.id) throw forbidden("You cannot change your own account status.");
  const u = await db.one("SELECT status FROM users WHERE id = $1", [id]);
  if (!u) throw notFound("User");
  if (u.status === "deleted") throw conflict("deleted", "Deleted accounts cannot be changed.");
  await db.tx(async (t) => {
    await t.query("UPDATE users SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1", [id, input.status, input.reason]);
    await audit({ actor: admin, action: input.status === "suspended" ? "admin.user.suspend" : "admin.user.reinstate", entityType: "user", entityId: id, details: { reason: input.reason, previous: u.status }, client: t });
  });
  if (input.status === "suspended") {
    await logoutEverywhere(id);
    // Their published rides close to new bookings; existing ones are handled by staff.
    await db.query("UPDATE rides SET status = 'draft', updated_at = now() WHERE driver_id = $1 AND status = 'published' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = rides.id AND b.status IN ('REQUESTED','ACCEPTED','CONFIRMED'))", [id]);
  } else {
    await notify([id], { type: "account.reinstated", title: "Account reinstated", body: "Your Green Way account is active again.", data: {} });
  }
  return { id, status: input.status };
};

export const setRole = async (admin, id, body) => {
  const input = parse(z.object({ role: z.enum(["admin", "support", "driver"]), grant: z.boolean() }), body);
  if (id === admin.id && !input.grant) throw forbidden("You cannot remove your own roles.");
  const exists = await db.one("SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", [id]);
  if (!exists) throw notFound("User");
  await db.tx(async (t) => {
    if (input.grant) await t.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, input.role, admin.id]);
    else await t.query("DELETE FROM user_roles WHERE user_id = $1 AND role = $2", [id, input.role]);
    await audit({ actor: admin, action: input.grant ? "admin.role.grant" : "admin.role.revoke", entityType: "user", entityId: id, details: { role: input.role }, client: t });
  });
  return { id, role: input.role, granted: input.grant };
};

// ---- Rides, bookings, safety, payments ---------------------------------------------------
const listQuery = z.object({ status: z.string().max(40).optional(), q: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) });

export const listRides = (query) => {
  const q = parse(listQuery, query);
  return db.many(
    `SELECT r.id, r.status, r.origin_label, r.destination_label, r.departure_at, r.seats_total, i.seats_reserved, r.price_per_seat_paise,
            r.booking_mode, r.is_demo, r.recurring_rule_id IS NOT NULL AS recurring, coalesce(p.full_name, 'Driver') AS driver_name, r.driver_id
       FROM rides r JOIN seat_inventory i ON i.ride_id = r.id LEFT JOIN user_profiles p ON p.user_id = r.driver_id
      WHERE ($1::text IS NULL OR r.status = $1) AND ($2::text IS NULL OR r.origin_label ILIKE $2 OR r.destination_label ILIKE $2)
      ORDER BY r.departure_at DESC LIMIT $3 OFFSET $4`,
    [q.status || null, q.q ? `%${q.q}%` : null, q.limit, q.offset]
  );
};

export const listBookings = (query) => {
  const q = parse(listQuery, query);
  return db.many(
    `SELECT b.id, b.status, b.seats, b.total_paise, b.requested_at, b.is_demo, r.id AS ride_id, r.origin_label, r.destination_label, r.departure_at,
            coalesce(pp.full_name, 'Passenger') AS passenger_name, coalesce(dp.full_name, 'Driver') AS driver_name
       FROM bookings b JOIN rides r ON r.id = b.ride_id
       LEFT JOIN user_profiles pp ON pp.user_id = b.passenger_id LEFT JOIN user_profiles dp ON dp.user_id = r.driver_id
      WHERE ($1::text IS NULL OR b.status = $1)
      ORDER BY b.requested_at DESC LIMIT $2 OFFSET $3`,
    [q.status || null, q.limit, q.offset]
  );
};

export const listReports = (query) => {
  const q = parse(listQuery, query);
  return db.many(
    `SELECT s.*, coalesce(rp.full_name, 'Member') AS reporter_name, coalesce(sp.full_name, NULL) AS subject_name
       FROM safety_reports s LEFT JOIN user_profiles rp ON rp.user_id = s.reporter_id LEFT JOIN user_profiles sp ON sp.user_id = s.subject_user_id
      WHERE ($1::text IS NULL OR s.status = $1)
      ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, s.created_at DESC
      LIMIT $2 OFFSET $3`,
    [q.status || null, q.limit, q.offset]
  );
};

export const updateReport = async (admin, id, body) => {
  const input = parse(z.object({ status: z.enum(["open", "investigating", "resolved", "dismissed"]), resolution: z.string().trim().max(1000).optional() }), body);
  if (["resolved", "dismissed"].includes(input.status) && !input.resolution) throw badRequest("Record the outcome before closing a report.");
  const r = await db.one(
    "UPDATE safety_reports SET status = $2, resolution = COALESCE($3, resolution), assigned_to = COALESCE(assigned_to, $4), updated_at = now() WHERE id = $1 RETURNING *",
    [id, input.status, input.resolution || null, admin.id]
  );
  if (!r) throw notFound("Report");
  await audit({ actor: admin, action: "admin.safety.update", entityType: "safety_report", entityId: id, details: input });
  if (["resolved", "dismissed"].includes(input.status)) {
    await notify([r.reporter_id], { type: "safety.report_updated", title: "Your report was reviewed", body: input.resolution, data: { reportId: id } });
  }
  return r;
};

export const listDisputes = () =>
  db.many(
    `SELECT b.id, b.status, b.total_paise, b.updated_at, r.origin_label, r.destination_label, r.departure_at,
            (SELECT reason FROM booking_events e WHERE e.booking_id = b.id AND e.to_status = 'DISPUTED' ORDER BY id DESC LIMIT 1) AS reason,
            (SELECT actor_role FROM booking_events e WHERE e.booking_id = b.id AND e.to_status = 'DISPUTED' ORDER BY id DESC LIMIT 1) AS opened_by
       FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.status = 'DISPUTED' ORDER BY b.updated_at`
  );

export const listPayments = (query) => {
  const q = parse(listQuery, query);
  return db.many(
    `SELECT p.id, p.status, p.provider, p.amount_paise, p.refunded_paise, p.platform_fee_paise, p.receipt_number, p.failure_reason,
            p.created_at, p.captured_at, p.is_demo, p.booking_id, b.status AS booking_status
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
    [q.status || null, q.limit, q.offset]
  );
};

export const listRefunds = (query) => {
  const q = parse(listQuery, query);
  return db.many(
    `SELECT r.id, r.status, r.amount_paise, r.reason, r.failure_reason, r.created_at, r.processed_at, r.payment_id, p.provider
       FROM refunds r JOIN payments p ON p.id = r.payment_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
    [q.status || null, q.limit, q.offset]
  );
};

// Reconciliation: states that should not persist and need a human look.
export const reconciliation = async () => ({
  staleOrders: await db.many("SELECT id, booking_id, amount_paise, created_at FROM payments WHERE status = 'created' AND created_at < now() - interval '2 hours' ORDER BY created_at LIMIT 50"),
  capturedWithoutConfirmedBooking: await db.many(
    `SELECT p.id, p.booking_id, p.amount_paise, p.refunded_paise, b.status AS booking_status FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.status = 'captured' AND b.status NOT IN ('CONFIRMED','IN_PROGRESS','COMPLETED','DISPUTED','NO_SHOW')
        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_id = p.id AND r.status <> 'failed') LIMIT 50`
  ),
  stuckRefunds: await db.many("SELECT id, payment_id, amount_paise, failure_reason, created_at FROM refunds WHERE status = 'pending' AND created_at < now() - interval '1 hour' LIMIT 50"),
  webhookErrors: await db.many("SELECT id, provider, event_type, signature_valid, processing_error, received_at FROM payment_webhook_events WHERE processing_error IS NOT NULL ORDER BY received_at DESC LIMIT 50"),
});

export const listAudit = (query) => {
  const q = parse(z.object({ action: z.string().max(60).optional(), entityType: z.string().max(60).optional(), entityId: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }), query);
  return db.many(
    `SELECT a.id, a.actor_id, a.actor_role, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.request_id, a.created_at,
            coalesce(p.full_name, NULL) AS actor_name
       FROM audit_logs a LEFT JOIN user_profiles p ON p.user_id = a.actor_id
      WHERE ($1::text IS NULL OR a.action LIKE $1 || '%') AND ($2::text IS NULL OR a.entity_type = $2) AND ($3::text IS NULL OR a.entity_id = $3)
      ORDER BY a.id DESC LIMIT $4 OFFSET $5`,
    [q.action || null, q.entityType || null, q.entityId || null, q.limit, q.offset]
  );
};

// ---- Exports -------------------------------------------------------------------------------
const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formulas and quote everything that needs it.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const EXPORTS = {
  bookings: `SELECT b.id, b.status, b.seats, b.contribution_paise, b.platform_fee_paise, b.total_paise, b.requested_at, b.confirmed_at, b.completed_at, b.cancelled_at,
                    b.ride_id, r.origin_label, r.destination_label, r.departure_at, b.is_demo
               FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.requested_at >= $1 AND b.requested_at < $2 AND ($3 OR NOT b.is_demo) ORDER BY b.requested_at`,
  rides: `SELECT r.id, r.status, r.origin_label, r.destination_label, r.departure_at, r.distance_m, r.seats_total, i.seats_reserved, r.price_per_seat_paise,
                 r.booking_mode, r.recurring_rule_id IS NOT NULL AS recurring, r.route_source, r.is_demo
            FROM rides r JOIN seat_inventory i ON i.ride_id = r.id WHERE r.departure_at >= $1 AND r.departure_at < $2 AND ($3 OR NOT r.is_demo) ORDER BY r.departure_at`,
  payments: `SELECT p.id, p.booking_id, p.provider, p.status, p.amount_paise, p.platform_fee_paise, p.provider_fee_paise, p.driver_share_paise, p.refunded_paise,
                    p.receipt_number, p.created_at, p.captured_at, p.is_demo
               FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 AND ($3 OR NOT p.is_demo) ORDER BY p.created_at`,
};

export const exportCsv = async (admin, kind, query) => {
  if (!EXPORTS[kind]) throw notFound("Export");
  const { from, to, includeDemo } = resolveWindow(parse(windowSchema, query));
  const result = await db.query(EXPORTS[kind], [from, to, includeDemo]);
  await audit({ actor: admin, action: "admin.export", entityType: kind, details: { from, to, includeDemo, rows: result.rowCount } });
  const header = result.fields.map((f) => f.name);
  const lines = [header.join(","), ...result.rows.map((row) => header.map((h) => csvCell(row[h])).join(","))];
  return { filename: `greenway-${kind}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, body: `${lines.join("\r\n")}\r\n` };
};

// ---- Health ------------------------------------------------------------------------------------
export const health = async () => {
  const started = Date.now();
  await db.query("SELECT 1");
  const dbLatencyMs = Date.now() - started;
  const [migrations, jobs, deliveries, webhooks] = await Promise.all([
    db.many("SELECT version, applied_at FROM schema_migrations ORDER BY version"),
    db.many("SELECT id, type, attempts, last_error, updated_at FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20"),
    db.one(`SELECT count(*) FILTER (WHERE status = 'pending') AS pending, count(*) FILTER (WHERE status = 'failed') AS failed,
                   count(*) FILTER (WHERE status = 'logged_dev') AS logged_dev, count(*) FILTER (WHERE status = 'not_configured') AS not_configured,
                   count(*) FILTER (WHERE status = 'sent') AS sent FROM notification_deliveries WHERE created_at > now() - interval '7 days'`),
    db.one("SELECT count(*) FILTER (WHERE NOT signature_valid) AS invalid, count(*) FILTER (WHERE processing_error IS NOT NULL) AS errors FROM payment_webhook_events WHERE received_at > now() - interval '7 days'"),
  ]);
  return {
    status: "ok",
    environment: config.env,
    database: { ok: true, latencyMs: dbLatencyMs, migrations },
    worker: workerStatus(),
    failedJobs: jobs,
    notificationDeliveries7d: deliveries,
    webhooks7d: webhooks,
    providers: {
      maps: { name: maps.name, live: maps.live },
      payments: { name: paymentsProvider.name, live: paymentsProvider.live },
      otp: { name: otpProvider.name, live: !otpProvider.revealsCode },
      sms: { name: smsProvider.name, live: smsProvider.name !== "log" },
      email: { name: emailProvider.name, live: emailProvider.name !== "log" },
      whatsapp: { name: "none", live: false },
    },
  };
};
