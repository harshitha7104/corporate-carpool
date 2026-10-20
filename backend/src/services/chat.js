import { z } from "zod";
import { db } from "../db/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rateLimit.js";
import { parse } from "../lib/validate.js";
import { hub } from "../realtime/hub.js";
import { notify } from "./notifications.js";
import { getSetting } from "./settings.js";

// Chat is scoped to one booking between its passenger and driver, so nobody
// needs to share a phone number. It stays open while the booking is live and
// for 7 days after it ends.
const conversationFor = async (user, conversationId) => {
  const c = await db.one(
    `SELECT c.id, b.id AS booking_id, b.status, b.passenger_id, b.updated_at, r.driver_id, r.origin_label, r.destination_label
       FROM conversations c JOIN bookings b ON b.id = c.booking_id JOIN rides r ON r.id = b.ride_id WHERE c.id = $1`,
    [conversationId]
  );
  if (!c || (c.passenger_id !== user.id && c.driver_id !== user.id)) throw notFound("Conversation");
  return { ...c, otherId: c.passenger_id === user.id ? c.driver_id : c.passenger_id };
};

const isOpen = (c) =>
  ["REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "DISPUTED"].includes(c.status) ||
  Date.now() - new Date(c.updated_at).getTime() < 7 * 86400000;

export const listConversations = (user) =>
  db.many(
    `SELECT c.id, b.id AS booking_id, b.status AS booking_status, r.origin_label, r.destination_label, r.departure_at,
            CASE WHEN b.passenger_id = $1 THEN coalesce(dp.full_name, 'Driver') ELSE coalesce(pp.full_name, 'Passenger') END AS other_name,
            (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_at,
            (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
       FROM conversations c JOIN bookings b ON b.id = c.booking_id JOIN rides r ON r.id = b.ride_id
       LEFT JOIN user_profiles dp ON dp.user_id = r.driver_id LEFT JOIN user_profiles pp ON pp.user_id = b.passenger_id
      WHERE b.passenger_id = $1 OR r.driver_id = $1
      ORDER BY coalesce((SELECT max(created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at) DESC
      LIMIT 50`,
    [user.id]
  );

export const getMessages = async (user, conversationId) => {
  const c = await conversationFor(user, conversationId);
  await db.query("UPDATE messages SET read_at = now() WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL", [conversationId, user.id]);
  const messages = await db.many(
    "SELECT id, sender_id, body, created_at, read_at FROM messages WHERE conversation_id = $1 ORDER BY created_at LIMIT 500",
    [conversationId]
  );
  return { conversation: { id: c.id, bookingId: c.booking_id, bookingStatus: c.status, open: isOpen(c), title: `${c.origin_label} to ${c.destination_label}` }, messages };
};

export const sendMessage = async (user, conversationId, body) => {
  if (!(await getSetting("features")).chat) throw conflict("chat_disabled", "Messaging is turned off right now.");
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(1000) }), body);
  enforce(`chat:${user.id}`, 30, 60000, "You are sending messages too quickly.");
  const c = await conversationFor(user, conversationId);
  if (!isOpen(c)) throw conflict("closed", "This conversation has closed.");
  const m = await db.one(
    "INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, sender_id, body, created_at",
    [conversationId, user.id, text]
  );
  hub.toUser(c.otherId, "message", { conversationId, message: m });
  hub.toUser(user.id, "message", { conversationId, message: m });
  // A notification only when the other person is not connected right now.
  if (!hub.listeners(`user:${c.otherId}`)) {
    await notify([c.otherId], { type: "message.received", title: "New message", body: text.slice(0, 120), data: { conversationId, bookingId: c.booking_id } });
  }
  return m;
};
