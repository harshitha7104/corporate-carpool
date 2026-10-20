import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { base, book, createUser, createVerifiedDriver, db, idemKey, publishRide, resetLimits, useTestServer } from "./helpers.js";
import { paymentsProvider } from "../src/providers/payments.js";
import { deliveryProviders, notify, processDeliveries } from "../src/services/notifications.js";

useTestServer();
beforeEach(() => resetLimits());

const acceptedBooking = async (price = 5000) => {
  const d = await createVerifiedDriver();
  const ride = await publishRide(d, { pricePerSeatPaise: price });
  const p = await createUser();
  const b = await book(p, ride.id);
  assert.equal(b.body.status, "ACCEPTED");
  return { d, p, ride, booking: b.body };
};

const postWebhook = (rawBody, signature) =>
  fetch(`${base}/api/v1/payments/webhooks/simulated`, { method: "POST", headers: { "Content-Type": "application/json", "x-simulated-signature": signature }, body: rawBody });

describe("checkout", () => {
  it("is idempotent per key and reuses an open order for the booking", async () => {
    const { p, booking } = await acceptedBooking();
    const key = idemKey();
    const a = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": key });
    const b = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": key });
    const c = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    assert.equal(a.status, 201);
    assert.equal(a.body.payment.id, b.body.payment.id);
    assert.equal(a.body.payment.id, c.body.payment.id);
    assert.equal(a.body.payment.amountPaise, 5000);
    assert.equal(a.body.payment.isSimulated, true);
    assert.equal((await db.one("SELECT count(*) FROM payments WHERE booking_id = $1", [booking.id])).count, 1);
  });

  it("refuses to take payment for someone else's booking", async () => {
    const { booking } = await acceptedBooking();
    const stranger = await createUser();
    assert.equal((await stranger.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() })).status, 404);
  });
});

describe("webhooks", () => {
  it("only trusts correctly signed events, and records rejected ones", async () => {
    const { p, booking } = await acceptedBooking();
    const co = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    const { rawBody } = paymentsProvider.buildWebhook({ orderId: co.body.payment ? co.body.checkout.orderId : "", outcome: "success", amountPaise: 5000 });
    const forged = await postWebhook(rawBody, "0".repeat(64));
    assert.equal(forged.status, 403);
    assert.equal((await p.api.get(`/bookings/${booking.id}`)).body.status, "ACCEPTED", "a forged event changes nothing");
    const recorded = await db.one("SELECT count(*) FROM payment_webhook_events WHERE NOT signature_valid");
    assert.ok(recorded.count >= 1);
  });

  it("processes a duplicate delivery of the same event only once", async () => {
    const { p, booking } = await acceptedBooking();
    const co = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    const { rawBody, signature } = paymentsProvider.buildWebhook({ orderId: co.body.checkout.orderId, outcome: "success", amountPaise: 5000 });
    const first = await postWebhook(rawBody, signature);
    const second = await postWebhook(rawBody, signature);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { duplicate: true });
    assert.equal((await p.api.get(`/bookings/${booking.id}`)).body.status, "CONFIRMED");
    assert.equal((await db.one("SELECT count(*) FROM booking_events WHERE booking_id = $1 AND to_status = 'CONFIRMED'", [booking.id])).count, 1);
  });

  it("marks failed payments and lets the passenger retry before the hold expires", async () => {
    const { p, booking } = await acceptedBooking();
    const co = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    const failed = await p.api.post(`/payments/${co.body.payment.id}/simulate`, { outcome: "failure" });
    assert.equal(failed.body.status, "failed");
    assert.equal((await p.api.get(`/bookings/${booking.id}`)).body.status, "ACCEPTED");
    const retry = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    assert.notEqual(retry.body.payment.id, co.body.payment.id);
    const ok = await p.api.post(`/payments/${retry.body.payment.id}/simulate`, { outcome: "success" });
    assert.equal(ok.body.status, "captured");
    assert.equal((await p.api.get(`/bookings/${booking.id}`)).body.status, "CONFIRMED");
    const types = (await db.many("SELECT type FROM notifications WHERE user_id = $1", [p.id])).map((n) => n.type);
    assert.ok(types.includes("payment.failed") && types.includes("payment.succeeded"));
  });

  it("refunds automatically when money arrives after the booking expired", async () => {
    const { p, booking } = await acceptedBooking();
    const co = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    await db.query("UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1", [booking.id]);
    const { expireBookings } = await import("../src/services/bookings.js");
    await expireBookings();
    const { rawBody, signature } = paymentsProvider.buildWebhook({ orderId: co.body.checkout.orderId, outcome: "success", amountPaise: 5000 });
    assert.equal((await postWebhook(rawBody, signature)).status, 200);
    const pay = await db.one("SELECT status, refunded_paise FROM payments WHERE id = $1", [co.body.payment.id]);
    assert.deepEqual(pay, { status: "refunded", refunded_paise: 5000 });
    assert.equal((await p.api.get(`/bookings/${booking.id}`)).body.status, "EXPIRED");
  });

  it("issues receipts only for captured payments and labels simulated ones", async () => {
    const { p, booking } = await acceptedBooking();
    const co = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    assert.equal((await p.api.get(`/payments/${co.body.payment.id}/receipt`)).status, 409);
    await p.api.post(`/payments/${co.body.payment.id}/simulate`, { outcome: "success" });
    const r = await p.api.get(`/payments/${co.body.payment.id}/receipt`);
    assert.equal(r.status, 200);
    assert.match(r.body.simulatedNotice, /No money was charged/);
    assert.match(r.body.receiptNumber, /^GW-\d{8}-/);
  });
});

describe("refunds by admins", () => {
  it("cannot refund more than was paid", async () => {
    const { p, booking } = await acceptedBooking();
    const co = await p.api.post("/payments/checkout", { bookingId: booking.id }, { "Idempotency-Key": idemKey() });
    await p.api.post(`/payments/${co.body.payment.id}/simulate`, { outcome: "success" });
    const admin = await createUser({ roles: ["admin"] });
    const first = await admin.api.post(`/admin/payments/${co.body.payment.id}/refund`, { amountPaise: 3000, reason: "Goodwill for a long detour" });
    assert.equal(first.status, 201);
    assert.equal(first.body.status, "processed");
    const second = await admin.api.post(`/admin/payments/${co.body.payment.id}/refund`, { amountPaise: 3000, reason: "Second goodwill" });
    assert.equal(second.status, 201);
    assert.equal(second.body.amount_paise, 2000, "capped at what is left");
    assert.equal((await admin.api.post(`/admin/payments/${co.body.payment.id}/refund`, { amountPaise: 100, reason: "Third try" })).status, 409);
    const passengerTry = await p.api.post(`/admin/payments/${co.body.payment.id}/refund`, { amountPaise: 100, reason: "Self refund" });
    assert.equal(passengerTry.status, 403);
  });
});

describe("notification delivery", () => {
  it("records development deliveries as logged, never as sent", async () => {
    const u = await createUser({ email: "dev-check@greenway.example" });
    await notify([u.id], { type: "booking.confirmed", title: "Booking confirmed", body: "Test" });
    await processDeliveries();
    const rows = await db.many("SELECT channel, status FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE n.user_id = $1 ORDER BY channel", [u.id]);
    assert.deepEqual(rows, [{ channel: "email", status: "logged_dev" }, { channel: "sms", status: "logged_dev" }]);
  });

  it("retries failures with backoff and gives up after five attempts", async () => {
    const u = await createUser();
    const original = deliveryProviders.sms;
    let calls = 0;
    deliveryProviders.sms = async () => {
      calls += 1;
      return { status: "failed", error: "provider timeout" };
    };
    try {
      await notify([u.id], { type: "ride.reminder", title: "Reminder", body: "Test" });
      const id = (await db.one("SELECT d.id FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE n.user_id = $1", [u.id])).id;
      for (let i = 0; i < 5; i++) {
        await db.query("UPDATE notification_deliveries SET next_attempt_at = now() WHERE id = $1", [id]);
        await processDeliveries();
      }
      const d = await db.one("SELECT status, attempts, last_error FROM notification_deliveries WHERE id = $1", [id]);
      assert.deepEqual(d, { status: "failed", attempts: 5, last_error: "provider timeout" });
      assert.equal(calls, 5);
    } finally {
      deliveryProviders.sms = original;
    }
  });
});
