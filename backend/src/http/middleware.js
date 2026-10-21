import crypto from "node:crypto";
import { config } from "../config.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
import { logger, requestContext } from "../lib/logger.js";
import { sessionUser } from "../services/auth.js";

export const SESSION_COOKIE = "gw_session";

export const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      })
  );

export const sessionCookie = (token, maxAgeSeconds) =>
  [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    config.isProduction ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");

// Request id (correlation id) and structured access log.
export const requestId = (req, res, next) => {
  const id = /^[A-Za-z0-9-]{8,64}$/.test(req.get("x-request-id") || "") ? req.get("x-request-id") : crypto.randomUUID();
  req.id = id;
  res.set("X-Request-Id", id);
  const started = Date.now();
  res.on("finish", () => {
    if (req.path === "/health") return;
    logger.info("request", { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started, userId: req.user?.id });
  });
  requestContext.run({ requestId: id, ip: req.ip }, next);
};

export const securityHeaders = (req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  if (config.isProduction) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // The SPA only loads its own scripts, Google Fonts, map tiles and Razorpay Checkout.
    if (!req.path.startsWith("/api/")) {
      const tiles = process.env.CSP_IMG_EXTRA || "https://*.tile.openstreetmap.org";
      res.set(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self' https://checkout.razorpay.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          `img-src 'self' data: blob: ${tiles}`,
          "connect-src 'self' ws: wss: https://lumberjack.razorpay.com",
          "frame-src https://api.razorpay.com https://checkout.razorpay.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
        ].join("; ")
      );
    }
  }
  next();
};

const allowedOrigin = (origin, req) => {
  if (!origin) return false;
  const host = req.get("host");
  if (origin === `http://${host}` || origin === `https://${host}`) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    if (origin === new URL(config.publicAppUrl).origin) return true;
  } catch {
    // ignore malformed config
  }
  return !config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

// CSRF defence for cookie sessions: state-changing requests must carry an
// Origin (or Referer) we trust. Webhooks are exempt (they are signed).
export const csrf = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/api/v1/payments/webhooks/")) return next();
  const origin = req.get("origin") || (req.get("referer") ? new URL(req.get("referer")).origin : null);
  if (!allowedOrigin(origin, req)) return next(forbidden("Request origin not allowed."));
  return next();
};

export const authenticate = async (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.sessionToken = token;
  req.user = token ? await sessionUser(token) : null;
  next();
};

export const requireUser = (req, res, next) => (req.user ? next() : next(unauthorized()));

export const requirePermission = (...perms) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!perms.every((p) => req.user.permissions.includes(p))) return next(forbidden());
  return next();
};

export const requireAnyPermission = (...perms) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!perms.some((p) => req.user.permissions.includes(p))) return next(forbidden());
  return next();
};

export const notFoundHandler = (req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found." } });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: { code: "bad_json", message: "The request body is not valid JSON." } });
  if (err.type === "entity.too.large") return res.status(413).json({ error: { code: "too_large", message: "The request is too large." } });
  if (err.code === "23505") return res.status(409).json({ error: { code: "conflict", message: "That already exists." } });
  if (err.code === "23514" || err.code === "22P02") return res.status(422).json({ error: { code: "validation_failed", message: "Some values are not allowed." } });
  logger.error("Unhandled error", { error: err.message, stack: err.stack, path: req.path });
  return res.status(500).json({ error: { code: "internal", message: "Something went wrong on our side. Please try again.", requestId: req.id } });
};
