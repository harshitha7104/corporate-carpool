import { z } from "zod";
import { db, using } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";

// Platform configuration lives in platform_config and is editable by admins.
// Each key has a schema so a bad edit cannot break booking or pricing.
const pct = z.number().min(0).max(100);
export const SETTING_SCHEMAS = {
  fees: z.object({ platform_fee_percent: pct, platform_fee_min_paise: z.number().int().min(0) }),
  pricing: z.object({
    suggested_paise_per_km: z.number().int().min(0).max(5000),
    minimum_paise: z.number().int().min(0),
    max_multiple_of_suggested: z.number().min(1).max(3),
  }),
  cancellation: z.object({
    free_until_minutes_before: z.number().int().min(0).max(2880),
    late_refund_percent: pct,
    driver_cancel_refund_percent: pct,
  }),
  booking: z.object({
    default_cutoff_minutes: z.number().int().min(0).max(1440),
    request_expiry_minutes: z.number().int().min(5).max(2880),
    payment_window_minutes: z.number().int().min(5).max(240),
    max_seats_per_booking: z.number().int().min(1).max(6),
  }),
  matching: z.object({
    max_pickup_km: z.number().min(0.2).max(15),
    max_dropoff_km: z.number().min(0.2).max(15),
    time_window_minutes: z.number().int().min(10).max(360),
    weights: z.object({ overlap: z.number().min(0), detour: z.number().min(0), time: z.number().min(0), price: z.number().min(0) }),
  }),
  service_area: z.object({
    name: z.string(),
    center: z.object({ lat: z.number(), lng: z.number() }),
    radius_km: z.number().min(1).max(200),
  }),
  safety: z.object({
    emergency_number: z.string().regex(/^\d{3,5}$/),
    emergency_label: z.string().max(120),
    trip_share_hours: z.number().int().min(1).max(72),
    location_retention_days: z.number().int().min(1).max(90),
  }),
  features: z.object({
    recurring_commutes: z.boolean(),
    women_only_rides: z.boolean(),
    chat: z.boolean(),
    live_location: z.boolean(),
  }),
};

let cache = null;
let cachedAt = 0;

export const getSettings = async (client) => {
  if (!client && cache && Date.now() - cachedAt < 10000) return cache;
  const rows = await using(client).many("SELECT key, value FROM platform_config");
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!client) {
    cache = settings;
    cachedAt = Date.now();
  }
  return settings;
};

export const getSetting = async (key, client) => (await getSettings(client))[key];

export const updateSetting = async (actor, key, value) => {
  const schema = SETTING_SCHEMAS[key];
  if (!schema) throw notFound("Setting");
  const clean = parse(schema, value);
  await db.tx(async (t) => {
    const before = await t.one("SELECT value FROM platform_config WHERE key = $1 FOR UPDATE", [key]);
    await t.query("UPDATE platform_config SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1", [key, clean, actor.id]);
    await audit({ actor, action: "config.update", entityType: "platform_config", entityId: key, details: { before: before?.value, after: clean }, client: t });
  });
  cache = null;
  return clean;
};

export const clearSettingsCache = () => {
  cache = null;
};
