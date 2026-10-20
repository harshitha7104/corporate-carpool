import { z } from "zod";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { addDays, istDate, istToInstant, istWeekday } from "../lib/time.js";
import { parse, point } from "../lib/validate.js";
import { cancelRide } from "./bookings.js";
import { assertCanPublish, insertRide, rideFields, validateRidePlan, searchRides } from "./rides.js";
import { getSettings } from "./settings.js";

const GENERATE_DAYS_AHEAD = 14;

const ruleSchema = z.object({
  ...rideFields,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM."),
  startDate: z.string().date(),
  endDate: z.string().date().nullable().optional(),
  skipDates: z.array(z.string().date()).max(60).default([]),
});

const ruleInput = (rule) => ({
  vehicleId: rule.vehicle_id,
  origin: { label: rule.origin_label, lat: rule.origin_lat, lng: rule.origin_lng },
  destination: { label: rule.destination_label, lat: rule.destination_lat, lng: rule.destination_lng },
  stops: rule.stops,
  seatsTotal: rule.seats_total,
  pricePerSeatPaise: rule.price_per_seat_paise,
  bookingMode: rule.booking_mode,
  womenOnly: rule.women_only,
  luggage: rule.luggage,
  notes: rule.notes,
  preferences: rule.preferences,
});

const shapeRule = (r) => ({
  id: r.id,
  status: r.status,
  isDemo: r.is_demo,
  vehicleId: r.vehicle_id,
  origin: { label: r.origin_label, lat: r.origin_lat, lng: r.origin_lng },
  destination: { label: r.destination_label, lat: r.destination_lat, lng: r.destination_lng },
  stops: r.stops,
  daysOfWeek: r.days_of_week,
  departureTime: r.departure_time.slice(0, 5),
  timezone: r.timezone,
  startDate: r.start_date,
  endDate: r.end_date,
  skipDates: r.skip_dates,
  seatsTotal: r.seats_total,
  pricePerSeatPaise: r.price_per_seat_paise,
  bookingMode: r.booking_mode,
  bookingCutoffMinutes: r.booking_cutoff_minutes,
  womenOnly: r.women_only,
  luggage: r.luggage,
  notes: r.notes,
  generatedThrough: r.generated_through,
});

export const createRule = async (user, body) => {
  if (!(await getSettings()).features.recurring_commutes) throw conflict("disabled", "Recurring commutes are turned off right now.");
  const input = parse(ruleSchema, body);
  if (input.endDate && input.endDate < input.startDate) throw badRequest("The end date must be after the start date.");
  if (input.startDate < istDate()) throw badRequest("The start date cannot be in the past.");
  const sample = istToInstant(input.startDate, input.departureTime);
  await validateRidePlan(user, input, sample);
  await assertCanPublish(user, input.vehicleId);
  const settings = await getSettings();
  const rule = await db.one(
    `INSERT INTO recurring_commute_rules (driver_id, vehicle_id, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
        stops, days_of_week, departure_time, start_date, end_date, skip_dates, seats_total, price_per_seat_paise, booking_mode,
        booking_cutoff_minutes, women_only, luggage, notes, preferences)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [user.id, input.vehicleId, input.origin.label, input.origin.lat, input.origin.lng, input.destination.label, input.destination.lat,
      input.destination.lng, JSON.stringify(input.stops), input.daysOfWeek, input.departureTime, input.startDate, input.endDate || null,
      input.skipDates, input.seatsTotal, input.pricePerSeatPaise, input.bookingMode,
      input.bookingCutoffMinutes ?? settings.booking.default_cutoff_minutes, input.womenOnly, input.luggage, input.notes || null, input.preferences]
  );
  await audit({ actor: user, action: "commute.create", entityType: "recurring_commute_rule", entityId: rule.id });
  await generateForRule(rule);
  return shapeRule(await db.one("SELECT * FROM recurring_commute_rules WHERE id = $1", [rule.id]));
};

// Create rides for the next GENERATE_DAYS_AHEAD days. Safe to run repeatedly:
// (recurring_rule_id, service_date) is unique, so retries insert nothing new.
export const generateForRule = async (rule) => {
  if (rule.status !== "active") return 0;
  const today = istDate();
  const through = addDays(today, GENERATE_DAYS_AHEAD);
  const driver = { id: rule.driver_id };
  let created = 0;
  for (let d = rule.start_date > today ? rule.start_date : today; d <= through; d = addDays(d, 1)) {
    if (rule.end_date && d > rule.end_date) break;
    if (!rule.days_of_week.includes(istWeekday(d))) continue;
    if ((rule.skip_dates || []).includes(d)) continue;
    const departureAt = istToInstant(d, rule.departure_time);
    if (departureAt.getTime() - Date.now() < 20 * 60000) continue;
    const exists = await db.one("SELECT 1 FROM rides WHERE recurring_rule_id = $1 AND service_date = $2", [rule.id, d]);
    if (exists) continue;
    try {
      const input = ruleInput(rule);
      const plan = await validateRidePlan(driver, input, departureAt);
      const ride = await db.tx((t) =>
        insertRide(t, { driverId: rule.driver_id, input, departureAt, route: plan.route, pricing: plan.pricing, status: "published",
          ruleId: rule.id, serviceDate: d, isDemo: rule.is_demo, cutoff: rule.booking_cutoff_minutes })
      );
      if (ride) created += 1;
    } catch (err) {
      logger.warn("Could not generate a commute ride", { ruleId: rule.id, date: d, error: err.message });
    }
  }
  await db.query("UPDATE recurring_commute_rules SET generated_through = $2, updated_at = now() WHERE id = $1", [rule.id, through]);
  return created;
};

export const generateAll = async () => {
  const rules = await db.many(
    "SELECT * FROM recurring_commute_rules WHERE status = 'active' AND (end_date IS NULL OR end_date >= $1)",
    [istDate()]
  );
  let created = 0;
  for (const rule of rules) created += await generateForRule(rule);
  await db.query("UPDATE recurring_commute_rules SET status = 'ended', updated_at = now() WHERE status = 'active' AND end_date < $1", [istDate()]);
  return created;
};

export const listRules = async (user) => {
  const rows = await db.many("SELECT * FROM recurring_commute_rules WHERE driver_id = $1 ORDER BY created_at DESC", [user.id]);
  return Promise.all(rows.map(async (r) => ({
    ...shapeRule(r),
    upcoming: await db.many(
      `SELECT r.id, r.service_date, r.departure_at, r.status, r.seats_total - i.seats_reserved AS seats_available
         FROM rides r JOIN seat_inventory i ON i.ride_id = r.id
        WHERE r.recurring_rule_id = $1 AND r.departure_at > now() ORDER BY r.departure_at LIMIT 10`,
      [r.id]
    ),
  })));
};

const ownRule = async (user, id) => {
  const r = await db.one("SELECT * FROM recurring_commute_rules WHERE id = $1 AND driver_id = $2", [id, user.id]);
  if (!r) throw notFound("Commute");
  return r;
};

const patchSchema = z.object({
  status: z.enum(["active", "paused", "ended"]).optional(),
  skipDate: z.string().date().optional(),
  endDate: z.string().date().nullable().optional(),
  reason: z.string().trim().min(3).max(200).optional(),
});

// Pausing or ending stops new rides; skipping a date cancels that day's ride
// (refunding anyone booked). Already-booked rides are never silently changed.
export const updateRule = async (user, id, body) => {
  const input = parse(patchSchema, body);
  const rule = await ownRule(user, id);
  if (input.skipDate) {
    const ride = await db.one("SELECT id, status FROM rides WHERE recurring_rule_id = $1 AND service_date = $2", [id, input.skipDate]);
    await db.query("UPDATE recurring_commute_rules SET skip_dates = array_append(skip_dates, $2::date), updated_at = now() WHERE id = $1 AND NOT ($2::date = ANY(skip_dates))", [id, input.skipDate]);
    if (ride && ["draft", "published"].includes(ride.status)) await cancelRide(user, ride.id, { reason: input.reason || "Driver is not commuting that day" });
  }
  if (input.endDate !== undefined) {
    if (input.endDate && input.endDate < rule.start_date) throw badRequest("The end date must be after the start date.");
    await db.query("UPDATE recurring_commute_rules SET end_date = $2, updated_at = now() WHERE id = $1", [id, input.endDate]);
  }
  if (input.status) {
    await db.query("UPDATE recurring_commute_rules SET status = $2, updated_at = now() WHERE id = $1", [id, input.status]);
    if (input.status === "active") await generateForRule({ ...rule, status: "active" });
  }
  await audit({ actor: user, action: "commute.update", entityType: "recurring_commute_rule", entityId: id, details: input });
  return shapeRule(await db.one("SELECT * FROM recurring_commute_rules WHERE id = $1", [id]));
};

// ---- Passenger commutes ------------------------------------------------------------
const passengerSchema = z.object({
  origin: point,
  destination: point,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const addPassengerCommute = async (user, body) => {
  const input = parse(passengerSchema, body);
  if (input.windowEnd <= input.windowStart) throw badRequest("The latest time must be after the earliest time.");
  const { count } = await db.one("SELECT count(*) FROM passenger_commutes WHERE user_id = $1", [user.id]);
  if (count >= 10) throw badRequest("You can save up to 10 regular trips.");
  return db.one(
    `INSERT INTO passenger_commutes (user_id, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng, days_of_week, window_start, window_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [user.id, input.origin.label, input.origin.lat, input.origin.lng, input.destination.label, input.destination.lat, input.destination.lng,
      input.daysOfWeek, input.windowStart, input.windowEnd]
  );
};

export const listPassengerCommutes = (user) =>
  db.many("SELECT * FROM passenger_commutes WHERE user_id = $1 ORDER BY created_at", [user.id]);

export const removePassengerCommute = async (user, id) => {
  const r = await db.query("DELETE FROM passenger_commutes WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (!r.rowCount) throw notFound("Regular trip");
};

// Rides over the next week that fit a saved regular trip.
export const matchesForPassengerCommute = async (user, id) => {
  const c = await db.one("SELECT * FROM passenger_commutes WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (!c) throw notFound("Regular trip");
  const [sh, sm] = c.window_start.split(":").map(Number);
  const [eh, em] = c.window_end.split(":").map(Number);
  const mid = (sh * 60 + sm + eh * 60 + em) / 2;
  const time = `${String(Math.floor(mid / 60)).padStart(2, "0")}:${String(Math.round(mid % 60)).padStart(2, "0")}`;
  const flex = Math.max(15, Math.ceil((eh * 60 + em - (sh * 60 + sm)) / 2));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(istDate(), i);
    if (!c.days_of_week.includes(istWeekday(d))) continue;
    const res = await searchRides(user, {
      fromLat: c.origin_lat, fromLng: c.origin_lng, toLat: c.destination_lat, toLng: c.destination_lng,
      fromLabel: c.origin_label, toLabel: c.destination_label, date: d, time, flexMinutes: flex, limit: 5,
    });
    days.push({ date: d, rides: res.items });
  }
  return { commute: c, days };
};
