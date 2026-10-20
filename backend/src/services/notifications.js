import { db, using } from "../db/index.js";
import { hub } from "../realtime/hub.js";
import { emailProvider, smsProvider, whatsappProvider } from "../providers/messaging.js";
import { logger } from "../lib/logger.js";
import { notFound } from "../lib/errors.js";

// Events worth an SMS as well as in-app and email. Everything else stays
// in-app and email so commuters are not flooded with texts.
const SMS_EVENTS = new Set([
  "booking.request_received",
  "booking.accepted",
  "booking.confirmed",
  "booking.cancelled",
  "ride.cancelled",
  "ride.reminder",
  "ride.started",
  "safety.alert",
]);

const MAX_ATTEMPTS = 5;

// The channel senders; tests replace them to exercise retries.
export const deliveryProviders = {
  email: (d) => emailProvider.send(d.email, d.title, d.body),
  sms: (d) => smsProvider.send(d.phone, `${d.title}: ${d.body}`),
  whatsapp: (d) => whatsappProvider.send(d.phone, d.body),
};

// Create in-app notifications plus pending email/SMS deliveries, then push
// to any connected sockets. Call after the business transaction commits.
export const notify = async (userIds, { type, title, body, data = {} }, client) => {
  const unique = [...new Set(userIds.filter(Boolean))];
  const created = [];
  for (const userId of unique) {
    const n = await using(client).one(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, type, title, body, data]
    );
    const u = await using(client).one(
      `SELECT u.phone, u.email, u.status, p.notify_email, p.notify_sms, p.notify_whatsapp
         FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = $1`,
      [userId]
    );
    if (u && u.status === "active") {
      const channels = [];
      if (u.email && u.notify_email !== false) channels.push(["email", emailProvider.name]);
      if (u.phone && u.notify_sms !== false && SMS_EVENTS.has(type)) channels.push(["sms", smsProvider.name]);
      if (u.phone && u.notify_whatsapp && SMS_EVENTS.has(type)) channels.push(["whatsapp", "none"]);
      for (const [channel, provider] of channels) {
        await using(client).query(
          `INSERT INTO notification_deliveries (notification_id, channel, provider, next_attempt_at) VALUES ($1, $2, $3, now())`,
          [n.id, channel, provider]
        );
      }
    }
    created.push(n);
    hub.toUser(userId, "notification", { id: n.id, type, title, body, data, createdAt: n.created_at });
  }
  return created;
};

// Worker step: send pending deliveries, with exponential backoff on failure.
export const processDeliveries = async (limit = 25) => {
  const rows = await db.tx((t) =>
    t.many(
      `SELECT d.*, n.title, n.body, u.phone, u.email
         FROM notification_deliveries d
         JOIN notifications n ON n.id = d.notification_id
         JOIN users u ON u.id = n.user_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= now()
        ORDER BY d.next_attempt_at
        LIMIT $1
        FOR UPDATE OF d SKIP LOCKED`,
      [limit]
    ).then(async (list) => {
      if (list.length) {
        await t.query("UPDATE notification_deliveries SET next_attempt_at = now() + interval '2 minutes' WHERE id = ANY($1)", [list.map((r) => r.id)]);
      }
      return list;
    })
  );

  let sent = 0;
  for (const d of rows) {
    let result;
    try {
      result = await deliveryProviders[d.channel](d);
    } catch (err) {
      result = { status: "failed", error: err.message };
    }
    const attempts = d.attempts + 1;
    if (result.status === "failed" && attempts < MAX_ATTEMPTS) {
      const backoffMin = 2 ** attempts;
      await db.query(
        `UPDATE notification_deliveries SET attempts = $2, last_error = $3, next_attempt_at = now() + make_interval(mins => $4) WHERE id = $1`,
        [d.id, attempts, result.error || "unknown error", backoffMin]
      );
    } else {
      await db.query(
        `UPDATE notification_deliveries SET status = $2, attempts = $3, last_error = $4, sent_at = CASE WHEN $2 = 'sent' THEN now() END WHERE id = $1`,
        [d.id, result.status, attempts, result.error || null]
      );
      if (result.status === "sent") sent += 1;
      if (result.status === "failed") logger.warn("Notification delivery failed permanently", { deliveryId: d.id, error: result.error });
    }
  }
  return { processed: rows.length, sent };
};

export const listNotifications = async (userId, { limit, offset, unreadOnly }) => {
  const items = await db.many(
    `SELECT id, type, title, body, data, read_at, created_at FROM notifications
      WHERE user_id = $1 AND ($4::boolean IS NOT TRUE OR read_at IS NULL)
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset, unreadOnly]
  );
  const { unread } = await db.one("SELECT count(*) AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return { items, unread };
};

export const deliveriesFor = async (userId, notificationId) => {
  const n = await db.one("SELECT id FROM notifications WHERE id = $1 AND user_id = $2", [notificationId, userId]);
  if (!n) throw notFound("Notification");
  return db.many("SELECT channel, provider, status, attempts, last_error, sent_at FROM notification_deliveries WHERE notification_id = $1", [notificationId]);
};

export const markRead = async (userId, ids) => {
  if (ids === "all") {
    await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
  } else {
    await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL", [userId, ids]);
  }
};
