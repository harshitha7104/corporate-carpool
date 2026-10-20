import { db } from "./index.js";
import { logger } from "../lib/logger.js";
import { addDays, istDate, istToInstant, istWeekday } from "../lib/time.js";
import { maps } from "../providers/maps/index.js";
import { BENGALURU_PLACES } from "../providers/maps/bengaluruPlaces.js";
import { storage } from "../providers/storage.js";
import { sha256 } from "../lib/util.js";
import { generateForRule } from "../services/commutes.js";
import { suggestedContribution } from "../services/pricing.js";
import { insertRide } from "../services/rides.js";

// Deterministic, clearly fictional demo data for local development. Every
// row is flagged is_demo and every person is invented. Sign in as any of
// these numbers; with OTP_PROVIDER=dev the code is shown on screen.
export const DEMO_ACCOUNTS = [
  { key: "admin", phone: "+919900000001", name: "Asha Rao", gender: "female", roles: ["admin"] },
  { key: "support", phone: "+919900000002", name: "Ravi Kumar", gender: "male", roles: ["support"] },
  { key: "arjun", phone: "+919900000101", name: "Arjun Kumar", gender: "male", roles: ["driver"], home: "Whitefield", work: "Manyata Tech Park" },
  { key: "priya", phone: "+919900000102", name: "Priya Sharma", gender: "female", roles: ["driver"], home: "Electronic City", work: "Koramangala" },
  { key: "rahul", phone: "+919900000103", name: "Rahul Menon", gender: "male", roles: ["driver"], home: "HSR Layout", work: "Bellandur" },
  { key: "sneha", phone: "+919900000104", name: "Sneha Reddy", gender: "female", roles: ["driver"], home: "Jayanagar", work: "Bagmane Tech Park" },
  { key: "vikram", phone: "+919900000105", name: "Vikram Nair", gender: "male", roles: ["driver"], home: "Indiranagar", work: "ITPL" },
  { key: "ananya", phone: "+919900000106", name: "Ananya Bhat", gender: "female", roles: ["driver"], home: "Hebbal", work: "Electronic City" },
  { key: "karthik", phone: "+919900000107", name: "Karthik Iyer", gender: "male", roles: ["driver"], home: "Marathahalli", work: "MG Road" },
  { key: "meera", phone: "+919900000108", name: "Meera Joshi", gender: "female", roles: ["driver"], home: "Sarjapur Road", work: "Manyata Tech Park" },
  { key: "rohan", phone: "+919900000109", name: "Rohan Das", gender: "male", roles: [], pendingDriver: true },
  { key: "divya", phone: "+919900000201", name: "Divya Pillai", gender: "female", roles: [], home: "Koramangala", work: "Manyata Tech Park" },
  { key: "aditya", phone: "+919900000202", name: "Aditya Gupta", gender: "male", roles: [], home: "Marathahalli", work: "Whitefield" },
  { key: "kavya", phone: "+919900000203", name: "Kavya Thomas", gender: "female", roles: [], home: "BTM Layout", work: "Electronic City" },
];

const VEHICLES = {
  arjun: ["Hyundai", "Creta", "White", "KA01MJ4821", 4, "petrol"],
  priya: ["Maruti Suzuki", "Dzire", "Silver", "KA03NB7310", 4, "cng"],
  rahul: ["Tata", "Nexon EV", "Blue", "KA51EV2207", 4, "electric"],
  sneha: ["Hyundai", "i20", "Red", "KA05MC9134", 4, "petrol"],
  vikram: ["Kia", "Seltos", "Grey", "KA53P6618", 4, "diesel"],
  ananya: ["Toyota", "Innova Crysta", "White", "KA04AB3392", 6, "diesel"],
  karthik: ["Honda", "City", "Black", "KA01HK5076", 4, "petrol"],
  meera: ["MG", "ZS EV", "White", "KA02MG1185", 4, "electric"],
  rohan: ["Maruti Suzuki", "Baleno", "Blue", "KA41RD2290", 4, "petrol"],
};

const place = (name) => {
  const p = BENGALURU_PLACES.find((x) => x.name === name);
  if (!p) throw new Error(`Unknown seed place ${name}`);
  return { label: p.name, lat: p.lat, lng: p.lng };
};

// [driver, from, to, days ahead, "HH:MM", seats, price Rs, mode, women only, notes, stops]
const ONE_OFF = [
  ["arjun", "Phoenix Marketcity", "Manyata Tech Park", 1, "08:15", 3, 120, "instant", false, "AC on. Pickup at the mall's main gate.", ["KR Puram"]],
  ["priya", "Electronic City", "Koramangala", 1, "08:40", 3, 90, "request", false, "No smoking. Small bags only.", ["Bommanahalli"]],
  ["rahul", "HSR Layout", "Ecoworld", 1, "09:10", 3, 45, "instant", false, "Electric car, quiet ride.", []],
  ["sneha", "Jayanagar", "Bagmane Tech Park", 2, "08:30", 3, 110, "request", true, "Women-only ride.", ["Koramangala"]],
  ["vikram", "Indiranagar", "ITPL", 1, "09:00", 3, 100, "instant", false, "Pet friendly. AC on.", ["Marathahalli"]],
  ["ananya", "Hebbal", "Infosys Electronic City", 2, "07:45", 5, 160, "request", false, "Spacious, good for laptop bags.", ["MG Road", "Silk Board"]],
  ["karthik", "Marathahalli", "MG Road", 1, "18:30", 3, 85, "instant", false, "Leaving sharp on time.", ["Domlur"]],
  ["meera", "Sarjapur Road", "Manyata Tech Park", 3, "08:20", 3, 150, "request", true, "Women-only. Phone charger available.", ["Bellandur", "Hebbal"]],
  ["arjun", "Manyata Tech Park", "Whitefield", 1, "18:45", 3, 120, "instant", false, "Evening return via KR Puram.", ["KR Puram"]],
  ["priya", "Koramangala", "Electronic City", 2, "18:15", 3, 90, "request", false, "Evening return.", ["Silk Board"]],
  ["vikram", "BTM Layout", "Whitefield EPIP Zone", 3, "08:50", 3, 130, "instant", false, "Pickup near the Udupi Garden signal.", ["Bellandur"]],
  ["karthik", "Kalyan Nagar", "Embassy Golf Links", 4, "09:20", 3, 80, "instant", false, "Light music.", []],
];

// [driver, from, to, "HH:MM", days, seats, price Rs, stops]
const COMMUTES = [
  ["rahul", "HSR Layout", "Ecoworld", "08:30", [1, 2, 3, 4, 5], 3, 45, []],
  ["meera", "Sarjapur Road", "Manyata Tech Park", "08:00", [1, 3, 5], 3, 150, ["Bellandur", "Hebbal"]],
  ["ananya", "Infosys Electronic City", "Hebbal", "18:00", [1, 2, 3, 4], 5, 160, ["Silk Board", "MG Road"]],
];

// A tiny valid PNG so the verification queue has a viewable document.
const PLACEHOLDER_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c63f8cfc0f01f0005000201" + "5d0d6e1a0000000049454e44ae426082",
  "hex"
);

const nextWeekday = (from, ahead) => {
  let d = from;
  let n = 0;
  while (n < ahead) {
    d = addDays(d, 1);
    const w = istWeekday(d);
    if (w !== 0 && w !== 6) n += 1;
  }
  return d;
};

export const seedDemo = async () => {
  const ids = {};
  const today = istDate();

  for (const a of DEMO_ACCOUNTS) {
    const u = await db.one(
      "INSERT INTO users (phone, email, phone_verified_at, is_demo) VALUES ($1, $2, now(), true) RETURNING id",
      [a.phone, `${a.key}@greenway.example`]
    );
    ids[a.key] = u.id;
    await db.query(
      "INSERT INTO user_profiles (user_id, full_name, gender, home_area, work_area, bio) VALUES ($1, $2, $3, $4, $5, $6)",
      [u.id, a.name, a.gender, a.home || null, a.work || null, "Fictional demo account."]
    );
    await db.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [u.id]);
    for (const role of ["passenger", ...a.roles]) await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [u.id, role]);
  }

  const doc = async (owner, purpose) => {
    const key = await storage.put(PLACEHOLDER_PNG);
    return (await db.one(
      "INSERT INTO files (owner_id, purpose, mime_type, size_bytes, sha256, storage_key) VALUES ($1, $2, 'image/png', $3, $4, $5) RETURNING id",
      [owner, purpose, PLACEHOLDER_PNG.length, sha256(PLACEHOLDER_PNG), key]
    )).id;
  };

  const vehicleIds = {};
  for (const [key, [make, model, color, plate, seats, fuel]] of Object.entries(VEHICLES)) {
    const owner = ids[key];
    const v = await db.one(
      "INSERT INTO vehicles (owner_id, make, model, color, plate_number, seats, fuel_type, year, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,2022,true) RETURNING id",
      [owner, make, model, color, plate, seats, fuel]
    );
    vehicleIds[key] = v.id;
    const pending = key === "rohan";
    const status = pending ? "pending_review" : "verified";
    const reviewer = pending ? null : ids.admin;
    await db.query(
      `INSERT INTO identity_verifications (user_id, kind, document_type, document_last4, document_file_id, status, reviewer_id, reviewed_at)
       VALUES ($1, 'government_id', 'aadhaar', '4821', $2, $3, $4, CASE WHEN $3 = 'verified' THEN now() END)`,
      [owner, await doc(owner, "identity_document"), status, reviewer]
    );
    await db.query(
      `INSERT INTO identity_verifications (user_id, kind, document_type, document_last4, document_file_id, status, reviewer_id, reviewed_at, expires_at)
       VALUES ($1, 'driving_license', 'driving_license', '7731', $2, $3, $4, CASE WHEN $3 = 'verified' THEN now() END, $5)`,
      [owner, await doc(owner, "driving_license"), status, reviewer, `${Number(today.slice(0, 4)) + 8}-03-31`]
    );
    await db.query("INSERT INTO driver_profiles (user_id, license_last4, license_expiry, years_driving) VALUES ($1, '7731', $2, 6)", [owner, `${Number(today.slice(0, 4)) + 8}-03-31`]);
    await db.query(
      `INSERT INTO vehicle_verifications (vehicle_id, rc_file_id, insurance_file_id, insurance_expiry, status, reviewer_id, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'verified' THEN now() END)`,
      [v.id, await doc(owner, "vehicle_rc"), await doc(owner, "vehicle_insurance"), `${Number(today.slice(0, 4)) + 1}-06-30`, status, reviewer]
    );
  }

  const makeRide = async (t, { driver, from, to, date, time, seats, priceRs, mode, womenOnly, notes, stops, status = "published" }) => {
    const input = {
      vehicleId: vehicleIds[driver], origin: place(from), destination: place(to), stops: stops.map(place),
      seatsTotal: seats, pricePerSeatPaise: priceRs * 100, bookingMode: mode, womenOnly, luggage: "small", notes, preferences: { ac: true },
    };
    const departureAt = istToInstant(date, time);
    const route = await maps.route([input.origin, ...input.stops, input.destination], departureAt);
    const pricing = await suggestedContribution(route.distanceM, t);
    input.pricePerSeatPaise = Math.min(input.pricePerSeatPaise, pricing.maxPaise);
    return insertRide(t, { driverId: ids[driver], input, departureAt, route, pricing, status, isDemo: true, cutoff: 30 });
  };

  const rides = [];
  await db.tx(async (t) => {
    for (const [driver, from, to, ahead, time, seats, priceRs, mode, womenOnly, notes, stops] of ONE_OFF) {
      rides.push(await makeRide(t, { driver, from, to, date: nextWeekday(today, ahead), time, seats, priceRs, mode, womenOnly, notes, stops }));
    }
  });

  for (const [driver, from, to, time, days, seats, priceRs, stops] of COMMUTES) {
    const o = place(from);
    const d = place(to);
    const route = await maps.route([o, ...stops.map(place), d], istToInstant(today, time));
    const cap = (await suggestedContribution(route.distanceM)).maxPaise;
    const rule = await db.one(
      `INSERT INTO recurring_commute_rules (driver_id, vehicle_id, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
          stops, days_of_week, departure_time, start_date, seats_total, price_per_seat_paise, booking_mode, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'instant',true) RETURNING *`,
      [ids[driver], vehicleIds[driver], o.label, o.lat, o.lng, d.label, d.lat, d.lng, JSON.stringify(stops.map(place)), days, time, today, seats, Math.min(priceRs * 100, cap)]
    );
    await generateForRule(rule);
  }
  await db.query("UPDATE rides SET is_demo = true WHERE recurring_rule_id IS NOT NULL");

  // A finished trip from last week with a completed booking and reviews, so
  // history, receipts and ratings have something to show.
  const lastWeek = addDays(today, -6);
  const past = await db.tx(async (t) => {
    const r = await makeRide(t, { driver: "arjun", from: "Phoenix Marketcity", to: "Manyata Tech Park", date: lastWeek, time: "08:15", seats: 3, priceRs: 120, mode: "instant", womenOnly: false, notes: "Completed demo trip.", stops: [], status: "completed" });
    await t.query("UPDATE rides SET started_at = departure_at, completed_at = est_arrival_at WHERE id = $1", [r.id]);
    return r;
  });
  const pastBooking = await db.one(
    `INSERT INTO bookings (ride_id, passenger_id, seats, status, seats_held, pickup_label, pickup_lat, pickup_lng, dropoff_label, dropoff_lat, dropoff_lng,
        contribution_paise, total_paise, idempotency_key, requested_at, accepted_at, confirmed_at, started_at, completed_at, is_demo)
     VALUES ($1, $2, 1, 'COMPLETED', true, $3, $4, $5, $6, $7, $8, $9, $9, 'seed-past-1', $10, $10, $10, $11, $12, true) RETURNING *`,
    [past.id, ids.aditya, past.origin_label, past.origin_lat, past.origin_lng, past.destination_label, past.destination_lat, past.destination_lng,
      past.price_per_seat_paise, new Date(new Date(past.departure_at).getTime() - 86400000), past.departure_at, past.est_arrival_at]
  );
  await db.query("UPDATE seat_inventory SET seats_reserved = 1 WHERE ride_id = $1", [past.id]);
  for (const [from, to] of [[null, "REQUESTED"], ["REQUESTED", "ACCEPTED"], ["ACCEPTED", "CONFIRMED"], ["CONFIRMED", "IN_PROGRESS"], ["IN_PROGRESS", "COMPLETED"]]) {
    await db.query("INSERT INTO booking_events (booking_id, from_status, to_status, actor_role, created_at) VALUES ($1, $2, $3, 'system', $4)", [pastBooking.id, from, to, past.departure_at]);
  }
  await db.query(
    `INSERT INTO payments (booking_id, payer_id, provider, provider_order_id, provider_payment_id, status, amount_paise, driver_share_paise, idempotency_key, receipt_number, captured_at, is_demo)
     VALUES ($1, $2, 'simulated', 'sim_order_seed_1', 'sim_pay_seed_1', 'captured', $3, $3, 'seed-pay-1', 'GW-DEMO-0001', $4, true)`,
    [pastBooking.id, ids.aditya, pastBooking.total_paise, pastBooking.requested_at]
  );
  await db.query("INSERT INTO conversations (booking_id) VALUES ($1)", [pastBooking.id]);
  await db.query(
    `INSERT INTO reviews (booking_id, ride_id, reviewer_id, reviewee_id, rating, comment, is_demo) VALUES
       ($1, $2, $3, $4, 5, 'On time and a smooth drive. (Demo review)', true),
       ($1, $2, $4, $3, 5, 'Punctual passenger. (Demo review)', true)`,
    [pastBooking.id, past.id, ids.aditya, ids.arjun]
  );

  // Divya has a pending request on Priya's request-to-book ride, so the
  // driver-side approval flow has something to act on.
  const priyaRide = rides[1];
  await db.one(
    `INSERT INTO bookings (ride_id, passenger_id, seats, status, pickup_label, pickup_lat, pickup_lng, dropoff_label, dropoff_lat, dropoff_lng,
        contribution_paise, total_paise, idempotency_key, expires_at, message, is_demo)
     VALUES ($1, $2, 1, 'REQUESTED', 'Electronic City', 12.8452, 77.6602, 'Koramangala', 12.9352, 77.6245, $3, $3, 'seed-req-1', $4,
        'Hi! I work near Forum Mall. (Demo request)', true)
     RETURNING id`,
    [priyaRide.id, ids.divya, priyaRide.price_per_seat_paise, new Date(Math.min(Date.now() + 4 * 3600000, new Date(priyaRide.departure_at).getTime() - 30 * 60000))]
  ).then(async (b) => {
    await db.query("INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, actor_role) VALUES ($1, NULL, 'REQUESTED', $2, 'passenger')", [b.id, ids.divya]);
    await db.query("INSERT INTO conversations (booking_id) VALUES ($1)", [b.id]);
  });

  await db.query(
    `INSERT INTO support_tickets (user_id, category, subject, description, status, priority) VALUES
       ($1, 'payment', 'Receipt for last week''s ride', 'Can I get a receipt with my company name for reimbursement? (Demo ticket)', 'open', 'normal')`,
    [ids.aditya]
  );
  await db.query("INSERT INTO trusted_contacts (user_id, name, phone, relationship) VALUES ($1, 'Lakshmi Pillai', '+919900000301', 'Sister')", [ids.divya]);

  const { count } = await db.one("SELECT count(*) FROM rides WHERE is_demo");
  logger.info("Seeded fictional demo data", { users: DEMO_ACCOUNTS.length, rides: count });
  return ids;
};

export const seedIfEmpty = async () => {
  const { count } = await db.one("SELECT count(*) FROM users");
  if (count > 0) return false;
  await seedDemo();
  return true;
};
