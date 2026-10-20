import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { P, book, createUser, createVerifiedDriver, db, hoursFromNow, idemKey, pay, publishRide, resetLimits, useTestServer } from "./helpers.js";
import { TRANSITIONS, canTransition } from "../src/services/bookingState.js";

useTestServer();
beforeEach(() => resetLimits());

const inventory = async (rideId) => (await db.one("SELECT seats_total, seats_reserved FROM seat_inventory WHERE ride_id = $1", [rideId]));

describe("seat inventory under concurrency", () => {
  it("never oversells: 12 passengers racing for 3 instant seats get exactly 3 bookings", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { seatsTotal: 3, bookingMode: "instant" });
    const passengers = await Promise.all(Array.from({ length: 12 }, (_, i) => createUser({ name: `Racer ${i}` })));
    const results = await Promise.all(passengers.map((p) => book(p, ride.id)));
    const ok = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 3, JSON.stringify(results.map((r) => r.status)));
    assert.equal(refused.length, 9);
    assert.ok(refused.every((r) => r.body.error.code === "seats_unavailable"));
    assert.deepEqual(await inventory(ride.id), { seats_total: 3, seats_reserved: 3 });
  });

  it("never oversells when a driver accepts requests concurrently", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { seatsTotal: 2, bookingMode: "request" });
    const passengers = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser({ name: `Asker ${i}` })));
    const requests = await Promise.all(passengers.map((p) => book(p, ride.id)));
    assert.ok(requests.every((r) => r.status === 201 && r.body.status === "REQUESTED"), "requests do not hold seats");
    const accepts = await Promise.all(requests.map((r) => driver.api.post(`/bookings/${r.body.id}/accept`)));
    assert.equal(accepts.filter((a) => a.status === 200).length, 2);
    assert.equal(accepts.filter((a) => a.status === 409).length, 3);
    assert.deepEqual(await inventory(ride.id), { seats_total: 2, seats_reserved: 2 });
  });

  it("a database constraint backs the lock: seats_reserved can never exceed seats_total", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { seatsTotal: 1 });
    await assert.rejects(db.query("UPDATE seat_inventory SET seats_reserved = 2 WHERE ride_id = $1", [ride.id]), /check constraint/);
  });
});

describe("duplicate prevention", () => {
  it("replays the original booking for a repeated Idempotency-Key", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver);
    const p = await createUser();
    const key = idemKey();
    const [a, b] = await Promise.all([book(p, ride.id, { key }), book(p, ride.id, { key })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 201]);
    assert.equal(a.body.id, b.body.id);
    assert.equal((await inventory(ride.id)).seats_reserved, 1);
  });

  it("refuses a second active booking on the same ride with a different key", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver);
    const p = await createUser();
    assert.equal((await book(p, ride.id)).status, 201);
    const again = await book(p, ride.id);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "already_booked");
  });

  it("requires an Idempotency-Key", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver);
    const p = await createUser();
    const r = await p.api.post(`/rides/${ride.id}/bookings`, { seats: 1, pickup: P.phoenix, dropoff: P.manyata });
    assert.equal(r.status, 400);
  });
});

describe("booking rules", () => {
  it("rejects pickups off the route and trips in the opposite direction", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver);
    const p = await createUser();
    const offRoute = await book(p, ride.id, { pickup: P.electronicCity });
    assert.equal(offRoute.status, 400);
    assert.ok(offRoute.body.error.details.reasons.includes("pickup_too_far"));
    const backwards = await book(p, ride.id, { pickup: P.manyata, dropoff: P.phoenix });
    assert.equal(backwards.status, 400);
    assert.ok(backwards.body.error.details.reasons.includes("wrong_direction"));
  });

  it("closes booking at the cutoff and refuses the driver's own ride", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(0.5), bookingCutoffMinutes: 45 });
    const p = await createUser();
    const late = await book(p, ride.id);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, "booking_closed");
    const own = await publishRide(driver);
    assert.equal((await book(driver, own.id)).status, 400);
  });

  it("enforces women-only rides using the passenger's profile", async () => {
    const driver = await createVerifiedDriver({ gender: "female" });
    const ride = await publishRide(driver, { womenOnly: true });
    const man = await createUser({ gender: "male" });
    const woman = await createUser({ gender: "female" });
    assert.equal((await book(man, ride.id)).status, 403);
    assert.equal((await book(woman, ride.id)).status, 201);
  });
});

describe("state machine", () => {
  it("defines every booking status and only legal moves", () => {
    for (const s of ["REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_DRIVER", "EXPIRED", "NO_SHOW", "DISPUTED"]) {
      assert.ok(TRANSITIONS[s], s);
    }
    assert.equal(canTransition("REQUESTED", "ACCEPTED", "driver"), true);
    assert.equal(canTransition("REQUESTED", "ACCEPTED", "passenger"), false);
    assert.equal(canTransition("ACCEPTED", "CONFIRMED", "driver"), false, "only a verified payment confirms");
    assert.equal(canTransition("COMPLETED", "CANCELLED_BY_PASSENGER", "passenger"), false);
    assert.equal(canTransition("CANCELLED_BY_DRIVER", "ACCEPTED", "driver"), false);
  });

  it("walks a request-to-book booking through every happy-path state with an audit trail", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { bookingMode: "request", departureAt: hoursFromNow(0.75), bookingCutoffMinutes: 10 });
    const p = await createUser();
    const req = await book(p, ride.id);
    assert.equal(req.body.status, "REQUESTED");
    assert.equal((await db.one("SELECT seats_reserved FROM seat_inventory WHERE ride_id = $1", [ride.id])).seats_reserved, 0);

    assert.equal((await p.api.post(`/bookings/${req.body.id}/accept`)).status, 404, "a passenger cannot accept");
    const acc = await driver.api.post(`/bookings/${req.body.id}/accept`);
    assert.equal(acc.body.status, "ACCEPTED");
    assert.equal((await db.one("SELECT seats_reserved FROM seat_inventory WHERE ride_id = $1", [ride.id])).seats_reserved, 1);

    assert.equal((await pay(p, req.body.id)).body.status, "captured");
    assert.equal((await p.api.get(`/bookings/${req.body.id}`)).body.status, "CONFIRMED");

    assert.equal((await driver.api.post(`/bookings/${req.body.id}/pickup`)).status, 409, "ride must start first");
    assert.equal((await driver.api.post(`/rides/${ride.id}/start`, { shareLocation: true })).status, 200);
    assert.equal((await driver.api.post(`/bookings/${req.body.id}/pickup`)).body.status, "IN_PROGRESS");
    assert.equal((await driver.api.post(`/rides/${ride.id}/complete`)).status, 200);

    const done = await p.api.get(`/bookings/${req.body.id}`);
    assert.equal(done.body.status, "COMPLETED");
    assert.deepEqual(done.body.events.map((e) => e.to_status), ["REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"]);
    assert.deepEqual(done.body.events.map((e) => e.actor_role), ["passenger", "driver", "system", "driver", "driver"]);
    const r = await db.one("SELECT location_sharing FROM rides WHERE id = $1", [ride.id]);
    assert.equal(r.location_sharing, false, "location sharing stops when the trip ends");
  });

  it("refuses illegal transitions with a clear error", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { bookingMode: "request" });
    const p = await createUser();
    const req = await book(p, ride.id);
    await driver.api.post(`/bookings/${req.body.id}/reject`, { reason: "Car is full of luggage" });
    const again = await driver.api.post(`/bookings/${req.body.id}/accept`);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "invalid_transition");
  });

  it("will not complete a ride while a confirmed passenger is unresolved", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(0.5), bookingCutoffMinutes: 5, pricePerSeatPaise: 0 });
    const p = await createUser();
    const b = await book(p, ride.id);
    assert.equal(b.body.status, "CONFIRMED", "a free seat confirms immediately");
    await driver.api.post(`/rides/${ride.id}/start`);
    const r = await driver.api.post(`/rides/${ride.id}/complete`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "unresolved_passengers");
  });

  it("expires unpaid accepted bookings and releases their seats", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { seatsTotal: 1 });
    const p = await createUser();
    const b = await book(p, ride.id);
    assert.equal(b.body.status, "ACCEPTED");
    await db.query("UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1", [b.body.id]);
    const { expireBookings } = await import("../src/services/bookings.js");
    assert.equal(await expireBookings(), 1);
    assert.equal((await p.api.get(`/bookings/${b.body.id}`)).body.status, "EXPIRED");
    assert.equal((await inventory(ride.id)).seats_reserved, 0);
    const other = await createUser();
    assert.equal((await book(other, ride.id)).status, 201, "the released seat can be booked");
  });
});

describe("cancellations and refunds", () => {
  it("refunds in full when the passenger cancels early, and frees the seat", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(10), pricePerSeatPaise: 6000 });
    const p = await createUser();
    const b = await book(p, ride.id, { seats: 2 });
    await pay(p, b.body.id);
    const c = await p.api.post(`/bookings/${b.body.id}/cancel`, { reason: "Meeting moved" });
    assert.equal(c.status, 200);
    assert.equal(c.body.booking.status, "CANCELLED_BY_PASSENGER");
    assert.equal(c.body.refund.amountPaise, 12000);
    const pay1 = await db.one("SELECT status, refunded_paise FROM payments WHERE booking_id = $1", [b.body.id]);
    assert.deepEqual(pay1, { status: "refunded", refunded_paise: 12000 });
    assert.equal((await inventory(ride.id)).seats_reserved, 0);
  });

  it("applies the late-cancellation percentage inside the free window", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(1), bookingCutoffMinutes: 10, pricePerSeatPaise: 6000 });
    const p = await createUser();
    const b = await book(p, ride.id);
    await pay(p, b.body.id);
    const c = await p.api.post(`/bookings/${b.body.id}/cancel`, {});
    assert.equal(c.body.refund.amountPaise, 3000, "50% by default");
    const pay1 = await db.one("SELECT status, refunded_paise FROM payments WHERE booking_id = $1", [b.body.id]);
    assert.deepEqual(pay1, { status: "partially_refunded", refunded_paise: 3000 });
  });

  it("cancels every booking with a full refund when the driver cancels the ride", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(1), bookingCutoffMinutes: 10 });
    const [a, b] = await Promise.all([createUser(), createUser()]);
    const ba = await book(a, ride.id);
    const bb = await book(b, ride.id);
    await pay(a, ba.body.id);
    const res = await driver.api.post(`/rides/${ride.id}/cancel`, { reason: "Car breakdown" });
    assert.equal(res.body.bookingsCancelled, 2);
    assert.equal((await a.api.get(`/bookings/${ba.body.id}`)).body.status, "CANCELLED_BY_DRIVER");
    assert.equal((await b.api.get(`/bookings/${bb.body.id}`)).body.status, "CANCELLED_BY_DRIVER");
    assert.equal((await db.one("SELECT refunded_paise FROM payments WHERE booking_id = $1", [ba.body.id])).refunded_paise, 5000);
    assert.equal((await inventory(ride.id)).seats_reserved, 0);
    const notes = await db.many("SELECT type FROM notifications WHERE user_id = $1", [a.id]);
    assert.ok(notes.some((n) => n.type === "ride.cancelled"));
  });

  it("does not let a passenger cancel after the ride starts", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(0.5), bookingCutoffMinutes: 5, pricePerSeatPaise: 0 });
    const p = await createUser();
    const b = await book(p, ride.id);
    await driver.api.post(`/rides/${ride.id}/start`);
    assert.equal((await p.api.post(`/bookings/${b.body.id}/cancel`, {})).status, 409);
  });
});

describe("no-shows, disputes and reviews", () => {
  it("lets a no-show passenger dispute, and an admin resolve with a refund", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(0.4), bookingCutoffMinutes: 5 });
    const p = await createUser();
    const b = await book(p, ride.id);
    await pay(p, b.body.id);
    await driver.api.post(`/rides/${ride.id}/start`);
    assert.equal((await driver.api.post(`/bookings/${b.body.id}/no-show`)).status, 409, "not before departure");
    await db.query("UPDATE rides SET departure_at = now() - interval '5 minutes', est_arrival_at = now() + interval '30 minutes' WHERE id = $1", [ride.id]);
    assert.equal((await driver.api.post(`/bookings/${b.body.id}/no-show`)).body.status, "NO_SHOW");
    const d = await p.api.post(`/bookings/${b.body.id}/dispute`, { reason: "I was at the pickup point on time." });
    assert.equal(d.status, 201);
    assert.equal(d.body.booking.status, "DISPUTED");
    const ticket = await db.one("SELECT escalated, priority FROM support_tickets WHERE id = $1", [d.body.ticketId]);
    assert.deepEqual(ticket, { escalated: true, priority: "high" });

    const admin = await createUser({ roles: ["admin"] });
    const r = await admin.api.post(`/admin/disputes/${b.body.id}/resolve`, { outcome: "CANCELLED_BY_DRIVER", refundPercent: 100, note: "Driver left early; full refund." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, "CANCELLED_BY_DRIVER");
    assert.equal((await db.one("SELECT refunded_paise FROM payments WHERE booking_id = $1", [b.body.id])).refunded_paise, 5000);
    const log = await db.one("SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'dispute.resolve'", [b.body.id]);
    assert.ok(log);
  });

  it("allows one review per side after completion and reflects it in the rating", async () => {
    const driver = await createVerifiedDriver();
    const ride = await publishRide(driver, { departureAt: hoursFromNow(0.5), bookingCutoffMinutes: 5, pricePerSeatPaise: 0 });
    const p = await createUser();
    const b = await book(p, ride.id);
    assert.equal((await p.api.post(`/bookings/${b.body.id}/review`, { rating: 5 })).status, 409, "not before completion");
    await driver.api.post(`/rides/${ride.id}/start`);
    await driver.api.post(`/bookings/${b.body.id}/pickup`);
    await driver.api.post(`/rides/${ride.id}/complete`);
    assert.equal((await p.api.post(`/bookings/${b.body.id}/review`, { rating: 4, comment: "Smooth ride" })).status, 201);
    assert.equal((await p.api.post(`/bookings/${b.body.id}/review`, { rating: 1 })).status, 409);
    assert.equal((await driver.api.post(`/bookings/${b.body.id}/review`, { rating: 5 })).status, 201);
    const profile = await p.api.get(`/users/${driver.id}/profile`);
    assert.equal(profile.body.rating, 4);
    assert.equal(profile.body.reviewCount, 1);
  });
});
