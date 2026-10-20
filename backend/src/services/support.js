import { z } from "zod";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { parse } from "../lib/validate.js";
import { notify } from "./notifications.js";

const ticketSchema = z.object({
  category: z.enum(["booking", "payment", "safety", "account", "verification", "other"]),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(4000),
  bookingId: z.string().uuid().optional(),
});

const isStaff = (u) => u.permissions.includes("support.tickets.work");
const seesAll = (u) => u.permissions.includes("support.tickets.read_all");

export const createTicket = async (user, body) => {
  const input = parse(ticketSchema, body);
  enforce(`ticket:${user.id}`, 10, 60 * 60 * 1000, "You have opened several tickets recently. Add to an existing one instead.");
  if (input.bookingId) {
    const mine = await db.one(
      "SELECT 1 FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1 AND (b.passenger_id = $2 OR r.driver_id = $2)",
      [input.bookingId, user.id]
    );
    if (!mine) throw notFound("Booking");
  }
  const priority = input.category === "safety" ? "high" : "normal";
  return db.one(
    `INSERT INTO support_tickets (user_id, category, subject, description, priority, booking_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [user.id, input.category, input.subject, input.description, priority, input.bookingId || null]
  );
};

const loadTicket = async (user, id) => {
  const t = await db.one("SELECT * FROM support_tickets WHERE id = $1", [id]);
  if (!t) throw notFound("Ticket");
  const own = t.user_id === user.id;
  const assigned = t.assigned_to === user.id;
  if (!own && !seesAll(user) && !(isStaff(user) && (assigned || !t.assigned_to))) throw notFound("Ticket");
  return { t, own, assigned, staffView: !own && isStaff(user) };
};

// Case context for staff: only the booking facts needed to investigate, never
// phone numbers or emails. Unassigned tickets show none until claimed.
const caseContext = async (user, t) => {
  if (!t.booking_id || !(seesAll(user) || t.assigned_to === user.id)) return null;
  const c = await db.one(
    `SELECT b.id, b.status, b.seats, b.total_paise, b.pickup_label, b.dropoff_label, b.requested_at, b.cancelled_at, b.cancel_reason,
            r.id AS ride_id, r.origin_label, r.destination_label, r.departure_at, r.status AS ride_status,
            split_part(coalesce(dp.full_name, 'Driver'), ' ', 1) AS driver_first_name,
            split_part(coalesce(pp.full_name, 'Passenger'), ' ', 1) AS passenger_first_name,
            (SELECT json_agg(json_build_object('status', p.status, 'amountPaise', p.amount_paise, 'refundedPaise', p.refunded_paise, 'provider', p.provider))
               FROM payments p WHERE p.booking_id = b.id) AS payments,
            (SELECT json_agg(json_build_object('to', e.to_status, 'by', e.actor_role, 'reason', e.reason, 'at', e.created_at) ORDER BY e.id)
               FROM booking_events e WHERE e.booking_id = b.id) AS events
       FROM bookings b JOIN rides r ON r.id = b.ride_id
       LEFT JOIN user_profiles dp ON dp.user_id = r.driver_id LEFT JOIN user_profiles pp ON pp.user_id = b.passenger_id
      WHERE b.id = $1`,
    [t.booking_id]
  );
  await audit({ actor: user, action: "support.case_context.view", entityType: "support_ticket", entityId: t.id });
  return c;
};

export const getTicket = async (user, id) => {
  const { t, staffView } = await loadTicket(user, id);
  const messages = await db.many(
    `SELECT m.id, m.body, m.internal, m.created_at, m.author_id = $2 AS mine,
            CASE WHEN m.author_id = t.user_id THEN 'member' ELSE 'support' END AS author_role
       FROM support_ticket_messages m JOIN support_tickets t ON t.id = m.ticket_id
      WHERE m.ticket_id = $1 AND ($3 OR NOT m.internal) ORDER BY m.created_at`,
    [id, user.id, staffView]
  );
  return {
    id: t.id,
    category: t.category,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    escalated: t.escalated,
    escalationReason: staffView ? t.escalation_reason : null,
    assignedToMe: t.assigned_to === user.id,
    assigned: Boolean(t.assigned_to),
    bookingId: t.booking_id,
    safetyReportId: staffView ? t.safety_report_id : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages,
    context: staffView ? await caseContext(user, t) : null,
  };
};

export const myTickets = (user) =>
  db.many("SELECT id, category, subject, status, priority, created_at, updated_at FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50", [user.id]);

export const queue = async (user, query) => {
  const q = parse(z.object({ view: z.enum(["mine", "unassigned", "escalated", "all"]).default("mine"), status: z.string().optional() }), query);
  if (q.view === "all" && !seesAll(user)) throw forbidden();
  const where = {
    mine: "t.assigned_to = $1",
    unassigned: "t.assigned_to IS NULL",
    escalated: seesAll(user) ? "t.escalated" : "t.escalated AND (t.assigned_to = $1 OR t.assigned_to IS NULL)",
    all: "true",
  }[q.view];
  return db.many(
    `SELECT t.id, t.category, t.subject, t.status, t.priority, t.escalated, t.created_at, t.updated_at, t.assigned_to = $1 AS assigned_to_me,
            t.assigned_to IS NOT NULL AS assigned
       FROM support_tickets t
      WHERE ${where} AND ($2::text IS NULL OR t.status = $2) AND t.status <> 'closed'
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at
      LIMIT 100`,
    [user.id, q.status || null]
  );
};

export const reply = async (user, id, body) => {
  const input = parse(z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) }), body);
  const { t, own, staffView } = await loadTicket(user, id);
  if (input.internal && !staffView) throw forbidden("Only support staff can add internal notes.");
  if (staffView && !own && t.assigned_to !== user.id && !seesAll(user)) throw forbidden("Assign the ticket to yourself first.");
  if (t.status === "closed") throw conflict("closed", "This ticket is closed. Open a new one if you still need help.");
  const m = await db.one(
    "INSERT INTO support_ticket_messages (ticket_id, author_id, body, internal) VALUES ($1, $2, $3, $4) RETURNING id, body, internal, created_at",
    [id, user.id, input.body, input.internal]
  );
  const nextStatus = own ? (t.status === "waiting_on_user" ? "in_progress" : t.status) : input.internal ? t.status : "waiting_on_user";
  await db.query("UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1", [id, nextStatus]);
  if (!own && !input.internal) {
    await notify([t.user_id], { type: "support.updated", title: "Support replied", body: `New reply on "${t.subject}".`, data: { ticketId: id } });
  }
  if (staffView) await audit({ actor: user, action: input.internal ? "support.note" : "support.reply", entityType: "support_ticket", entityId: id });
  return m;
};

export const assign = async (user, id, body) => {
  const input = parse(z.object({ assigneeId: z.string().uuid().nullable().optional() }), body || {});
  const target = input.assigneeId === undefined ? user.id : input.assigneeId;
  if (target !== user.id && !user.permissions.includes("support.tickets.assign")) throw forbidden("Only admins can assign tickets to someone else.");
  if (target) {
    const staff = await db.one("SELECT 1 FROM user_roles WHERE user_id = $1 AND role IN ('support','admin')", [target]);
    if (!staff) throw badRequest("Tickets can only be assigned to support staff.");
  }
  const r = await db.one(
    "UPDATE support_tickets SET assigned_to = $2, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = now() WHERE id = $1 RETURNING id",
    [id, target]
  );
  if (!r) throw notFound("Ticket");
  await audit({ actor: user, action: "support.assign", entityType: "support_ticket", entityId: id, details: { assigneeId: target } });
  return getTicket(user, id);
};

export const setStatus = async (user, id, body) => {
  const input = parse(z.object({ status: z.enum(["open", "in_progress", "waiting_on_user", "resolved", "closed"]) }), body);
  const { t, own, staffView } = await loadTicket(user, id);
  if (own && !staffView && !["resolved", "closed"].includes(input.status)) throw forbidden("You can mark your ticket as resolved or closed.");
  if (staffView && t.assigned_to !== user.id && !seesAll(user)) throw forbidden("Assign the ticket to yourself first.");
  await db.query("UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1", [id, input.status]);
  if (staffView) {
    await audit({ actor: user, action: "support.status", entityType: "support_ticket", entityId: id, details: input });
    if (input.status === "resolved") await notify([t.user_id], { type: "support.updated", title: "Ticket resolved", body: `"${t.subject}" was marked resolved.`, data: { ticketId: id } });
  }
  return getTicket(user, id);
};

export const escalate = async (user, id, body) => {
  const input = parse(z.object({ reason: z.string().trim().min(5).max(300), kind: z.enum(["safety", "payment", "other"]) }), body);
  const { t } = await loadTicket(user, id);
  if (!user.permissions.includes("support.tickets.escalate")) throw forbidden();
  await db.query(
    "UPDATE support_tickets SET escalated = true, escalation_reason = $2, priority = 'urgent', updated_at = now() WHERE id = $1",
    [id, `${input.kind}: ${input.reason}`]
  );
  await audit({ actor: user, action: "support.escalate", entityType: "support_ticket", entityId: id, details: input });
  const admins = await db.many("SELECT user_id FROM user_roles WHERE role = 'admin'");
  await notify(admins.map((a) => a.user_id), { type: "support.escalated", title: "Ticket escalated", body: `${input.kind} escalation on "${t.subject}": ${input.reason}`, data: { ticketId: id } });
  return getTicket(user, id);
};
