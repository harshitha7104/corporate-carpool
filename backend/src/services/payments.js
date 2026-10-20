import { z } from "zod";
import { config } from "../config.js";
import { db, using } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { istDate } from "../lib/time.js";
import { randomToken } from "../lib/util.js";
import { parse } from "../lib/validate.js";
import { getPaymentsProvider, paymentsProvider } from "../providers/payments.js";
import { transition } from "./bookingState.js";
import { notify } from "./notifications.js";

const receiptNumber = () => `GW-${istDate().replace(/-/g, "")}-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;

const shapePayment = (p) => ({
  id: p.id,
  bookingId: p.booking_id,
  provider: p.provider,
  isSimulated: p.provider === "simulated",
  status: p.status,
  amountPaise: p.amount_paise,
  platformFeePaise: p.platform_fee_paise,
  providerFeePaise: p.provider_fee_paise,
  driverSharePaise: p.driver_share_paise,
  refundedPaise: p.refunded_paise,
  currency: p.currency,
  receiptNumber: p.receipt_number,
  failureReason: p.failure_reason,
  capturedAt: p.captured_at,
  createdAt: p.created_at,
});

// Start (or resume) paying for an accepted booking.
export const checkout = async (user, bookingId, idempotencyKey) => {
  if (!idempotencyKey) throw badRequest("Missing Idempotency-Key header.");
  const booking = await db.one("SELECT * FROM bookings WHERE id = $1", [bookingId]);
  if (!booking || booking.passenger_id !== user.id) throw notFound("Booking");
  if (booking.status !== "ACCEPTED") throw conflict("not_payable", "This booking is not waiting for payment.");
  if (booking.total_paise <= 0) throw conflict("not_payable", "This booking has nothing to pay.");
  if (booking.expires_at && new Date(booking.expires_at) < new Date()) throw conflict("expired", "The payment window for this booking has closed.");

  const existing = await db.one(
    "SELECT * FROM payments WHERE booking_id = $1 AND status = 'created' ORDER BY created_at DESC LIMIT 1",
    [bookingId]
  );
  if (existing) return { payment: shapePayment(existing), checkout: { type: existing.provider, orderId: existing.provider_order_id, keyId: config.payments.razorpayKeyId, amountPaise: existing.amount_paise } };

  const sameKey = await db.one("SELECT * FROM payments WHERE payer_id = $1 AND idempotency_key = $2", [user.id, idempotencyKey]);
  if (sameKey) {
    if (sameKey.booking_id !== bookingId) throw conflict("idempotency_conflict", "This Idempotency-Key was used for a different booking.");
    return { payment: shapePayment(sameKey), checkout: { type: sameKey.provider, orderId: sameKey.provider_order_id, amountPaise: sameKey.amount_paise } };
  }

  const receipt = receiptNumber();
  const order = await paymentsProvider.createOrder({ amountPaise: booking.total_paise, receipt, notes: { booking_id: bookingId } });
  const payment = await db.one(
    `INSERT INTO payments (booking_id, payer_id, provider, provider_order_id, amount_paise, platform_fee_paise, driver_share_paise, idempotency_key, receipt_number, is_demo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [bookingId, user.id, paymentsProvider.name, order.orderId, booking.total_paise, booking.platform_fee_paise,
      booking.total_paise - booking.platform_fee_paise, idempotencyKey, receipt, booking.is_demo]
  );
  return { payment: shapePayment(payment), checkout: { ...order.checkout, orderId: order.orderId } };
};

// ---- Applying provider events ------------------------------------------------------
const applyCaptured = async ({ provider, orderId, paymentId, providerFeePaise }) => {
  const outcome = await db.tx(async (t) => {
    // Lock order everywhere: seat_inventory, then booking, then payment.
    const ref = await t.one(
      "SELECT p.id, b.ride_id FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.provider = $1 AND p.provider_order_id = $2",
      [provider, orderId]
    );
    if (!ref) throw notFound("Payment");
    await t.query("SELECT 1 FROM seat_inventory WHERE ride_id = $1 FOR UPDATE", [ref.ride_id]);
    const p = await t.one("SELECT * FROM payments WHERE id = $1 FOR UPDATE", [ref.id]);
    if (p.status !== "created" && p.status !== "failed") return { duplicate: true, payment: p };
    const payment = await t.one(
      `UPDATE payments SET status = 'captured', provider_payment_id = $2, provider_fee_paise = $3,
         failure_reason = NULL, captured_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [p.id, paymentId, providerFeePaise || 0]
    );
    const fresh = await t.one("SELECT * FROM bookings WHERE id = $1", [p.booking_id]);
    if (fresh.status === "ACCEPTED") {
      const confirmed = await transition(t, fresh, "CONFIRMED", { role: "system", reason: "payment captured", expiresAt: null });
      return { payment, booking: confirmed, confirmed: true };
    }
    // Paid after the booking expired or was cancelled: refund in full.
    const refund = await t.one(
      `INSERT INTO refunds (payment_id, amount_paise, reason) VALUES ($1, $2, $3) RETURNING id`,
      [payment.id, payment.amount_paise, `Booking was ${fresh.status.toLowerCase()} when payment arrived`]
    );
    return { payment, booking: fresh, refundId: refund.id };
  });
  if (outcome.duplicate) return outcome;
  if (outcome.refundId) await processRefund(outcome.refundId);
  if (outcome.confirmed) {
    const ride = await db.one("SELECT driver_id, origin_label, destination_label, departure_at FROM rides WHERE id = $1", [outcome.booking.ride_id]);
    await notify([outcome.booking.passenger_id], { type: "payment.succeeded", title: "Payment received", body: `Rs ${outcome.payment.amount_paise / 100} paid. Your seat is confirmed.`, data: { bookingId: outcome.booking.id, paymentId: outcome.payment.id } });
    await notify([outcome.booking.passenger_id, ride.driver_id], { type: "booking.confirmed", title: "Booking confirmed", body: `${ride.origin_label} to ${ride.destination_label} is confirmed.`, data: { bookingId: outcome.booking.id, rideId: outcome.booking.ride_id } });
  }
  return outcome;
};

const applyFailed = async ({ provider, orderId, failureReason }) => {
  const p = await db.one(
    `UPDATE payments SET status = 'failed', failure_reason = $3, updated_at = now()
      WHERE provider = $1 AND provider_order_id = $2 AND status = 'created' RETURNING *`,
    [provider, orderId, failureReason || "Payment failed"]
  );
  if (p) {
    await notify([p.payer_id], { type: "payment.failed", title: "Payment failed", body: `${failureReason || "The payment did not go through"}. You can try again before your hold expires.`, data: { bookingId: p.booking_id, paymentId: p.id } });
  }
  return p;
};

export const handleWebhook = async (providerName, rawBody, headers) => {
  const provider = getPaymentsProvider(providerName);
  if (!provider) throw notFound("Payment provider");
  const valid = provider.verifyWebhook(rawBody, headers);
  let json;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw badRequest("Webhook body is not JSON.");
  }
  if (!valid) {
    await db.query(
      `INSERT INTO payment_webhook_events (provider, event_id, event_type, signature_valid, payload, processing_error)
       VALUES ($1, $2, $3, false, $4, 'invalid signature')`,
      [providerName, `invalid:${randomToken(10)}`, String(json?.type || json?.event || "unknown"), json]
    );
    logger.warn("Rejected payment webhook with invalid signature", { provider: providerName });
    throw forbidden("Invalid webhook signature.");
  }
  const event = provider.parseWebhook(json);
  const inserted = await db.one(
    `INSERT INTO payment_webhook_events (provider, event_id, event_type, signature_valid, payload)
     VALUES ($1, $2, $3, true, $4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [providerName, event.eventId, event.type, json]
  );
  if (!inserted) {
    const prior = await db.one("SELECT processed_at FROM payment_webhook_events WHERE provider = $1 AND event_id = $2", [providerName, event.eventId]);
    if (prior?.processed_at) return { duplicate: true };
  }
  try {
    if (event.type === "payment.captured") await applyCaptured({ provider: providerName, ...event });
    else if (event.type === "payment.failed") await applyFailed({ provider: providerName, ...event });
    else if (event.type === "refund.processed" && event.refundId) {
      await db.query("UPDATE refunds SET status = 'processed', processed_at = now() WHERE provider_refund_id = $1", [event.refundId]);
    }
    await db.query("UPDATE payment_webhook_events SET processed_at = now(), processing_error = NULL WHERE provider = $1 AND event_id = $2", [providerName, event.eventId]);
  } catch (err) {
    await db.query("UPDATE payment_webhook_events SET processing_error = $3 WHERE provider = $1 AND event_id = $2", [providerName, event.eventId, err.message]);
    throw err;
  }
  return { ok: true };
};

// Development checkout: the passenger picks an outcome and the simulated
// gateway delivers a signed webhook through the normal verification path.
export const simulateOutcome = async (user, paymentId, body) => {
  if (paymentsProvider.name !== "simulated") throw notFound("Simulated payment");
  const { outcome } = parse(z.object({ outcome: z.enum(["success", "failure"]) }), body);
  const p = await db.one("SELECT * FROM payments WHERE id = $1 AND payer_id = $2", [paymentId, user.id]);
  if (!p) throw notFound("Payment");
  if (p.status !== "created") throw conflict("not_pending", "This payment is not waiting for an outcome.");
  const { rawBody, signature } = paymentsProvider.buildWebhook({ orderId: p.provider_order_id, outcome, amountPaise: p.amount_paise });
  await handleWebhook("simulated", rawBody, { "x-simulated-signature": signature });
  return getPayment(user, paymentId);
};

// Razorpay Checkout returns a signature to the browser; we verify it here,
// server-side, with the key secret. The webhook remains the backstop.
export const verifyRazorpay = async (user, paymentId, body) => {
  if (paymentsProvider.name !== "razorpay") throw notFound("Payment");
  const input = parse(z.object({ razorpayPaymentId: z.string().min(5), razorpaySignature: z.string().min(10) }), body);
  const p = await db.one("SELECT * FROM payments WHERE id = $1 AND payer_id = $2", [paymentId, user.id]);
  if (!p) throw notFound("Payment");
  if (!paymentsProvider.verifyPaymentSignature({ orderId: p.provider_order_id, paymentId: input.razorpayPaymentId, signature: input.razorpaySignature })) {
    throw forbidden("Payment signature did not verify.");
  }
  await applyCaptured({ provider: "razorpay", orderId: p.provider_order_id, paymentId: input.razorpayPaymentId, providerFeePaise: 0 });
  return getPayment(user, paymentId);
};

// ---- Refunds ------------------------------------------------------------------------
// Create a pending refund for the booking's captured payment (inside the
// caller's transaction). processRefund() then talks to the provider.
export const queueRefund = async (t, bookingId, amountPaise, reason, initiatedBy = null) => {
  if (amountPaise <= 0) return null;
  const p = await using(t).one(
    "SELECT * FROM payments WHERE booking_id = $1 AND status IN ('captured','partially_refunded') ORDER BY captured_at DESC LIMIT 1 FOR UPDATE",
    [bookingId]
  );
  if (!p) return null;
  const pendingOrDone = await using(t).one("SELECT coalesce(sum(amount_paise), 0) AS s FROM refunds WHERE payment_id = $1 AND status <> 'failed'", [p.id]);
  const amount = Math.min(amountPaise, p.amount_paise - pendingOrDone.s);
  if (amount <= 0) return null;
  const r = await using(t).one(
    "INSERT INTO refunds (payment_id, amount_paise, reason, initiated_by) VALUES ($1, $2, $3, $4) RETURNING id",
    [p.id, amount, reason, initiatedBy]
  );
  return r.id;
};

export const processRefund = async (refundId) => {
  const r = await db.one(
    "SELECT r.*, p.provider, p.provider_payment_id, p.payer_id, p.booking_id FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1",
    [refundId]
  );
  if (!r || r.status !== "pending" || r.provider_refund_id) return r;
  let result;
  try {
    result = await getPaymentsProvider(r.provider).refund({ providerPaymentId: r.provider_payment_id, amountPaise: r.amount_paise });
  } catch (err) {
    await db.query("UPDATE refunds SET failure_reason = $2 WHERE id = $1", [refundId, err.message]);
    logger.warn("Refund attempt failed; the worker will retry", { refundId, error: err.message });
    return r;
  }
  await db.tx(async (t) => {
    await t.query(
      "UPDATE refunds SET provider_refund_id = $2, status = $3, processed_at = CASE WHEN $3 = 'processed' THEN now() END, failure_reason = NULL WHERE id = $1",
      [refundId, result.refundId, result.status]
    );
    await t.query(
      `UPDATE payments SET refunded_paise = refunded_paise + $2,
         status = CASE WHEN refunded_paise + $2 >= amount_paise THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now()
       WHERE id = $1`,
      [r.payment_id, r.amount_paise]
    );
  });
  await notify([r.payer_id], { type: "refund.updated", title: "Refund issued", body: `Rs ${r.amount_paise / 100} is being refunded to your original payment method.`, data: { bookingId: r.booking_id, refundId } });
  return { ...r, status: result.status };
};

export const retryPendingRefunds = async () => {
  const rows = await db.many("SELECT id FROM refunds WHERE status = 'pending' AND provider_refund_id IS NULL AND created_at < now() - interval '1 minute' LIMIT 20");
  for (const r of rows) await processRefund(r.id);
  return rows.length;
};

export const adminRefund = async (admin, paymentId, body) => {
  const input = parse(z.object({ amountPaise: z.number().int().positive(), reason: z.string().trim().min(5).max(300) }), body);
  const refundId = await db.tx(async (t) => {
    const p = await t.one("SELECT * FROM payments WHERE id = $1", [paymentId]);
    if (!p) throw notFound("Payment");
    const id = await queueRefund(t, p.booking_id, input.amountPaise, input.reason, admin.id);
    if (!id) throw conflict("not_refundable", "Nothing left to refund on this payment.");
    await audit({ actor: admin, action: "payment.refund", entityType: "payment", entityId: paymentId, details: input, client: t });
    return id;
  });
  await processRefund(refundId);
  return db.one("SELECT * FROM refunds WHERE id = $1", [refundId]);
};

// ---- Reading --------------------------------------------------------------------------
export const getPayment = async (user, paymentId) => {
  const p = await db.one("SELECT * FROM payments WHERE id = $1", [paymentId]);
  if (!p || (p.payer_id !== user.id && !user.permissions.includes("admin.payments.read"))) throw notFound("Payment");
  const refunds = await db.many("SELECT id, amount_paise, status, reason, created_at, processed_at FROM refunds WHERE payment_id = $1 ORDER BY created_at", [paymentId]);
  return { ...shapePayment(p), refunds };
};

export const listMyPayments = async (user, { limit, offset }) => {
  const rows = await db.many(
    `SELECT p.*, r.origin_label, r.destination_label, r.departure_at
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN rides r ON r.id = b.ride_id
      WHERE p.payer_id = $1 ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
    [user.id, limit, offset]
  );
  return rows.map((p) => ({ ...shapePayment(p), ride: { originLabel: p.origin_label, destinationLabel: p.destination_label, departureAt: p.departure_at } }));
};

export const receipt = async (user, paymentId) => {
  const p = await getPayment(user, paymentId);
  if (!["captured", "refunded", "partially_refunded"].includes(p.status)) throw conflict("no_receipt", "Receipts are available after payment succeeds.");
  const info = await db.one(
    `SELECT r.origin_label, r.destination_label, r.departure_at, b.seats, coalesce(dp.full_name, 'Driver') AS driver_name
       FROM bookings b JOIN rides r ON r.id = b.ride_id LEFT JOIN user_profiles dp ON dp.user_id = r.driver_id WHERE b.id = $1`,
    [p.bookingId]
  );
  return { ...p, trip: info, issuer: "Green Way (cost-sharing contribution receipt)", simulatedNotice: p.isSimulated ? "Simulated payment. No money was charged." : null };
};

// Driver-side contribution summary: what passengers paid for their rides.
export const driverContributions = async (user, { limit, offset }) => {
  const totals = await db.one(
    `SELECT coalesce(sum(p.driver_share_paise - (p.refunded_paise * p.driver_share_paise / greatest(p.amount_paise, 1))), 0)::int AS net_paise,
            count(*) AS payments
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN rides r ON r.id = b.ride_id
      WHERE r.driver_id = $1 AND p.status IN ('captured','partially_refunded','refunded')`,
    [user.id]
  );
  const items = await db.many(
    `SELECT p.id, p.status, p.amount_paise, p.driver_share_paise, p.refunded_paise, p.provider, p.captured_at,
            r.id AS ride_id, r.origin_label, r.destination_label, r.departure_at, b.seats
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN rides r ON r.id = b.ride_id
      WHERE r.driver_id = $1 AND p.status IN ('captured','partially_refunded','refunded')
      ORDER BY p.captured_at DESC LIMIT $2 OFFSET $3`,
    [user.id, limit, offset]
  );
  return { netPaise: totals.net_paise, payments: totals.payments, items };
};
