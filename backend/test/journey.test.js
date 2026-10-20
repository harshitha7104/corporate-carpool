import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { P, anon, base, client, createUser, db, idemKey, pngBytes, resetLimits, useTestServer } from "./helpers.js";
import { addDays, istDate } from "../src/lib/time.js";

useTestServer();

// Sign in through the real OTP endpoints (development provider).
const signUp = async (phone, profile) => {
  const r = await anon().post("/auth/otp/request", { channel: "sms", phone });
  const res = await fetch(`${base}/api/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ challengeId: r.body.challengeId, code: r.body.devCode }),
  });
  assert.equal(res.status, 200);
  const api = client(res.headers.get("set-cookie").split(";")[0]);
  assert.equal((await api.patch("/users/me", profile)).status, 200);
  return api;
};

describe("end-to-end journey (brief section 19)", () => {
  it("register, verify, publish, search, request, accept, pay, ride, complete, review", async () => {
    resetLimits();
    // 1. Register a passenger.
    const passenger = await signUp("9900011001", { fullName: "Meghana Rao", gender: "female", homeArea: "KR Puram" });

    // 2. Create a driver and a vehicle.
    const driver = await signUp("9900011002", { fullName: "Suresh Gowda", gender: "male" });
    const vehicle = await driver.post("/vehicles", { make: "Maruti Suzuki", model: "Ertiga", color: "Grey", plateNumber: "KA 53 MX 4410", seats: 5, fuelType: "cng", year: 2023 });
    assert.equal(vehicle.status, 201);

    // 3. Submit verification and have an admin approve it.
    const up = async (purpose) => (await driver.post(`/files?purpose=${purpose}`, pngBytes, { "Content-Type": "image/png" })).body.id;
    assert.equal((await driver.post("/users/me/verification", { kind: "government_id", documentType: "aadhaar", documentLast4: "9921", fileId: await up("identity_document") })).status, 201);
    assert.equal((await driver.post("/users/me/verification", { kind: "driving_license", documentType: "driving_license", documentLast4: "KA53", fileId: await up("driving_license"), expiresAt: "2034-06-30" })).status, 201);
    assert.equal((await driver.post(`/vehicles/${vehicle.body.id}/verification`, { rcFileId: await up("vehicle_rc"), insuranceFileId: await up("vehicle_insurance"), insuranceExpiry: "2027-09-30" })).status, 201);
    const admin = await createUser({ roles: ["admin"] });
    for (const type of ["identity", "vehicle"]) {
      const q = await admin.api.get(`/admin/verifications?type=${type}`);
      for (const item of q.body.items) {
        const r = await admin.api.post(`/admin/verifications/${type}/${item.id}/decision`, { decision: "verified" });
        assert.equal(r.status, 200);
      }
    }
    const me = (await driver.get("/auth/me")).body;
    assert.ok(me.roles.includes("driver"));

    // 4. Publish a request-to-book ride tomorrow at 08:30 IST.
    const date = addDays(istDate(), 1);
    const departureAt = new Date(`${date}T08:30:00+05:30`).toISOString();
    const preview = await driver.post("/rides/preview", { origin: P.phoenix, destination: P.manyata, stops: [P.krPuram], departureAt });
    const ride = await driver.post("/rides", {
      vehicleId: vehicle.body.id, origin: P.phoenix, destination: P.manyata, stops: [P.krPuram], departureAt,
      seatsTotal: 4, pricePerSeatPaise: preview.body.suggestedPaise, bookingMode: "request", publish: true, notes: "AC on",
    });
    assert.equal(ride.status, 201, JSON.stringify(ride.body));

    // 5. The passenger searches from KR Puram to Manyata and finds it.
    const search = await passenger.get(`/rides/search?fromLat=${P.krPuram.lat}&fromLng=${P.krPuram.lng}&toLat=${P.manyata.lat}&toLng=${P.manyata.lng}&date=${date}&time=08:45&seats=2`);
    const hit = search.body.items.find((r) => r.id === ride.body.id);
    assert.ok(hit, "the ride appears in search");
    assert.equal(hit.driver.idVerified && hit.driver.licenceVerified && hit.vehicle.verified, true);
    assert.ok(hit.match.pickupDistanceM < 100);

    // 6. Request two seats.
    const request = await passenger.post(`/rides/${ride.body.id}/bookings`, { seats: 2, pickup: P.krPuram, dropoff: P.manyata, message: "Two of us from the same office" }, { "Idempotency-Key": idemKey() });
    assert.equal(request.status, 201);
    assert.equal(request.body.status, "REQUESTED");
    const driverInbox = await driver.get("/notifications");
    assert.ok(driverInbox.body.items.some((n) => n.type === "booking.request_received"));

    // Booking-scoped chat, without phone numbers.
    const sent = await passenger.post(`/conversations/${request.body.conversationId}/messages`, { text: "We will wait at the KR Puram bus stop." });
    assert.equal(sent.status, 201);
    const thread = await driver.get(`/conversations/${request.body.conversationId}/messages`);
    assert.equal(thread.body.messages[0].body, "We will wait at the KR Puram bus stop.");

    // 7. The driver accepts.
    const accepted = await driver.post(`/bookings/${request.body.id}/accept`);
    assert.equal(accepted.body.status, "ACCEPTED");

    // 8. Seat inventory reflects the hold.
    const seats = await db.one("SELECT seats_total, seats_reserved FROM seat_inventory WHERE ride_id = $1", [ride.body.id]);
    assert.deepEqual(seats, { seats_total: 4, seats_reserved: 2 });
    assert.equal((await passenger.get(`/rides/${ride.body.id}`)).body.seatsAvailable, 2);

    // Pay through the simulated gateway (signed webhook path).
    const checkout = await passenger.post("/payments/checkout", { bookingId: request.body.id }, { "Idempotency-Key": idemKey() });
    assert.equal(checkout.body.payment.amountPaise, preview.body.suggestedPaise * 2);
    await passenger.post(`/payments/${checkout.body.payment.id}/simulate`, { outcome: "success" });
    assert.equal((await passenger.get(`/bookings/${request.body.id}`)).body.status, "CONFIRMED");

    // 9. Run and complete the ride.
    await db.query("UPDATE rides SET departure_at = now() + interval '10 minutes', est_arrival_at = now() + interval '50 minutes' WHERE id = $1", [ride.body.id]);
    assert.equal((await driver.post(`/rides/${ride.body.id}/start`, { shareLocation: true })).status, 200);
    assert.equal((await driver.post(`/trips/${ride.body.id}/location`, { lat: 13.0, lng: 77.69 })).status, 200);
    assert.equal((await passenger.get(`/trips/${ride.body.id}/live`)).body.location.lat, 13.0);
    assert.equal((await driver.post(`/bookings/${request.body.id}/pickup`)).body.status, "IN_PROGRESS");
    assert.equal((await driver.post(`/rides/${ride.body.id}/complete`)).status, 200);
    assert.equal((await passenger.get(`/bookings/${request.body.id}`)).body.status, "COMPLETED");

    // 10. Submit a review; the driver's rating reflects it.
    assert.equal((await passenger.post(`/bookings/${request.body.id}/review`, { rating: 5, comment: "Punctual and friendly." })).status, 201);
    const profile = await passenger.get(`/users/${me.id}/profile`);
    assert.equal(profile.body.rating, 5);
    assert.equal(profile.body.reviewCount, 1);

    const summary = await driver.get("/payments/driver-summary");
    assert.equal(summary.body.netPaise, preview.body.suggestedPaise * 2);
  });
});
