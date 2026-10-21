import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, "..");

try {
  process.loadEnvFile(path.join(BACKEND_ROOT, ".env"));
} catch {
  // No .env file; rely on the real environment.
}

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().optional(),
  PUBLIC_APP_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  OTP_PROVIDER: z.enum(["dev", "msg91"]).default("dev"),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMS_PROVIDER: z.enum(["log", "msg91"]).default("log"),

  MAPS_PROVIDER: z.enum(["mock", "mapbox"]).default("mock"),
  MAPBOX_TOKEN: z.string().optional(),

  PAYMENTS_PROVIDER: z.enum(["simulated", "razorpay"]).default("simulated"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  SIMULATED_WEBHOOK_SECRET: z.string().optional(),

  STORAGE_DIR: z.string().optional(),
  SEED_DEMO: bool,
  // A deliberate, labelled demo deployment: allows on-screen sign-in codes and
  // simulated payments in production. Never set it for a real pilot.
  DEMO_MODE: bool,
  WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

// Render sets RENDER_EXTERNAL_URL automatically; use it when PUBLIC_APP_URL is not given.
const parsed = schema.safeParse({ ...process.env, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL });
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid configuration: ${issues}`);
}
const env = parsed.data;
const isProduction = env.NODE_ENV === "production";

// Guard rails: development shortcuts can never run in production.
if (isProduction) {
  const missing = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!env.PUBLIC_APP_URL) missing.push("PUBLIC_APP_URL");
  if (missing.length) throw new Error(`Missing required production settings: ${missing.join(", ")}`);
  if (env.OTP_PROVIDER === "dev" && !env.DEMO_MODE) {
    throw new Error("OTP_PROVIDER=dev shows codes on screen and cannot be used in production. Configure msg91, or set DEMO_MODE=true for a labelled demo deployment.");
  }
  if (env.PAYMENTS_PROVIDER === "simulated" && !env.DEMO_MODE) {
    throw new Error("Simulated payments are disabled in production. Configure razorpay, or set DEMO_MODE=true for a labelled demo deployment.");
  }
}
if (env.PAYMENTS_PROVIDER === "razorpay" && !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)) {
  throw new Error("PAYMENTS_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.");
}
if (env.MAPS_PROVIDER === "mapbox" && !env.MAPBOX_TOKEN) {
  throw new Error("MAPS_PROVIDER=mapbox needs MAPBOX_TOKEN.");
}
if (env.EMAIL_PROVIDER === "resend" && !(env.RESEND_API_KEY && env.EMAIL_FROM)) {
  throw new Error("EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM.");
}
if ((env.OTP_PROVIDER === "msg91" || env.SMS_PROVIDER === "msg91") && !env.MSG91_AUTH_KEY) {
  throw new Error("The msg91 provider needs MSG91_AUTH_KEY.");
}

const devSecret = "development-only-secret-do-not-use-in-production-0123456789";

export const config = {
  env: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  publicAppUrl: env.PUBLIC_APP_URL || `http://localhost:${env.PORT}`,
  allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  sessionSecret: env.SESSION_SECRET || devSecret,
  sessionDays: env.SESSION_DAYS,
  otp: { provider: env.OTP_PROVIDER, msg91AuthKey: env.MSG91_AUTH_KEY, msg91TemplateId: env.MSG91_TEMPLATE_ID },
  email: { provider: env.EMAIL_PROVIDER, resendApiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  sms: { provider: env.SMS_PROVIDER, msg91AuthKey: env.MSG91_AUTH_KEY },
  maps: { provider: env.MAPS_PROVIDER, mapboxToken: env.MAPBOX_TOKEN },
  payments: {
    provider: env.PAYMENTS_PROVIDER,
    razorpayKeyId: env.RAZORPAY_KEY_ID,
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    simulatedWebhookSecret: env.SIMULATED_WEBHOOK_SECRET || `${devSecret}-simulated-webhook`,
  },
  storageDir: env.STORAGE_DIR || path.join(BACKEND_ROOT, ".data", "uploads"),
  seedDemo: env.SEED_DEMO,
  demoMode: env.DEMO_MODE,
  workerEnabled: env.WORKER_ENABLED === "true",
  logLevel: env.LOG_LEVEL,
  timezone: "Asia/Kolkata",
};
