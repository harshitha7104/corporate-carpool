import { z } from "zod";
import { db, using } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { withinRadius } from "../lib/geo.js";
import { istDate, istToInstant } from "../lib/time.js";
import { parse, point } from "../lib/validate.js";
import { maps } from "../providers/maps/index.js";
import { evaluateFit, scoreFit } from "./matching.js";
import { suggestedContribution } from "./pricing.js";
import { getSetting, getSettings } from "./settings.js";
import { isBlockedEitherWay, isVerifiedDriver, publicProfile } from "./users.js";
import { getOwnVehicle } from "./vehicles.js";
import { vehicleVerificationStatus } from "./verification.js";

export const ACTIVE_BOOKING_STATUSES = ["REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS"];

const preferencesSchema = z
  .object({
    ac: z.boolean().optional(),
    music: z.enum(["quiet", "soft", "any"]).optional(),
    smoking: z.boolean().optional(),
    pets: z.boolean().optional(),
    conversation: z.enum(["quiet", "chatty", "any"]).optional(),
  })
  .default({});

export const rideFields = {
  vehicleId: z.string().uuid(),
  origin: point,
  destination: point,
  stops: z.array(point).max(4).default([]),
  seatsTotal: z.number().int().min(1).max(7),
  pricePerSeatPaise: z.number().int().min(0).max(500000),
  bookingMode: z.enum(["instant", "request"]),
  bookingCutoffMinutes: z.number().int().min(0).max(1440).optional(),
  womenOnly: z.boolean().default(false),
  luggage: z.enum(["none", "small", "medium", "large"]).default("small"),
  notes: z.string().trim().max(500).optional(),
  preferences: preferencesSchema,
};

const createSchema = z.object({
  ...rideFields,
  departureAt: z.string().datetime({ offset: true }),
  publish: z.boolean().default(false),
});

// Shared validation for one-off rides and recurring rules.
export const validateRidePlan = async (user, input, departureAt, client = db) => {
  const settings = await getSettings(client);
  const area = settings.service_area;
  for (const [name, p] of [["Starting point", input.origin], ["Destination", input.destination], ...input.stops.map((s, i) => [`Stop ${i + 1}`, s])]) {
    if (!withinRadius(p, area.center, area.radius_km)) throw badRequest(`${name} is outside the ${area.name} service area.`);
  }
  const vehicle = await getOwnVehicle(user, input.vehicleId, client);
  if (input.seatsTotal > vehicle.seats) throw badRequest(`This vehicle has ${vehicle.seats} passenger seats.`);
  if (input.womenOnly) {
    if (!settings.features.women_only_rides) throw badRequest("Women-only rides are not available right now.");
    const p = await client.one("SELECT gender FROM user_profiles WHERE user_id = $1", [user.id]);
    if (p?.gender !== "female") throw badRequest("Women-only rides can be offered by drivers whose profile says female.");
  }
  const points = [input.origin, ...input.stops, input.destination];
  const route = await maps.route(points, departureAt);
  if (route.distanceM < 1000) throw badRequest("The destination is too close to the starting point.");
  const pricing = await suggestedContribution(route.distanceM, client);
  if (input.pricePerSeatPaise > pricing.maxPaise) {
    throw badRequest(`For this distance the contribution can be at most Rs ${pricing.maxPaise / 100} per seat. Green Way is for sharing costs, not earning a fare.`);
  }
  return { route, pricing, vehicle, points, settings };
};

// Stop offsets in minutes, proportional to distance along the route.
const stopOffsets = (points, route) => {
  const legs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].lat - points[i - 1].lat, points[i].lng - points[i - 1].lng);
    total += d;
    legs.push(total);
  }
  return legs.slice(0, -1).map((cum) => Math.round(((cum / total) * route.durationS) / 60));
};

export const insertRide = async (t, { driverId, input, departureAt, route, pricing, status, ruleId = null, serviceDate = null, isDemo = false, cutoff }) => {
  const arrival = new Date(departureAt.getTime() + route.durationS * 1000);
  const ride = await t.one(
    `INSERT INTO rides (driver_id, vehicle_id, recurring_rule_id, service_date, status,
        origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
        departure_at, est_arrival_at, distance_m, duration_s, route_source, route_geometry,
        seats_total, price_per_seat_paise, suggested_price_paise, booking_mode, booking_cutoff_minutes,
        women_only, luggage, notes, preferences, is_demo, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
        CASE WHEN $5 = 'published' THEN now() END)
     ON CONFLICT (recurring_rule_id, service_date) DO NOTHING
     RETURNING *`,
    [
      driverId, input.vehicleId, ruleId, serviceDate, status,
      input.origin.label, input.origin.lat, input.origin.lng,
      input.destination.label, input.destination.lat, input.destination.lng,
      departureAt, arrival, route.distanceM, route.durationS, route.source, JSON.stringify(route.geometry),
      input.seatsTotal, input.pricePerSeatPaise, pricing.suggestedPaise, input.bookingMode, cutoff,
      input.womenOnly, input.luggage, input.notes || null, input.preferences || {}, isDemo,
    ]
  );
  if (!ride) return null; // already generated for this rule and date
  const offsets = stopOffsets([input.origin, ...input.stops, input.destination], route);
  for (const [i, s] of input.stops.entries()) {
    await t.query(
      "INSERT INTO ride_stops (ride_id, seq, label, lat, lng, offset_minutes) VALUES ($1, $2, $3, $4, $5, $6)",
      [ride.id, i + 1, s.label, s.lat, s.lng, offsets[i] || 0]
    );
  }
  await t.query("INSERT INTO seat_inventory (ride_id, seats_total) VALUES ($1, $2)", [ride.id, input.seatsTotal]);
  return ride;
};

export const assertCanPublish = async (user, vehicleId, client = db) => {
  if (!(await isVerifiedDriver(user.id, client))) {
    throw forbidden("Verify your ID and driving licence before publishing rides. You can save this ride as a draft meanwhile.");
  }
  const vv = await vehicleVerificationStatus(vehicleId, client);
  if (vv.status !== "verified") throw forbidden("This vehicle's documents need to be verified before you can publish rides with it.");
};

export const createRide = async (user, body) => {
  const input = parse(createSchema, body);
  const departureAt = new Date(input.departureAt);
  const minutesAhead = (departureAt.getTime() - Date.now()) / 60000;
  if (minutesAhead < 15) throw badRequest("Departure must be at least 15 minutes from now.");
  if (minutesAhead > 60 * 24 * 60) throw badRequest("You can publish rides up to 60 days ahead.");
  const plan = await validateRidePlan(user, input, departureAt);
  if (input.publish) await assertCanPublish(user, input.vehicleId);
  const cutoff = input.bookingCutoffMinutes ?? plan.settings.booking.default_cutoff_minutes;
  const ride = await db.tx(async (t) => {
    const r = await insertRide(t, { driverId: user.id, input, departureAt, route: plan.route, pricing: plan.pricing, status: input.publish ? "published" : "draft", cutoff });
    await audit({ actor: user, action: input.publish ? "ride.publish" : "ride.draft", entityType: "ride", entityId: r.id, client: t });
    return r;
  });
  return getRide(user, ride.id);
};

// A route and price preview for the create-ride form.
export const previewRide = async (user, body) => {
  const input = parse(z.object({ origin: point, destination: point, stops: z.array(point).max(4).default([]), departureAt: z.string().datetime({ offset: true }) }), body);
  const route = await maps.route([input.origin, ...input.stops, input.destination], new Date(input.departureAt));
  const pricing = await suggestedContribution(route.distanceM);
  return { ...route, ...pricing, routeIsEstimate: route.source === "estimate" };
};

export const publishRide = async (user, rideId) => {
  const ride = await db.one("SELECT * FROM rides WHERE id = $1 AND driver_id = $2", [rideId, user.id]);
  if (!ride) throw notFound("Ride");
  if (ride.status !== "draft") throw conflict("not_draft", "Only draft rides can be published.");
  if ((new Date(ride.departure_at).getTime() - Date.now()) / 60000 < 15) throw badRequest("This ride's departure time has passed. Edit it before publishing.");
  await assertCanPublish(user, ride.vehicle_id);
  await db.query("UPDATE rides SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1", [rideId]);
  await audit({ actor: user, action: "ride.publish", entityType: "ride", entityId: rideId });
  return getRide(user, rideId);
};

const updateSchema = z.object({
  seatsTotal: z.number().int().min(1).max(7).optional(),
  pricePerSeatPaise: z.number().int().min(0).optional(),
  bookingMode: z.enum(["instant", "request"]).optional(),
  bookingCutoffMinutes: z.number().int().min(0).max(1440).optional(),
  luggage: z.enum(["none", "small", "medium", "large"]).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  preferences: preferencesSchema.optional(),
  departureAt: z.string().datetime({ offset: true }).optional(),
});

export const updateRide = async (user, rideId, body) => {
  const input = parse(updateSchema, body);
  await db.tx(async (t) => {
    const ride = await t.one("SELECT * FROM rides WHERE id = $1 AND driver_id = $2 FOR UPDATE", [rideId, user.id]);
    if (!ride) throw notFound("Ride");
    if (!["draft", "published"].includes(ride.status)) throw conflict("ride_locked", "This ride can no longer be edited.");
    const inv = await t.one("SELECT * FROM seat_inventory WHERE ride_id = $1 FOR UPDATE", [rideId]);
    const { count: activeBookings } = await t.one(
      "SELECT count(*) FROM bookings WHERE ride_id = $1 AND status = ANY($2)",
      [rideId, ACTIVE_BOOKING_STATUSES]
    );
    if (activeBookings > 0 && (input.pricePerSeatPaise !== undefined || input.departureAt !== undefined)) {
      throw conflict("has_bookings", "Price and departure time cannot change once people have booked. Cancel the ride instead if plans changed.");
    }
    if (input.seatsTotal !== undefined) {
      const vehicle = await t.one("SELECT seats FROM vehicles WHERE id = $1", [ride.vehicle_id]);
      if (input.seatsTotal > vehicle.seats) throw badRequest(`This vehicle has ${vehicle.seats} passenger seats.`);
      if (input.seatsTotal < inv.seats_reserved) throw badRequest(`${inv.seats_reserved} seats are already booked.`);
      await t.query("UPDATE seat_inventory SET seats_total = $2, updated_at = now() WHERE ride_id = $1", [rideId, input.seatsTotal]);
    }
    if (input.pricePerSeatPaise !== undefined) {
      const max = Math.floor((ride.suggested_price_paise * (await getSetting("pricing", t)).max_multiple_of_suggested) / 500) * 500;
      if (input.pricePerSeatPaise > max) throw badRequest(`The contribution can be at most Rs ${max / 100} per seat for this route.`);
    }
    let departure = ride.departure_at;
    let arrival = ride.est_arrival_at;
    if (input.departureAt) {
      departure = new Date(input.departureAt);
      if ((departure.getTime() - Date.now()) / 60000 < 15) throw badRequest("Departure must be at least 15 minutes from now.");
      arrival = new Date(departure.getTime() + ride.duration_s * 1000);
    }
    await t.query(
      `UPDATE rides SET seats_total = COALESCE($2, seats_total), price_per_seat_paise = COALESCE($3, price_per_seat_paise),
         booking_mode = COALESCE($4, booking_mode), booking_cutoff_minutes = COALESCE($5, booking_cutoff_minutes),
         luggage = COALESCE($6, luggage), notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
         preferences = COALESCE($9, preferences), departure_at = $10, est_arrival_at = $11, updated_at = now()
       WHERE id = $1`,
      [rideId, input.seatsTotal ?? null, input.pricePerSeatPaise ?? null, input.bookingMode ?? null, input.bookingCutoffMinutes ?? null,
        input.luggage ?? null, input.notes !== undefined, input.notes ?? null, input.preferences ?? null, departure, arrival]
    );
    await audit({ actor: user, action: "ride.update", entityType: "ride", entityId: rideId, details: input, client: t });
  });
  return getRide(user, rideId);
};

export const deleteDraft = async (user, rideId) => {
  const r = await db.query("DELETE FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'draft'", [rideId, user.id]);
  if (!r.rowCount) throw notFound("Draft ride");
};

// ---- Reading ------------------------------------------------------------------------
const rideRow = (client, where, params) =>
  using(client).one(
    `SELECT r.*, i.seats_reserved, v.make, v.model, v.color, v.plate_number, v.fuel_type
       FROM rides r JOIN seat_inventory i ON i.ride_id = r.id JOIN vehicles v ON v.id = r.vehicle_id
      WHERE ${where}`,
    params
  );

export const shapeRide = async (r, { viewer, stops, client } = {}) => {
  const isDriver = viewer?.id === r.driver_id;
  const vehicleVerification = await vehicleVerificationStatus(r.vehicle_id, client);
  return {
    id: r.id,
    status: r.status,
    isDemo: r.is_demo,
    origin: { label: r.origin_label, lat: r.origin_lat, lng: r.origin_lng },
    destination: { label: r.destination_label, lat: r.destination_lat, lng: r.destination_lng },
    stops: (stops || []).map((s) => ({ id: s.id, seq: s.seq, label: s.label, lat: s.lat, lng: s.lng, offsetMinutes: s.offset_minutes })),
    departureAt: r.departure_at,
    estArrivalAt: r.est_arrival_at,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    routeSource: r.route_source,
    routeIsEstimate: r.route_source === "estimate",
    route: r.route_geometry,
    seatsTotal: r.seats_total,
    seatsAvailable: r.seats_total - r.seats_reserved,
    pricePerSeatPaise: r.price_per_seat_paise,
    suggestedPricePaise: r.suggested_price_paise,
    bookingMode: r.booking_mode,
    bookingCutoffMinutes: r.booking_cutoff_minutes,
    bookingClosesAt: new Date(new Date(r.departure_at).getTime() - r.booking_cutoff_minutes * 60000),
    womenOnly: r.women_only,
    luggage: r.luggage,
    notes: r.notes,
    preferences: r.preferences,
    recurringRuleId: r.recurring_rule_id,
    locationSharing: r.location_sharing,
    vehicle: {
      make: r.make,
      model: r.model,
      color: r.color,
      // The full plate is shown to the driver and to booked passengers only.
      plateNumber: isDriver || viewer?.bookedOnRide ? r.plate_number : `${r.plate_number.slice(0, 4)}••${r.plate_number.slice(-2)}`,
      fuelType: r.fuel_type,
      verified: vehicleVerification.status === "verified",
    },
    driver: await publicProfile(r.driver_id, client || db),
    isDriver,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
};

export const getRide = async (viewer, rideId) => {
  const r = await rideRow(null, "r.id = $1", [rideId]);
  if (!r) throw notFound("Ride");
  const isDriver = viewer?.id === r.driver_id;
  const myBooking = viewer
    ? await db.one(
        "SELECT id, status FROM bookings WHERE ride_id = $1 AND passenger_id = $2 ORDER BY created_at DESC LIMIT 1",
        [rideId, viewer.id]
      )
    : null;
  const isAdmin = viewer?.permissions?.includes("admin.rides.read");
  if (r.status === "draft" && !isDriver && !isAdmin) throw notFound("Ride");
  if (viewer && !isDriver && (await isBlockedEitherWay(viewer.id, r.driver_id))) throw notFound("Ride");
  const stops = await db.many("SELECT * FROM ride_stops WHERE ride_id = $1 ORDER BY seq", [rideId]);
  const bookedOnRide = myBooking && ["ACCEPTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(myBooking.status);
  const ride = await shapeRide(r, { viewer: viewer && { ...viewer, bookedOnRide }, stops });
  return { ...ride, myBooking: myBooking || null };
};

const listSchema = z.object({
  scope: z.enum(["upcoming", "past", "drafts", "all"]).default("upcoming"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listDriverRides = async (user, query) => {
  const q = parse(listSchema, query);
  const where = {
    upcoming: "r.status IN ('published','in_progress')",
    past: "r.status IN ('completed','cancelled')",
    drafts: "r.status = 'draft'",
    all: "true",
  }[q.scope];
  const order = q.scope === "upcoming" || q.scope === "drafts" ? "r.departure_at ASC" : "r.departure_at DESC";
  const rows = await db.many(
    `SELECT r.*, i.seats_reserved, v.make, v.model, v.color, v.plate_number, v.fuel_type,
            (SELECT count(*) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'REQUESTED') AS pending_requests
       FROM rides r JOIN seat_inventory i ON i.ride_id = r.id JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.driver_id = $1 AND ${where} ORDER BY ${order} LIMIT $2 OFFSET $3`,
    [user.id, q.limit, q.offset]
  );
  return Promise.all(rows.map(async (r) => ({ ...(await shapeRide(r, { viewer: user })), pendingRequests: r.pending_requests })));
};

// ---- Search -------------------------------------------------------------------------
const searchSchema = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  fromLabel: z.string().max(120).optional(),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
  toLabel: z.string().max(120).optional(),
  date: z.string().date().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  flexMinutes: z.coerce.number().int().min(15).max(360).optional(),
  seats: z.coerce.number().int().min(1).max(6).default(1),
  maxPricePaise: z.coerce.number().int().min(0).optional(),
  verifiedOnly: z.enum(["true", "false"]).optional(),
  instantOnly: z.enum(["true", "false"]).optional(),
  womenOnly: z.enum(["true", "false"]).optional(),
  sort: z.enum(["best", "earliest", "cheapest"]).default("best"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchRides = async (viewer, query) => {
  const q = parse(searchSchema, query);
  const settings = await getSettings();
  const matching = settings.matching;
  const pickup = { lat: q.fromLat, lng: q.fromLng };
  const dropoff = { lat: q.toLat, lng: q.toLng };
  const window = q.flexMinutes ?? matching.time_window_minutes;
  const date = q.date || istDate();
  const desiredAt = q.time ? istToInstant(date, q.time) : null;
  const from = desiredAt ? new Date(desiredAt.getTime() - window * 60000) : istToInstant(date, "00:00");
  const to = desiredAt ? new Date(desiredAt.getTime() + window * 60000) : istToInstant(date, "23:59");

  const candidates = await db.many(
    `SELECT r.*, i.seats_reserved, v.make, v.model, v.color, v.plate_number, v.fuel_type
       FROM rides r JOIN seat_inventory i ON i.ride_id = r.id JOIN vehicles v ON v.id = r.vehicle_id
       JOIN users du ON du.id = r.driver_id
      WHERE r.status = 'published'
        AND r.departure_at BETWEEN $1 AND $2
        AND r.departure_at - make_interval(mins => r.booking_cutoff_minutes) > now()
        AND r.seats_total - i.seats_reserved >= $3
        AND ($4::int IS NULL OR r.price_per_seat_paise <= $4)
        AND ($5::boolean IS NOT TRUE OR r.booking_mode = 'instant')
        AND ($6::boolean IS NOT TRUE OR r.women_only)
        AND du.status = 'active'
        AND ($7::uuid IS NULL OR (r.driver_id <> $7 AND NOT EXISTS (
              SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $7 AND b.blocked_id = r.driver_id) OR (b.blocker_id = r.driver_id AND b.blocked_id = $7))))
      ORDER BY r.departure_at
      LIMIT 300`,
    [from, to, q.seats, q.maxPricePaise ?? null, q.instantOnly === "true", q.womenOnly === "true", viewer?.id ?? null]
  );

  const results = [];
  for (const r of candidates) {
    const fit = evaluateFit({ route: r.route_geometry, pickup, dropoff, matching });
    if (!fit.compatible) continue;
    const pickupAt = new Date(new Date(r.departure_at).getTime() + fit.pickupFraction * r.duration_s * 1000);
    const dropoffAt = new Date(new Date(r.departure_at).getTime() + fit.dropoffFraction * r.duration_s * 1000);
    const { score, parts } = scoreFit({ fit, pickupAt, desiredAt, windowMinutes: window, pricePerSeatPaise: r.price_per_seat_paise, suggestedPaise: r.suggested_price_paise, matching });
    results.push({ r, fit, score, parts, pickupAt, dropoffAt });
  }

  let shaped = await Promise.all(
    results.map(async ({ r, fit, score, parts, pickupAt, dropoffAt }) => ({
      ...(await shapeRide(r, { viewer })),
      match: {
        score,
        parts,
        pickupDistanceM: fit.pickupDistanceM,
        dropoffDistanceM: fit.dropoffDistanceM,
        sharedDistanceM: fit.sharedM,
        detourM: fit.detourM,
        estimatedPickupAt: pickupAt,
        estimatedDropoffAt: dropoffAt,
        isEstimate: r.route_source === "estimate",
      },
    }))
  );
  if (q.verifiedOnly === "true") shaped = shaped.filter((s) => s.driver.idVerified && s.driver.licenceVerified && s.vehicle.verified);
  const sorters = {
    best: (a, b) => b.match.score - a.match.score,
    earliest: (a, b) => new Date(a.match.estimatedPickupAt) - new Date(b.match.estimatedPickupAt),
    cheapest: (a, b) => a.pricePerSeatPaise - b.pricePerSeatPaise,
  };
  shaped.sort(sorters[q.sort]);

  await db.query(
    "INSERT INTO search_events (user_id, origin_label, destination_label, results_count) VALUES ($1, $2, $3, $4)",
    [viewer?.id ?? null, q.fromLabel || null, q.toLabel || null, shaped.length]
  );

  return {
    total: shaped.length,
    items: shaped.slice(q.offset, q.offset + q.limit),
    window: { from, to },
    ranking: {
      sort: q.sort,
      weights: matching.weights,
      explanation:
        "Best match combines how much of your trip the route covers, the extra distance the driver needs for your pickup and drop-off, how close the pickup time is to yours, and the contribution compared with the suggested amount.",
    },
    mapsProvider: maps.name,
    routesAreEstimates: !maps.live,
  };
};
