import { tooManyRequests } from "./errors.js";

// Fixed-window limiter kept in memory. Limits are per server instance; a
// multi-instance deployment should move this to Redis (see docs/security.md).
const buckets = new Map();

export const hit = (key, limit, windowMs) => {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
};

export const enforce = (key, limit, windowMs, message) => {
  if (!hit(key, limit, windowMs)) throw tooManyRequests(message);
};

export const rateLimit = ({ name, limit, windowMs, key = (req) => req.ip }) => (req, res, next) => {
  if (!hit(`${name}:${key(req)}`, limit, windowMs)) return next(tooManyRequests());
  return next();
};

export const resetRateLimits = () => buckets.clear();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60000);
sweeper.unref();
