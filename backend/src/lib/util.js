import crypto from "node:crypto";

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const hmacHex = (secret, value) => crypto.createHmac("sha256", secret).update(value).digest("hex");

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Six-digit numeric code, uniformly distributed.
export const otpCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

export const normalisePhone = (input) => {
  const digits = String(input || "").replace(/[^\d+]/g, "");
  const local = digits.replace(/^\+?91/, "").replace(/^0/, "");
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
};

export const maskPhone = (phone) => (phone ? `${phone.slice(0, 3)} ••••• ${phone.slice(-3)}` : null);
export const maskEmail = (email) => {
  if (!email) return null;
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}•••@${domain}`;
};

export const normalisePlate = (input) => String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Money is integer paise throughout; rupees only exist at the edges.
export const rupees = (paise) => paise / 100;
export const percentOf = (paise, percent) => Math.round((paise * percent) / 100);

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
