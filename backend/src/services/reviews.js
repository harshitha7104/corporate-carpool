import { z } from "zod";
import { db } from "../db/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { notify } from "./notifications.js";

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

// Each side of a completed booking may review the other once, within 14 days.
export const submitReview = async (user, bookingId, body) => {
  const input = parse(reviewSchema, body);
  const b = await db.one(
    "SELECT b.*, r.driver_id FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1",
    [bookingId]
  );
  if (!b || (b.passenger_id !== user.id && b.driver_id !== user.id)) throw notFound("Booking");
  if (b.status !== "COMPLETED") throw conflict("not_completed", "You can review a trip after it is completed.");
  if (Date.now() - new Date(b.completed_at).getTime() > 14 * 86400000) throw conflict("too_late", "Reviews close 14 days after the trip.");
  const reviewee = user.id === b.passenger_id ? b.driver_id : b.passenger_id;
  try {
    const review = await db.one(
      `INSERT INTO reviews (booking_id, ride_id, reviewer_id, reviewee_id, rating, comment, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, rating, comment, created_at`,
      [bookingId, b.ride_id, user.id, reviewee, input.rating, input.comment || null, b.is_demo]
    );
    await notify([reviewee], { type: "review.received", title: "New review", body: `You received a ${input.rating}-star review.`, data: { bookingId } });
    return review;
  } catch (err) {
    if (err.code === "23505") throw conflict("already_reviewed", "You have already reviewed this trip.");
    throw err;
  }
};

export const reviewsFor = async (userId, { limit, offset }) => {
  const items = await db.many(
    `SELECT rv.rating, rv.comment, rv.created_at, rv.is_demo,
            CASE WHEN rv.reviewer_id = r.driver_id THEN 'driver' ELSE 'passenger' END AS reviewer_role,
            split_part(coalesce(p.full_name, 'Member'), ' ', 1) AS reviewer_first_name
       FROM reviews rv JOIN rides r ON r.id = rv.ride_id LEFT JOIN user_profiles p ON p.user_id = rv.reviewer_id
      WHERE rv.reviewee_id = $1 ORDER BY rv.created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const summary = await db.one(
    "SELECT round(avg(rating)::numeric, 1)::float AS average, count(*) AS count FROM reviews WHERE reviewee_id = $1",
    [userId]
  );
  return { summary: { average: summary.count ? summary.average : null, count: summary.count }, items };
};

export const reviewsWritten = (user, { limit, offset }) =>
  db.many(
    `SELECT rv.booking_id, rv.rating, rv.comment, rv.created_at, r.origin_label, r.destination_label, r.departure_at
       FROM reviews rv JOIN rides r ON r.id = rv.ride_id WHERE rv.reviewer_id = $1 ORDER BY rv.created_at DESC LIMIT $2 OFFSET $3`,
    [user.id, limit, offset]
  );

// Completed bookings the person has not reviewed yet.
export const pendingReviews = (user) =>
  db.many(
    `SELECT b.id AS booking_id, r.origin_label, r.destination_label, r.departure_at,
            CASE WHEN b.passenger_id = $1 THEN 'driver' ELSE 'passenger' END AS review_of
       FROM bookings b JOIN rides r ON r.id = b.ride_id
      WHERE b.status = 'COMPLETED' AND b.completed_at > now() - interval '14 days'
        AND (b.passenger_id = $1 OR r.driver_id = $1)
        AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.booking_id = b.id AND rv.reviewer_id = $1)
      ORDER BY b.completed_at DESC LIMIT 20`,
    [user.id]
  );
