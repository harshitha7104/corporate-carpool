import { config } from "../config.js";
import { hmacHex, randomToken, safeEqual } from "../lib/util.js";
import { unavailable } from "../lib/errors.js";

// Provider contract:
//   createOrder({ amountPaise, receipt, notes }) -> { orderId, checkout }
//   verifyWebhook(rawBody, headers) -> boolean
//   parseWebhook(json) -> { eventId, type, orderId?, paymentId?, providerFeePaise?, refundId?, failureReason? }
//   refund({ providerPaymentId, amountPaise }) -> { refundId, status: "processed" | "pending" }
// Payment success is only ever taken from a verified webhook (or a verified
// Razorpay payment signature); a client saying "it worked" is never enough.

// Development provider. No money moves. The in-app checkout page is labelled
// as simulated, and its outcome reaches the server as an HMAC-signed webhook
// that goes through exactly the same verification as a real provider's.
const simulated = {
  name: "simulated",
  live: false,
  async createOrder({ amountPaise }) {
    return { orderId: `sim_order_${randomToken(12)}`, checkout: { type: "simulated", amountPaise } };
  },
  sign(rawBody) {
    return hmacHex(config.payments.simulatedWebhookSecret, rawBody);
  },
  // Builds the webhook the simulated gateway "sends" for an outcome.
  buildWebhook({ orderId, outcome, amountPaise }) {
    const paymentId = `sim_pay_${randomToken(12)}`;
    const event = {
      id: `sim_evt_${randomToken(12)}`,
      type: outcome === "success" ? "payment.captured" : "payment.failed",
      data: {
        order_id: orderId,
        payment_id: paymentId,
        amount: amountPaise,
        fee: 0,
        failure_reason: outcome === "success" ? null : "Simulated card decline",
      },
    };
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: this.sign(rawBody) };
  },
  verifyWebhook(rawBody, headers) {
    const sig = headers["x-simulated-signature"];
    return Boolean(sig) && safeEqual(sig, this.sign(rawBody));
  },
  parseWebhook(json) {
    return {
      eventId: json.id,
      type: json.type,
      orderId: json.data?.order_id,
      paymentId: json.data?.payment_id,
      providerFeePaise: json.data?.fee || 0,
      failureReason: json.data?.failure_reason || null,
    };
  },
  async refund() {
    return { refundId: `sim_rfnd_${randomToken(12)}`, status: "processed" };
  },
};

// Razorpay. Active only with PAYMENTS_PROVIDER=razorpay and keys. Order
// creation and refunds call the live API (not exercised in this repository's
// tests); signature checks follow Razorpay's documented HMAC-SHA256 scheme.
const razorpayAuth = () =>
  `Basic ${Buffer.from(`${config.payments.razorpayKeyId}:${config.payments.razorpayKeySecret}`).toString("base64")}`;

const razorpayCall = async (path, body) => {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw unavailable(data?.error?.description || `Payment provider returned ${res.status}.`);
  return data;
};

const razorpay = {
  name: "razorpay",
  live: true,
  async createOrder({ amountPaise, receipt, notes }) {
    const order = await razorpayCall("/orders", { amount: amountPaise, currency: "INR", receipt, notes });
    return { orderId: order.id, checkout: { type: "razorpay", keyId: config.payments.razorpayKeyId, amountPaise } };
  },
  // Signature returned to the browser by Razorpay Checkout.
  verifyPaymentSignature({ orderId, paymentId, signature }) {
    return safeEqual(signature, hmacHex(config.payments.razorpayKeySecret, `${orderId}|${paymentId}`));
  },
  verifyWebhook(rawBody, headers) {
    const sig = headers["x-razorpay-signature"];
    return Boolean(sig) && safeEqual(sig, hmacHex(config.payments.razorpayWebhookSecret, rawBody));
  },
  parseWebhook(json) {
    const payment = json.payload?.payment?.entity;
    const refund = json.payload?.refund?.entity;
    return {
      eventId: json.id || `${json.event}:${payment?.id || refund?.id}:${json.created_at}`,
      type: json.event,
      orderId: payment?.order_id,
      paymentId: payment?.id || refund?.payment_id,
      providerFeePaise: payment?.fee || 0,
      refundId: refund?.id,
      failureReason: payment?.error_description || null,
    };
  },
  async refund({ providerPaymentId, amountPaise }) {
    const r = await razorpayCall(`/payments/${providerPaymentId}/refund`, { amount: amountPaise });
    return { refundId: r.id, status: r.status === "processed" ? "processed" : "pending" };
  },
};

const providers = { simulated, razorpay };
export const paymentsProvider = providers[config.payments.provider];
export const getPaymentsProvider = (name) => providers[name];
