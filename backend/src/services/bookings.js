import { z } from "zod";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parse, point } from "../lib/validate.js";
import { hub } from "../realtime/hub.js";
import { ACTIVE, transition } from "./bookingState.js";
import { evaluateFit } from "./matching.js";
import { notify } from "./notifications.js";
import { processRefund, queueRefund } from "./payments.js";
import { platformFee, refundFor } from "./pricing.js";
import { getSettings } from "./settings.js";
import { isBlockedEitherWay, publicProfile } from "./users.js";

const createSchema = z.object({
  seats: z.number().int().min(1).max(6),
  pickup: point,
  dropoff: point,
  message: z.string().trim().max(300).optional(),
});

const rideSummary = (r) => `${r.origin_label} to ${r.destination_label}`;

const lockRide = async (t, rideId) => {
  const inv = await t.one("SELECT * FROM seat_inventory WHERE ride_id = $1 FOR UPDATE", [rideId]);
  if (!inv) throw notFound("Ride");
  const ride = await t.one("SELECT * FROM rides WHERE id = $1", [rideId]);
  return { inv, ride };
};

const lockBooking = async (t, bookingId) => {
  const ref = await t.one("SELECT ride_id FROM bookings WHERE id = $1", [bookingId]);
  if (!ref) throw notFound("Booking");
  const { inv, ride } = await lockRide(t, ref.ride_id);
  const booking = await t.one("SELECT * FROM bookings WHERE id = $1 FOR UPDATE", [bookingId]);
  return { inv, ride, booking };
};

const pushBookingUpdate = (booking, ride) => {
  const data = { bookingId: booking.id, rideId: booking.ride_id, status: booking.status };
  hub.toUser(booking.passenger_id, "booking.updated", data);
  hub.toUser(ride.driver_id, "booking.updated", data);
  hub.toRide(booking.ride_id, "booking.updated", data);
};

// ---- Create ---------------------------------------------------------------------------
export const createBooking = async (user, rideId, body, idempotencyKey) => {
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw badRequest("Missing or invalid Idempotency-Key header.");
  const input = parse(createSchema, body);
  const settings = await getSettings();

  // A retried request with the same key returns the original booking.
  const prior = await db.one("SELECT * FROM bookings WHERE passenger_id = $1 AND idempotency_key = $2", [user.id, idempotencyKey]);
  if (prior) {
    if (prior.ride_id !== rideId) throw conflict("idempotency_conflict", "This Idempotency-Key was used for a different ride.");
    return { booking: await getBooking(user, prior.id), replayed: true };
  }
  if (input.seats > settings.booking.max_seats_per_booking) throw badRequest(`You can book up to ${settings.booking.max_seats_per_booking} seats at once.`);

  const profile = await db.one("SELECT full_name, gender FROM user_profiles WHERE user_id = $1", [user.id]);
  if (!profile) throw badRequest("Add your name to your profile before booking.");

  let result;
  try {
    result = await db.tx(async (t) => {
      const { inv, ride } = await lockRide(t, rideId);
      if (ride.status !== "published") throw conflict("ride_closed", "This ride is not taking bookings.");
      if (ride.driver_id === user.id) throw badRequest("You cannot book your own ride.");
      const closesAt = new Date(ride.departure_at).getTime() - ride.booking_cutoff_minutes * 60000;
      if (Date.now() > closesAt) throw conflict("booking_closed", "Booking has closed for this ride.");
      if (await isBlockedEitherWay(user.id, ride.driver_id, t)) throw notFound("Ride");
      if (ride.women_only && profile.gender !== "female") throw forbidden("This ride is for women passengers only (based on the gender in your profile).");
      if (inv.seats_total - inv.seats_reserved < input.seats) throw conflict("seats_unavailable", "There are not enough seats left on this ride.");

      const fit = evaluateFit({ route: ride.route_geometry, pickup: input.pickup, dropoff: input.dropoff, matching: settings.matching });
      if (!fit.compatible) {
        throw badRequest("Your pickup and drop-off need to be along this ride's route, in the direction it travels.", { reasons: fit.reasons });
      }
      const contribution = ride.price_per_seat_paise * input.seats;
      const fee = await platformFee(contribution, t);
      const pickupEta = new Date(new Date(ride.departure_at).getTime() + fit.pickupFraction * ride.duration_s * 1000);
      const requestExpiry = new Date(Math.min(Date.now() + settings.booking.request_expiry_minutes * 60000, closesAt));

      let booking = await t.one(
        `INSERT INTO bookings (ride_id, passenger_id, seats, status, pickup_label, pickup_lat, pickup_lng,
            dropoff_label, dropoff_lat, dropoff_lng, pickup_eta_at, detour_m, contribution_paise, platform_fee_paise,
            total_paise, message, idempotency_key, expires_at, is_demo)
         VALUES ($1, $2, $3, 'REQUESTED', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
        [rideId, user.id, input.seats, input.pickup.label, input.pickup.lat, input.pickup.lng,
          input.dropoff.label, input.dropoff.lat, input.dropoff.lng, pickupEta, fit.detourM, contribution, fee,
          contribution + fee, input.message || null, idempotencyKey, requestExpiry, ride.is_demo]
      );
      await t.query(
        "INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, actor_role, reason) VALUES ($1, NULL, 'REQUESTED', $2, 'passenger', NULL)",
        [booking.id, user.id]
      );
      await t.query("INSERT INTO conversations (booking_id) VALUES ($1)", [booking.id]);

      if (ride.booking_mode === "instant") {
        booking = await transition(t, booking, "ACCEPTED", { role: "system", reason: "instant booking", expiresAt: paymentDeadline(settings, ride) });
        if (booking.total_paise === 0) booking = await transition(t, booking, "CONFIRMED", { role: "system", reason: "no payment due", expiresAt: null });
      }
      return { booking, ride };
    });
  } catch (err) {
    if (err.code === "23505" && /bookings_one_active_idx/.test(err.constraint || err.message)) {
      throw conflict("already_booked", "You already have an active booking on this ride.");
    }
    if (err.code === "23505" && /idempotency/.test(err.constraint || "")) {
      const again = await db.one("SELECT id FROM bookings WHERE passenger_id = $1 AND idempotency_key = $2", [user.id, idempotencyKey]);
      return { booking: await getBooking(user, again.id), replayed: true };
    }
    throw err;
  }

  const { booking, ride } = result;
  const name = profile.full_name.split(" ")[0];
  if (booking.status === "REQUESTED") {
    await notify([ride.driver_id], { type: "booking.request_received", title: "New booking request", body: `${name} asked for ${booking.seats} seat${booking.seats > 1 ? "s" : ""} on ${rideSummary(ride)}.`, data: { bookingId: booking.id, rideId } });
  } else {
    await notify([ride.driver_id], { type: "booking.instant", title: "New passenger", body: `${name} booked ${booking.seats} seat${booking.seats > 1 ? "s" : ""} on ${rideSummary(ride)}.`, data: { bookingId: booking.id, rideId } });
    if (booking.status === "CONFIRMED") {
      await notify([user.id], { type: "booking.confirmed", title: "Booking confirmed", body: `Your seat on ${rideSummary(ride)} is confirmed.`, data: { bookingId: booking.id, rideId } });
    }
  }
  pushBookingUpdate(booking, ride);
  return { booking: await getBooking(user, booking.id), replayed: false };
};

const paymentDeadline = (settings, ride) =>
  new Date(Math.min(Date.now() + settings.booking.payment_window_minutes * 60000, new Date(ride.departure_at).getTime()));

// ---- Driver decisions --------------------------------------------------------------------
const assertDriver = (user, ride) => {
  if (ride.driver_id !== user.id) throw notFound("Booking");
};

export const acceptBooking = async (user, bookingId) => {
  const settings = await getSettings();
  const { booking, ride } = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    assertDriver(user, r);
    if (b.status === "REQUESTED" && b.expires_at && new Date(b.expires_at) < new Date()) {
      await transition(t, b, "EXPIRED", { role: "system", reason: "request expired" });
      return { expired: true, booking: b, ride: r };
    }
    let next = await transition(t, b, "ACCEPTED", { role: "driver", actorId: user.id, expiresAt: paymentDeadline(settings, r) });
    if (next.total_paise === 0) next = await transition(t, next, "CONFIRMED", { role: "system", reason: "no payment due", expiresAt: null });
    return { booking: next, ride: r };
  }).then((res) => {
    if (res.expired) throw conflict("expired", "This request has expired.");
    return res;
  });
  const due = booking.status === "ACCEPTED" ? ` Pay Rs ${booking.total_paise / 100} to confirm your seat.` : "";
  await notify([booking.passenger_id], { type: "booking.accepted", title: "Request accepted", body: `Your request for ${rideSummary(ride)} was accepted.${due}`, data: { bookingId, rideId: ride.id } });
  pushBookingUpdate(booking, ride);
  return getBooking(user, bookingId);
};

export const rejectBooking = async (user, bookingId, body) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), body || {});
  const { booking, ride } = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    assertDriver(user, r);
    return { booking: await transition(t, b, "REJECTED", { role: "driver", actorId: user.id, reason: reason || null }), ride: r };
  });
  await notify([booking.passenger_id], { type: "booking.rejected", title: "Request declined", body: `The driver could not take your request for ${rideSummary(ride)}. Try another ride.`, data: { bookingId, rideId: ride.id } });
  pushBookingUpdate(booking, ride);
  return getBooking(user, bookingId);
};

// ---- Cancellations ------------------------------------------------------------------------
const paidAmount = async (t, bookingId) =>
  (await t.one("SELECT coalesce(sum(amount_paise - refunded_paise), 0)::int AS s FROM payments WHERE booking_id = $1 AND status IN ('captured','partially_refunded')", [bookingId])).s;

export const cancelByPassenger = async (user, bookingId, body) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), body || {});
  const out = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    if (b.passenger_id !== user.id) throw notFound("Booking");
    if (r.status === "in_progress" || r.status === "completed") throw conflict("ride_started", "The ride has already started.");
    const paid = await paidAmount(t, b.id);
    const policy = await refundFor({ paidPaise: paid, departureAt: r.departure_at, cancelledBy: "passenger" }, t);
    const next = await transition(t, b, "CANCELLED_BY_PASSENGER", { role: "passenger", actorId: user.id, reason: reason || null });
    const refundId = await queueRefund(t, b.id, policy.refundPaise, `Passenger cancelled: ${policy.rule}`);
    return { booking: next, ride: r, refundId, policy, paid };
  });
  if (out.refundId) await processRefund(out.refundId);
  await notify([out.ride.driver_id], { type: "booking.cancelled", title: "Passenger cancelled", body: `A passenger cancelled their seat on ${rideSummary(out.ride)}.`, data: { bookingId, rideId: out.ride.id } });
  pushBookingUpdate(out.booking, out.ride);
  return { booking: await getBooking(user, bookingId), refund: { amountPaise: out.refundId ? out.policy.refundPaise : 0, rule: out.policy.rule } };
};

export const cancelByDriver = async (user, bookingId, body) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Tell the passenger why.").max(300) }), body || {});
  const out = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    assertDriver(user, r);
    const paid = await paidAmount(t, b.id);
    const policy = await refundFor({ paidPaise: paid, departureAt: r.departure_at, cancelledBy: "driver" }, t);
    const next = await transition(t, b, "CANCELLED_BY_DRIVER", { role: "driver", actorId: user.id, reason });
    const refundId = await queueRefund(t, b.id, policy.refundPaise, `Driver cancelled: ${policy.rule}`);
    return { booking: next, ride: r, refundId };
  });
  if (out.refundId) await processRefund(out.refundId);
  await notify([out.booking.passenger_id], { type: "booking.cancelled", title: "Booking cancelled by driver", body: `Your seat on ${rideSummary(out.ride)} was cancelled: ${reason}. Any payment is refunded in full.`, data: { bookingId, rideId: out.ride.id } });
  pushBookingUpdate(out.booking, out.ride);
  return getBooking(user, bookingId);
};

// ---- Ride day -------------------------------------------------------------------------------
export const startRide = async (user, rideId, body) => {
  const { shareLocation } = parse(z.object({ shareLocation: z.boolean().default(false) }), body || {});
  const settings = await getSettings();
  const out = await db.tx(async (t) => {
    const { ride } = await lockRide(t, rideId);
    if (ride.driver_id !== user.id) throw notFound("Ride");
    if (ride.status !== "published") throw conflict("not_startable", "Only published rides can be started.");
    const minutesToGo = (new Date(ride.departure_at).getTime() - Date.now()) / 60000;
    if (minutesToGo > 60) throw conflict("too_early", "You can start the ride up to an hour before departure.");
    await t.query(
      "UPDATE rides SET status = 'in_progress', started_at = now(), location_sharing = $2, updated_at = now() WHERE id = $1",
      [rideId, shareLocation && settings.features.live_location]
    );
    // Requests nobody answered, and seats nobody paid for, lapse now.
    const lapsing = await t.many("SELECT * FROM bookings WHERE ride_id = $1 AND status IN ('REQUESTED','ACCEPTED') FOR UPDATE", [rideId]);
    for (const b of lapsing) await transition(t, b, "EXPIRED", { role: "system", reason: "ride started" });
    const riders = await t.many("SELECT passenger_id FROM bookings WHERE ride_id = $1 AND status = 'CONFIRMED'", [rideId]);
    await audit({ actor: user, action: "ride.start", entityType: "ride", entityId: rideId, details: { shareLocation }, client: t });
    return { ride, riders: riders.map((r) => r.passenger_id), lapsed: lapsing };
  });
  await notify(out.riders, { type: "ride.started", title: "Your ride has started", body: `The driver has started ${rideSummary(out.ride)}. Be at your pickup point on time.`, data: { rideId } });
  for (const b of out.lapsed) {
    await notify([b.passenger_id], { type: "booking.expired", title: "Booking expired", body: `Your unconfirmed booking on ${rideSummary(out.ride)} lapsed because the ride started.`, data: { bookingId: b.id, rideId } });
  }
  hub.toRide(rideId, "ride.status", { rideId, status: "in_progress" });
  return { rideId, status: "in_progress" };
};

const driverBookingStep = (to, { needsInProgressRide = true, notBefore } = {}) => async (user, bookingId) => {
  const out = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    assertDriver(user, r);
    if (needsInProgressRide && r.status !== "in_progress") throw conflict("ride_not_started", "Start the ride first.");
    if (notBefore === "departure" && Date.now() < new Date(r.departure_at).getTime()) {
      throw conflict("too_early", "You can mark a no-show only after the departure time.");
    }
    return { booking: await transition(t, b, to, { role: "driver", actorId: user.id }), ride: r };
  });
  const messages = {
    IN_PROGRESS: ["booking.picked_up", "Picked up", "Your driver marked you as picked up. Enjoy the ride."],
    COMPLETED: ["ride.completed", "Trip completed", "You have been dropped off. Rate your trip when you have a moment."],
    NO_SHOW: ["booking.no_show", "Marked as no-show", "The driver marked you as a no-show. If that is wrong, open a dispute from the booking."],
  }[to];
  await notify([out.booking.passenger_id], { type: messages[0], title: messages[1], body: messages[2], data: { bookingId, rideId: out.ride.id } });
  pushBookingUpdate(out.booking, out.ride);
  return getBooking(user, bookingId);
};

export const markPickedUp = driverBookingStep("IN_PROGRESS");
export const markNoShow = driverBookingStep("NO_SHOW", { notBefore: "departure" });
export const completeBooking = driverBookingStep("COMPLETED");

export const completeRide = async (user, rideId) => {
  const out = await db.tx(async (t) => {
    const { ride } = await lockRide(t, rideId);
    if (ride.driver_id !== user.id) throw notFound("Ride");
    if (ride.status !== "in_progress") throw conflict("not_in_progress", "Only a ride in progress can be completed.");
    const waiting = await t.one("SELECT count(*) FROM bookings WHERE ride_id = $1 AND status = 'CONFIRMED'", [rideId]);
    if (waiting.count > 0) throw conflict("unresolved_passengers", "Mark every confirmed passenger as picked up or no-show first.");
    const onboard = await t.many("SELECT * FROM bookings WHERE ride_id = $1 AND status = 'IN_PROGRESS' FOR UPDATE", [rideId]);
    for (const b of onboard) await transition(t, b, "COMPLETED", { role: "driver", actorId: user.id, reason: "ride completed" });
    // Live location stops with the trip.
    await t.query("UPDATE rides SET status = 'completed', completed_at = now(), location_sharing = false, updated_at = now() WHERE id = $1", [rideId]);
    await t.query("UPDATE trip_shares SET revoked_at = now() WHERE ride_id = $1 AND revoked_at IS NULL", [rideId]);
    await audit({ actor: user, action: "ride.complete", entityType: "ride", entityId: rideId, client: t });
    return { ride, onboard };
  });
  await notify(out.onboard.map((b) => b.passenger_id), { type: "ride.completed", title: "Trip completed", body: `You have arrived. Rate your trip on ${rideSummary(out.ride)}.`, data: { rideId } });
  hub.toRide(rideId, "ride.status", { rideId, status: "completed" });
  return { rideId, status: "completed" };
};

export const cancelRide = async (user, rideId, body, { asAdmin = false } = {}) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Tell your passengers why.").max(300) }), body || {});
  const out = await db.tx(async (t) => {
    const { ride } = await lockRide(t, rideId);
    if (!asAdmin && ride.driver_id !== user.id) throw notFound("Ride");
    if (!["draft", "published"].includes(ride.status)) throw conflict("not_cancellable", "This ride can no longer be cancelled.");
    const active = await t.many("SELECT * FROM bookings WHERE ride_id = $1 AND status = ANY($2) FOR UPDATE", [rideId, ACTIVE]);
    const refunds = [];
    for (const b of active) {
      const paid = await paidAmount(t, b.id);
      const policy = await refundFor({ paidPaise: paid, departureAt: ride.departure_at, cancelledBy: asAdmin ? "system" : "driver" }, t);
      await transition(t, b, "CANCELLED_BY_DRIVER", { role: asAdmin ? "system" : "driver", actorId: user.id, reason });
      const id = await queueRefund(t, b.id, policy.refundPaise, `Ride cancelled: ${policy.rule}`);
      if (id) refunds.push(id);
    }
    await t.query("UPDATE rides SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1", [rideId, reason]);
    await audit({ actor: user, action: asAdmin ? "admin.ride.cancel" : "ride.cancel", entityType: "ride", entityId: rideId, details: { reason, bookings: active.length }, client: t });
    return { ride, active, refunds };
  });
  for (const id of out.refunds) await processRefund(id);
  await notify(out.active.map((b) => b.passenger_id), { type: "ride.cancelled", title: "Ride cancelled", body: `${rideSummary(out.ride)} was cancelled: ${reason}. Any payment is refunded.`, data: { rideId } });
  hub.toRide(rideId, "ride.status", { rideId, status: "cancelled" });
  return { rideId, status: "cancelled", bookingsCancelled: out.active.length };
};

// ---- Disputes ----------------------------------------------------------------------------------
export const openDispute = async (user, bookingId, body) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(10, "Describe what happened (at least 10 characters).").max(1000) }), body);
  const out = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    const role = b.passenger_id === user.id ? "passenger" : r.driver_id === user.id ? "driver" : null;
    if (!role) throw notFound("Booking");
    const finishedAt = b.completed_at || b.cancelled_at;
    if (finishedAt && Date.now() - new Date(finishedAt).getTime() > 7 * 86400000) throw conflict("too_late", "Disputes must be opened within 7 days.");
    const next = await transition(t, b, "DISPUTED", { role, actorId: user.id, reason });
    const ticket = await t.one(
      `INSERT INTO support_tickets (user_id, category, subject, description, priority, booking_id, escalated, escalation_reason)
       VALUES ($1, 'payment', $2, $3, 'high', $4, true, 'Booking dispute') RETURNING id`,
      [user.id, `Dispute: ${r.origin_label} to ${r.destination_label}`, reason, bookingId]
    );
    return { booking: next, ride: r, ticketId: ticket.id, otherParty: role === "passenger" ? r.driver_id : b.passenger_id };
  });
  await notify([out.otherParty], { type: "booking.disputed", title: "Booking disputed", body: `A dispute was opened on ${rideSummary(out.ride)}. Green Way support will review it.`, data: { bookingId } });
  pushBookingUpdate(out.booking, out.ride);
  return { booking: await getBooking(user, bookingId), ticketId: out.ticketId };
};

export const resolveDispute = async (admin, bookingId, body) => {
  const input = parse(z.object({
    outcome: z.enum(["COMPLETED", "NO_SHOW", "CANCELLED_BY_DRIVER"]),
    refundPercent: z.number().int().min(0).max(100).default(0),
    note: z.string().trim().min(5).max(500),
  }), body);
  const out = await db.tx(async (t) => {
    const { booking: b, ride: r } = await lockBooking(t, bookingId);
    const next = await transition(t, b, input.outcome, { role: "admin", actorId: admin.id, reason: input.note });
    const paid = await paidAmount(t, b.id);
    const refundId = await queueRefund(t, b.id, Math.round((paid * input.refundPercent) / 100), `Dispute resolution: ${input.note}`, admin.id);
    await audit({ actor: admin, action: "dispute.resolve", entityType: "booking", entityId: bookingId, details: input, client: t });
    return { booking: next, ride: r, refundId };
  });
  if (out.refundId) await processRefund(out.refundId);
  await notify([out.booking.passenger_id, out.ride.driver_id], { type: "booking.dispute_resolved", title: "Dispute resolved", body: input.note, data: { bookingId } });
  return getBooking(admin, bookingId);
};

// ---- Reading ---------------------------------------------------------------------------------
const shapeBooking = async (b, viewer, ride) => {
  const isDriver = viewer.id === ride.driver_id;
  const events = await db.many("SELECT from_status, to_status, actor_role, reason, created_at FROM booking_events WHERE booking_id = $1 ORDER BY id", [b.id]);
  const payment = await db.one("SELECT id, status, provider, amount_paise, refunded_paise, receipt_number FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1", [b.id]);
  const conversation = await db.one("SELECT id FROM conversations WHERE booking_id = $1", [b.id]);
  const myReview = await db.one("SELECT rating, comment FROM reviews WHERE booking_id = $1 AND reviewer_id = $2", [b.id, viewer.id]);
  return {
    id: b.id,
    status: b.status,
    seats: b.seats,
    isDemo: b.is_demo,
    pickup: { label: b.pickup_label, lat: b.pickup_lat, lng: b.pickup_lng },
    dropoff: { label: b.dropoff_label, lat: b.dropoff_lat, lng: b.dropoff_lng },
    pickupEtaAt: b.pickup_eta_at,
    detourM: b.detour_m,
    contributionPaise: b.contribution_paise,
    platformFeePaise: b.platform_fee_paise,
    totalPaise: b.total_paise,
    message: b.message,
    expiresAt: b.expires_at,
    requestedAt: b.requested_at,
    acceptedAt: b.accepted_at,
    confirmedAt: b.confirmed_at,
    completedAt: b.completed_at,
    cancelledAt: b.cancelled_at,
    cancelReason: b.cancel_reason,
    events,
    payment: payment ? { id: payment.id, status: payment.status, provider: payment.provider, isSimulated: payment.provider === "simulated", amountPaise: payment.amount_paise, refundedPaise: payment.refunded_paise, receiptNumber: payment.receipt_number } : null,
    conversationId: conversation?.id || null,
    myReview: myReview || null,
    viewerRole: isDriver ? "driver" : viewer.id === b.passenger_id ? "passenger" : "staff",
    passenger: isDriver || viewer.id === b.passenger_id || viewer.permissions?.includes("admin.bookings.read") ? await publicProfile(b.passenger_id) : null,
    ride: {
      id: ride.id,
      status: ride.status,
      origin: ride.origin_label,
      destination: ride.destination_label,
      departureAt: ride.departure_at,
      estArrivalAt: ride.est_arrival_at,
      driver: await publicProfile(ride.driver_id),
      vehicle: ride.make ? { make: ride.make, model: ride.model, color: ride.color, plateNumber: ["ACCEPTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status) || isDriver ? ride.plate_number : null } : null,
      locationSharing: ride.location_sharing,
      routeIsEstimate: ride.route_source === "estimate",
    },
  };
};

const RIDE_JOIN = `SELECT r.*, v.make, v.model, v.color, v.plate_number FROM rides r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = $1`;

export const canSeeBooking = async (viewer, b, ride) => {
  if (viewer.id === b.passenger_id || viewer.id === ride.driver_id) return true;
  if (viewer.permissions?.includes("admin.bookings.read")) return true;
  if (viewer.permissions?.includes("support.case_context.read")) {
    return Boolean(await db.one("SELECT 1 FROM support_tickets WHERE booking_id = $1 AND assigned_to = $2", [b.id, viewer.id]));
  }
  return false;
};

export const getBooking = async (viewer, bookingId) => {
  const b = await db.one("SELECT * FROM bookings WHERE id = $1", [bookingId]);
  if (!b) throw notFound("Booking");
  const ride = await db.one(RIDE_JOIN, [b.ride_id]);
  if (!(await canSeeBooking(viewer, b, ride))) throw notFound("Booking");
  return shapeBooking(b, viewer, ride);
};

const listSchema = z.object({
  scope: z.enum(["pending", "upcoming", "active", "past", "all"]).default("upcoming"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listMyBookings = async (user, query) => {
  const q = parse(listSchema, query);
  const where = {
    pending: "b.status IN ('REQUESTED','ACCEPTED')",
    upcoming: "b.status IN ('REQUESTED','ACCEPTED','CONFIRMED') AND r.status IN ('published','draft')",
    active: "b.status IN ('CONFIRMED','IN_PROGRESS') AND r.status = 'in_progress'",
    past: "b.status NOT IN ('REQUESTED','ACCEPTED','CONFIRMED','IN_PROGRESS') OR r.status IN ('completed','cancelled')",
    all: "true",
  }[q.scope];
  const order = ["pending", "upcoming", "active"].includes(q.scope) ? "r.departure_at ASC" : "r.departure_at DESC";
  const rows = await db.many(
    `SELECT b.id FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.passenger_id = $1 AND (${where}) ORDER BY ${order} LIMIT $2 OFFSET $3`,
    [user.id, q.limit, q.offset]
  );
  return Promise.all(rows.map((r) => getBooking(user, r.id)));
};

export const listRideBookings = async (user, rideId) => {
  const ride = await db.one(RIDE_JOIN, [rideId]);
  if (!ride || (ride.driver_id !== user.id && !user.permissions.includes("admin.bookings.read"))) throw notFound("Ride");
  const rows = await db.many("SELECT * FROM bookings WHERE ride_id = $1 ORDER BY requested_at", [rideId]);
  return Promise.all(rows.map((b) => shapeBooking(b, user, ride)));
};

// ---- Worker steps ---------------------------------------------------------------------------------
export const expireBookings = async () => {
  const due = await db.many(
    "SELECT id FROM bookings WHERE status IN ('REQUESTED','ACCEPTED') AND expires_at IS NOT NULL AND expires_at < now() LIMIT 100"
  );
  let expired = 0;
  for (const { id } of due) {
    const out = await db.tx(async (t) => {
      const { booking: b, ride: r } = await lockBooking(t, id);
      if (!["REQUESTED", "ACCEPTED"].includes(b.status) || !b.expires_at || new Date(b.expires_at) >= new Date()) return null;
      const reason = b.status === "REQUESTED" ? "driver did not respond in time" : "payment not completed in time";
      return { booking: await transition(t, b, "EXPIRED", { role: "system", reason }), ride: r, reason };
    });
    if (!out) continue;
    expired += 1;
    await notify([out.booking.passenger_id], { type: "booking.expired", title: "Booking expired", body: `Your booking on ${rideSummary(out.ride)} expired: ${out.reason}.`, data: { bookingId: id } });
    pushBookingUpdate(out.booking, out.ride);
  }
  return expired;
};

export const sendReminders = async () => {
  const due = await db.many(
    `SELECT b.id, b.passenger_id, b.pickup_label, b.pickup_eta_at, r.id AS ride_id, r.driver_id, r.origin_label, r.destination_label, r.departure_at
       FROM bookings b JOIN rides r ON r.id = b.ride_id
      WHERE b.status = 'CONFIRMED' AND r.status = 'published'
        AND r.departure_at BETWEEN now() + interval '45 minutes' AND now() + interval '75 minutes'`
  );
  let sent = 0;
  for (const b of due) {
    const claimed = await db.one(
      "INSERT INTO jobs (type, dedupe_key, status, payload) VALUES ('reminder', $1, 'done', $2) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id",
      [`reminder:${b.id}`, { bookingId: b.id }]
    );
    if (!claimed) continue;
    const when = new Date(b.pickup_eta_at || b.departure_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
    await notify([b.passenger_id], { type: "ride.reminder", title: "Ride in about an hour", body: `Pickup at ${b.pickup_label} around ${when} (estimate).`, data: { bookingId: b.id, rideId: b.ride_id } });
    sent += 1;
  }
  const driverDue = await db.many(
    `SELECT r.id, r.driver_id, r.origin_label, r.destination_label FROM rides r
      WHERE r.status = 'published' AND r.departure_at BETWEEN now() + interval '45 minutes' AND now() + interval '75 minutes'
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = r.id AND b.status = 'CONFIRMED')`
  );
  for (const r of driverDue) {
    const claimed = await db.one(
      "INSERT INTO jobs (type, dedupe_key, status) VALUES ('reminder', $1, 'done') ON CONFLICT (dedupe_key) DO NOTHING RETURNING id",
      [`reminder:ride:${r.id}`]
    );
    if (!claimed) continue;
    await notify([r.driver_id], { type: "ride.reminder", title: "Your ride starts soon", body: `${r.origin_label} to ${r.destination_label} departs in about an hour. Start the ride from the app when you set off.`, data: { rideId: r.id } });
  }
  return sent;
};
