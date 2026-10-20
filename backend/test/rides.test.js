import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { P, createUser, createVerifiedDriver, db, hoursFromNow, publishRide, resetLimits, useTestServer } from "./helpers.js";
import { evaluateFit, scoreFit } from "../src/services/matching.js";

useTestServer();
beforeEach(() => resetLimits());

const matching = { max_pickup_km: 2.5, max_dropoff_km: 2.5, time_window_minutes: 90, weights: { overlap: 0.35, detour: 0.25, time: 0.25, price: 0.15 } };
const route = [[P.phoenix.lat, P.phoenix.lng], [P.krPuram.lat, P.krPuram.lng], [P.manyata.lat, P.manyata.lng]];

describe("matching engine", () => {
  it("accepts a trip along the route and measures distance along it", () => {
    const fit = evaluateFit({ route, pickup: P.krPuram, dropoff: P.manyata, matching });
    assert.equal(fit.compatible, true);
    assert.ok(fit.pickupDistanceM < 50);
    assert.ok(fit.overlap > 0.9);
    assert.ok(fit.pickupFraction < fit.dropoffFraction);
  });

  it("rejects close endpoints in the wrong order", () => {
    const fit = evaluateFit({ route, pickup: P.manyata, dropoff: P.phoenix, matching });
    assert.equal(fit.compatible, false);
    assert.ok(fit.reasons.includes("wrong_direction"));
  });

  it("rejects pickups far from the route even if the destination matches", () => {
    const fit = evaluateFit({ route, pickup: P.koramangala, dropoff: P.manyata, matching });
    assert.equal(fit.compatible, false);
    assert.ok(fit.reasons.includes("pickup_too_far"));
  });

  it("scores a closer time and lower detour higher", () => {
    const fit = evaluateFit({ route, pickup: P.phoenix, dropoff: P.manyata, matching });
    const desired = new Date("2026-11-02T03:00:00Z");
    const near = scoreFit({ fit, pickupAt: desired, desiredAt: desired, windowMinutes: 90, pricePerSeatPaise: 5000, suggestedPaise: 5000, matching });
    const far = scoreFit({ fit, pickupAt: new Date(desired.getTime() + 80 * 60000), desiredAt: desired, windowMinutes: 90, pricePerSeatPaise: 5000, suggestedPaise: 5000, matching });
    assert.ok(near.score > far.score);
    assert.ok(near.parts.time > far.parts.time);
  });
});

describe("ride creation", () => {
  it("validates timing, area, seats and the cost-sharing cap", async () => {
    const d = await createVerifiedDriver({ seats: 4 });
    const baseRide = { vehicleId: d.vehicleId, origin: P.phoenix, destination: P.manyata, departureAt: hoursFromNow(5), seatsTotal: 3, pricePerSeatPaise: 5000, bookingMode: "instant", publish: true };
    const cases = [
      [{ departureAt: hoursFromNow(-1) }, /at least 15 minutes/],
      [{ destination: P.mysore }, /outside the Bengaluru service area/],
      [{ seatsTotal: 6 }, /has 4 passenger seats/],
      [{ pricePerSeatPaise: 50000 }, /at most Rs/],
    ];
    for (const [change, message] of cases) {
      const r = await d.api.post("/rides", { ...baseRide, ...change });
      assert.ok([400, 422].includes(r.status), JSON.stringify(r.body));
      assert.match(r.body.error.message, message);
    }
  });

  it("lets unverified drivers save drafts but not publish", async () => {
    const u = await createUser({ name: "New Driver" });
    const v = await u.api.post("/vehicles", { make: "Maruti Suzuki", model: "Swift", color: "Red", plateNumber: "ka 05 mn 1234", seats: 4 });
    assert.equal(v.status, 201);
    assert.equal(v.body.plateNumber, "KA05MN1234");
    assert.equal(v.body.verification.status, "not_submitted");
    const ride = { vehicleId: v.body.id, origin: P.phoenix, destination: P.manyata, departureAt: hoursFromNow(5), seatsTotal: 3, pricePerSeatPaise: 4000, bookingMode: "request" };
    assert.equal((await u.api.post("/rides", { ...ride, publish: true })).status, 403);
    const draft = await u.api.post("/rides", { ...ride, publish: false });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.status, "draft");
    assert.equal((await u.api.post(`/rides/${draft.body.id}/publish`)).status, 403);
    const other = await createUser();
    assert.equal((await other.api.get(`/rides/${draft.body.id}`)).status, 404, "drafts are private");
  });

  it("returns a labelled route estimate and a suggested contribution", async () => {
    const d = await createVerifiedDriver();
    const r = await d.api.post("/rides/preview", { origin: P.phoenix, destination: P.manyata, stops: [], departureAt: hoursFromNow(5) });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, "estimate");
    assert.equal(r.body.routeIsEstimate, true);
    assert.ok(r.body.distanceM > 8000 && r.body.distanceM < 20000, String(r.body.distanceM));
    assert.ok(r.body.maxPaise >= r.body.suggestedPaise);
  });

  it("refuses price or time changes after someone books", async () => {
    const d = await createVerifiedDriver();
    const ride = await publishRide(d);
    const p = await createUser();
    await p.api.post(`/rides/${ride.id}/bookings`, { seats: 1, pickup: P.phoenix, dropoff: P.manyata }, { "Idempotency-Key": "edit-test-key-1" });
    const r = await d.api.patch(`/rides/${ride.id}`, { pricePerSeatPaise: 3000 });
    assert.equal(r.status, 409);
    const seats = await d.api.patch(`/rides/${ride.id}`, { seatsTotal: 4 });
    assert.equal(seats.status, 200);
    assert.equal(seats.body.seatsTotal, 4);
  });

  it("masks the number plate until a passenger has a seat", async () => {
    const d = await createVerifiedDriver();
    const ride = await publishRide(d);
    const p = await createUser();
    const before = await p.api.get(`/rides/${ride.id}`);
    assert.match(before.body.vehicle.plateNumber, /••/);
    await p.api.post(`/rides/${ride.id}/bookings`, { seats: 1, pickup: P.phoenix, dropoff: P.manyata }, { "Idempotency-Key": "plate-test-key-1" });
    const after = await p.api.get(`/rides/${ride.id}`);
    assert.doesNotMatch(after.body.vehicle.plateNumber, /••/);
    assert.equal(before.body.driver.phone, undefined, "driver phone is never exposed");
  });
});

describe("search", () => {
  it("finds rides along the route, applies filters and explains the ranking", async () => {
    await db.query("UPDATE rides SET status = 'cancelled' WHERE status = 'published'");
    const a = await createVerifiedDriver({ gender: "female" });
    const b = await createVerifiedDriver();
    const dep = new Date(Date.now() + 26 * 3600000);
    const date = new Date(dep.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const time = new Date(dep.getTime() + 330 * 60000).toISOString().slice(11, 16);
    const cheap = await publishRide(a, { departureAt: dep.toISOString(), pricePerSeatPaise: 3000, bookingMode: "request", womenOnly: true });
    const instant = await publishRide(b, { departureAt: new Date(dep.getTime() + 20 * 60000).toISOString(), pricePerSeatPaise: 6000, bookingMode: "instant" });
    await publishRide(b, { origin: P.koramangala, destination: P.electronicCity, stops: [], departureAt: dep.toISOString() });

    const p = await createUser();
    const q = (extra = "") => p.api.get(`/rides/search?fromLat=${P.phoenix.lat}&fromLng=${P.phoenix.lng}&toLat=${P.manyata.lat}&toLng=${P.manyata.lng}&date=${date}&time=${time}${extra}`);

    const all = await q();
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.items.map((r) => r.id).sort(), [cheap.id, instant.id].sort(), "the Koramangala ride does not match");
    assert.ok(all.body.items[0].match.score >= all.body.items[1].match.score);
    assert.match(all.body.ranking.explanation, /Best match/);
    assert.equal(all.body.routesAreEstimates, true);

    assert.deepEqual((await q("&instantOnly=true")).body.items.map((r) => r.id), [instant.id]);
    assert.deepEqual((await q("&womenOnly=true")).body.items.map((r) => r.id), [cheap.id]);
    assert.deepEqual((await q("&maxPricePaise=4000")).body.items.map((r) => r.id), [cheap.id]);
    assert.deepEqual((await q("&sort=cheapest")).body.items.map((r) => r.id), [cheap.id, instant.id]);
    assert.equal((await q("&seats=4")).body.total, 0, "not enough seats");
    const logged = await db.one("SELECT count(*) FROM search_events WHERE user_id = $1", [p.id]);
    assert.ok(logged.count >= 6);
  });

  it("hides rides from drivers the passenger has blocked", async () => {
    await db.query("UPDATE rides SET status = 'cancelled' WHERE status = 'published'");
    const d = await createVerifiedDriver();
    const dep = new Date(Date.now() + 30 * 3600000);
    const date = new Date(dep.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const ride = await publishRide(d, { departureAt: dep.toISOString() });
    const p = await createUser();
    const url = `/rides/search?fromLat=${P.phoenix.lat}&fromLng=${P.phoenix.lng}&toLat=${P.manyata.lat}&toLng=${P.manyata.lng}&date=${date}`;
    assert.equal((await p.api.get(url)).body.total, 1);
    await p.api.post(`/users/${d.id}/block`);
    assert.equal((await p.api.get(url)).body.total, 0);
    assert.equal((await p.api.get(`/rides/${ride.id}`)).status, 404);
  });
});
