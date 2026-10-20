import { conflict } from "../lib/errors.js";

// The one place that says which booking transitions are legal and who may
// make them. Every status change goes through transition() below.
export const TRANSITIONS = {
  REQUESTED: { ACCEPTED: ["driver", "system"], REJECTED: ["driver"], CANCELLED_BY_PASSENGER: ["passenger"], CANCELLED_BY_DRIVER: ["driver", "system"], EXPIRED: ["system"] },
  ACCEPTED: { CONFIRMED: ["system"], CANCELLED_BY_PASSENGER: ["passenger"], CANCELLED_BY_DRIVER: ["driver", "system"], EXPIRED: ["system"] },
  CONFIRMED: { IN_PROGRESS: ["driver"], CANCELLED_BY_PASSENGER: ["passenger"], CANCELLED_BY_DRIVER: ["driver", "system"], NO_SHOW: ["driver"] },
  IN_PROGRESS: { COMPLETED: ["driver", "system"], DISPUTED: ["passenger", "driver"] },
  COMPLETED: { DISPUTED: ["passenger", "driver"] },
  NO_SHOW: { DISPUTED: ["passenger"] },
  DISPUTED: { COMPLETED: ["admin"], NO_SHOW: ["admin"], CANCELLED_BY_DRIVER: ["admin"] },
  REJECTED: {},
  CANCELLED_BY_PASSENGER: {},
  CANCELLED_BY_DRIVER: {},
  EXPIRED: {},
};

export const ACTIVE = ["REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS"];
const RELEASES_SEATS = new Set(["REJECTED", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_DRIVER", "EXPIRED", "NO_SHOW"]);
const HOLDS_SEATS = new Set(["ACCEPTED"]);

const TIMESTAMP = {
  ACCEPTED: "accepted_at",
  CONFIRMED: "confirmed_at",
  IN_PROGRESS: "started_at",
  COMPLETED: "completed_at",
  REJECTED: "cancelled_at",
  CANCELLED_BY_PASSENGER: "cancelled_at",
  CANCELLED_BY_DRIVER: "cancelled_at",
  EXPIRED: "cancelled_at",
  NO_SHOW: "cancelled_at",
};

export const canTransition = (from, to, role) => (TRANSITIONS[from]?.[to] || []).includes(role);

// Change a booking's status inside a transaction `t`. The caller must already
// hold the ride's seat_inventory row lock (SELECT ... FOR UPDATE) when the
// change can hold or release seats. Returns the updated booking row.
export const transition = async (t, booking, to, { role, actorId = null, reason = null, expiresAt } = {}) => {
  if (!canTransition(booking.status, to, role)) {
    throw conflict("invalid_transition", `This booking is ${booking.status.toLowerCase().replace(/_/g, " ")} and cannot change to ${to.toLowerCase().replace(/_/g, " ")}.`);
  }
  let seatsHeld = booking.seats_held;
  if (HOLDS_SEATS.has(to) && !seatsHeld) {
    const inv = await t.one(
      `UPDATE seat_inventory SET seats_reserved = seats_reserved + $2, updated_at = now()
        WHERE ride_id = $1 AND seats_total - seats_reserved >= $2 RETURNING seats_reserved`,
      [booking.ride_id, booking.seats]
    );
    if (!inv) throw conflict("seats_unavailable", "There are not enough seats left on this ride.");
    seatsHeld = true;
  }
  if (RELEASES_SEATS.has(to) && seatsHeld) {
    await t.query(
      "UPDATE seat_inventory SET seats_reserved = seats_reserved - $2, updated_at = now() WHERE ride_id = $1",
      [booking.ride_id, booking.seats]
    );
    seatsHeld = false;
  }
  const stamp = TIMESTAMP[to];
  const updated = await t.one(
    `UPDATE bookings SET status = $2, seats_held = $3, updated_at = now(),
        ${stamp ? `${stamp} = now(),` : ""}
        cancel_reason = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE cancel_reason END,
        expires_at = $5
      WHERE id = $1 RETURNING *`,
    [booking.id, to, seatsHeld, reason, expiresAt === undefined ? (ACTIVE.includes(to) ? booking.expires_at : null) : expiresAt]
  );
  await t.query(
    "INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, actor_role, reason) VALUES ($1, $2, $3, $4, $5, $6)",
    [booking.id, booking.status, to, actorId, role, reason]
  );
  return updated;
};
