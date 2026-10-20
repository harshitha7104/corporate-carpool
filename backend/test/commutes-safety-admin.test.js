import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { P, anon, book, createUser, createVerifiedDriver, db, hoursFromNow, publishRide, resetLimits, resetSettings, useTestServer } from "./helpers.js";
import { addDays, istDate, istWeekday } from "../src/lib/time.js";
import { generateAll } from "../src/services/commutes.js";

useTestServer();
beforeEach(() => resetLimits());

describe("recurring commutes", () => {
  it("generates one ride per matching weekday, and re-running creates nothing new", async () => {
    const d = await createVerifiedDriver();
    const start = addDays(istDate(), 1);
    const res = await d.api.post("/commutes", {
      vehicleId: d.vehicleId, origin: P.phoenix, destination: P.manyata, stops: [P.krPuram], seatsTotal: 3, pricePerSeatPaise: 5000,
      bookingMode: "instant", daysOfWeek: [1, 2, 3, 4, 5], departureTime: "08:30", startDate: start,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const rides = await db.many("SELECT service_date, departure_at FROM rides WHERE recurring_rule_id = $1 ORDER BY service_date", [res.body.id]);
    assert.ok(rides.length >= 9, `expected two weeks of weekdays, got ${rides.length}`);
    for (const r of rides) {
      assert.ok(![0, 6].includes(istWeekday(r.service_date)), "no weekend rides");
      const ist = new Date(new Date(r.departure_at).getTime() + 330 * 60000).toISOString().slice(11, 16);
      assert.equal(ist, "08:30", "departure is 08:30 in Asia/Kolkata");
    }
    await generateAll();
    await generateAll();
    const again = await db.one("SELECT count(*) FROM rides WHERE recurring_rule_id = $1", [res.body.id]);
    assert.equal(again.count, rides.length, "retries never duplicate ride instances");
  });

  it("cancels a skipped day (refunding bookings) and pausing stops new rides", async () => {
    const d = await createVerifiedDriver();
    const res = await d.api.post("/commutes", {
      vehicleId: d.vehicleId, origin: P.phoenix, destination: P.manyata, seatsTotal: 2, pricePerSeatPaise: 0, bookingMode: "instant",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], departureTime: "09:00", startDate: addDays(istDate(), 2),
    });
    const first = await db.one("SELECT id, service_date FROM rides WHERE recurring_rule_id = $1 ORDER BY service_date LIMIT 1", [res.body.id]);
    const p = await createUser();
    const b = await book(p, first.id);
    assert.equal(b.body.status, "CONFIRMED");
    const skip = await d.api.patch(`/commutes/${res.body.id}`, { skipDate: first.service_date, reason: "Public holiday" });
    assert.equal(skip.status, 200);
    assert.ok(skip.body.skipDates.includes(first.service_date));
    assert.equal((await p.api.get(`/bookings/${b.body.id}`)).body.status, "CANCELLED_BY_DRIVER");
    const paused = await d.api.patch(`/commutes/${res.body.id}`, { status: "paused" });
    assert.equal(paused.body.status, "paused");
    const before = (await db.one("SELECT count(*) FROM rides WHERE recurring_rule_id = $1", [res.body.id])).count;
    await db.query("UPDATE recurring_commute_rules SET end_date = NULL WHERE id = $1", [res.body.id]);
    await generateAll();
    assert.equal((await db.one("SELECT count(*) FROM rides WHERE recurring_rule_id = $1", [res.body.id])).count, before);
  });
});

describe("safety", () => {
  it("escalates serious reports to support and lets the reporter block the person", async () => {
    const d = await createVerifiedDriver();
    const ride = await publishRide(d);
    const p = await createUser();
    await book(p, ride.id);
    const r = await p.api.post("/safety/reports", { category: "harassment", description: "Driver made inappropriate comments.", rideId: ride.id, subjectUserId: d.id, blockSubject: true });
    assert.equal(r.status, 201);
    assert.equal(r.body.severity, "high");
    const ticket = await db.one("SELECT escalated, priority FROM support_tickets WHERE safety_report_id = $1", [r.body.id]);
    assert.deepEqual(ticket, { escalated: true, priority: "high" });
    assert.ok(await db.one("SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [p.id, d.id]));
    const outsider = await createUser();
    assert.equal((await outsider.api.post("/safety/reports", { category: "other", description: "I was not on this ride at all.", rideId: ride.id })).status, 404);
  });

  it("SOS records a critical report and reports honestly that texts were not delivered", async () => {
    const u = await createUser();
    await u.api.post("/users/me/trusted-contacts", { name: "Appa", phone: "98450 22222" });
    const r = await u.api.post("/safety/sos", { lat: 12.97, lng: 77.6 });
    assert.equal(r.status, 201);
    assert.equal(r.body.emergency.number, "112");
    assert.deepEqual(r.body.contacts, [{ name: "Appa", status: "logged_dev" }]);
    const report = await db.one("SELECT severity, category FROM safety_reports WHERE id = $1", [r.body.reportId]);
    assert.deepEqual(report, { severity: "critical", category: "emergency" });
  });

  it("shares a trip through an expiring, revocable link and only shows location with consent", async () => {
    const d = await createVerifiedDriver();
    const ride = await publishRide(d, { departureAt: hoursFromNow(0.5), bookingCutoffMinutes: 5, pricePerSeatPaise: 0 });
    const p = await createUser();
    await book(p, ride.id);
    assert.equal((await d.api.post(`/trips/${ride.id}/location`, { lat: 12.99, lng: 77.69 })).status, 409, "no location before the trip starts");
    await d.api.post(`/rides/${ride.id}/start`, { shareLocation: false });
    assert.equal((await d.api.post(`/trips/${ride.id}/location`, { lat: 12.99, lng: 77.69 })).status, 409, "no location without consent");
    await d.api.put(`/trips/${ride.id}/location-sharing`, { enabled: true });
    assert.equal((await d.api.post(`/trips/${ride.id}/location`, { lat: 12.99, lng: 77.69 })).status, 200);
    assert.equal((await d.api.post(`/trips/${ride.id}/location`, { lat: 12.991, lng: 77.69 })).status, 429, "rate limited");
    assert.equal((await p.api.post(`/trips/${ride.id}/location`, { lat: 1, lng: 1 })).status, 403, "passengers cannot post the car's location");

    const share = await p.api.post(`/trips/${ride.id}/share`);
    assert.equal(share.status, 201);
    const view = await anon().get(`/share/${share.body.token}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.location.lat, 12.99);
    assert.equal(view.body.location.stale, false);
    assert.equal(view.body.vehicle.plateNumber.length > 4, true);
    assert.equal(view.body.driverPhone, undefined);

    const outsider = await createUser();
    assert.equal((await outsider.api.get(`/trips/${ride.id}/live`)).status, 404);
    assert.equal((await outsider.api.post(`/trips/${ride.id}/share`)).status, 404);

    await p.api.del(`/trip-shares/${share.body.id}`);
    assert.equal((await anon().get(`/share/${share.body.token}`)).status, 404, "revoked links stop working");
  });
});

describe("support and administration", () => {
  it("restricts support operators to the queue and to assigned case details", async () => {
    const d = await createVerifiedDriver();
    const ride = await publishRide(d);
    const p = await createUser({ name: "Nisha Rao" });
    const b = await book(p, ride.id);
    const t = await p.api.post("/support/tickets", { category: "booking", subject: "Pickup point question", description: "Can the driver pick me up at gate 2?", bookingId: b.body.id });
    assert.equal(t.status, 201);
    const agent = await createUser({ roles: ["support"] });
    const other = await createUser({ roles: ["support"] });
    assert.ok((await agent.api.get("/support/queue?view=unassigned")).body.items.some((i) => i.id === t.body.id));
    assert.equal((await agent.api.get("/admin/metrics")).status, 403, "support is not admin");
    assert.equal((await agent.api.get("/support/queue?view=all")).status, 403);

    const before = await agent.api.get(`/support/tickets/${t.body.id}`);
    assert.equal(before.body.context, null, "no case details until assigned");
    await agent.api.post(`/support/tickets/${t.body.id}/assign`);
    const after = await agent.api.get(`/support/tickets/${t.body.id}`);
    assert.equal(after.body.context.status, "ACCEPTED");
    assert.equal(JSON.stringify(after.body.context).includes(p.phone), false, "no phone numbers in case context");
    assert.equal((await agent.api.get(`/bookings/${b.body.id}`)).status, 200, "assigned agent can open the booking");
    assert.equal((await other.api.get(`/support/tickets/${t.body.id}`)).status, 404, "other agents cannot see an assigned ticket");
    assert.equal((await other.api.get(`/bookings/${b.body.id}`)).status, 404);

    await agent.api.post(`/support/tickets/${t.body.id}/messages`, { body: "Checked with the driver.", internal: true });
    await agent.api.post(`/support/tickets/${t.body.id}/messages`, { body: "Gate 2 works.", internal: false });
    const memberView = await p.api.get(`/support/tickets/${t.body.id}`);
    assert.deepEqual(memberView.body.messages.map((m) => m.body), ["Gate 2 works."], "members never see internal notes");
    assert.equal(memberView.body.status, "waiting_on_user");
    assert.equal((await p.api.post(`/support/tickets/${t.body.id}/messages`, { body: "x", internal: true })).status, 403);
    const esc = await agent.api.post(`/support/tickets/${t.body.id}/escalate`, { reason: "Driver unresponsive", kind: "safety" });
    assert.equal(esc.body.escalated, true);
    assert.equal(esc.body.priority, "urgent");
  });

  it("lets admins suspend with a reason, revokes sessions and audits it", async () => {
    const admin = await createUser({ roles: ["admin"] });
    const u = await createUser();
    assert.equal((await admin.api.patch(`/admin/users/${u.id}/status`, { status: "suspended" })).status, 422, "a reason is required");
    const r = await admin.api.patch(`/admin/users/${u.id}/status`, { status: "suspended", reason: "Repeated no-shows" });
    assert.equal(r.status, 200);
    assert.equal((await u.api.get("/auth/me")).status, 401);
    const log = await admin.api.get(`/admin/audit?entityId=${u.id}`);
    assert.ok(log.body.items.some((i) => i.action === "admin.user.suspend" && i.details.reason === "Repeated no-shows"));
    assert.equal((await admin.api.patch(`/admin/users/${admin.id}/status`, { status: "suspended", reason: "self test" })).status, 403);
    const passenger = await createUser();
    assert.equal((await passenger.api.patch(`/admin/users/${u.id}/status`, { status: "active", reason: "let me in" })).status, 403);
  });

  it("validates configuration edits and applies them", async () => {
    const admin = await createUser({ roles: ["admin"] });
    const bad = await admin.api.put("/admin/config/fees", { platform_fee_percent: 250, platform_fee_min_paise: 0 });
    assert.equal(bad.status, 422);
    const ok = await admin.api.put("/admin/config/fees", { platform_fee_percent: 5, platform_fee_min_paise: 200 });
    assert.equal(ok.status, 200);
    resetSettings();
    const d = await createVerifiedDriver();
    const ride = await publishRide(d, { pricePerSeatPaise: 5000 });
    const p = await createUser();
    const b = await book(p, ride.id);
    assert.equal(b.body.platformFeePaise, 250);
    assert.equal(b.body.totalPaise, 5250);
    await admin.api.put("/admin/config/fees", { platform_fee_percent: 0, platform_fee_min_paise: 0 });
    resetSettings();
  });

  it("serves metrics, health and CSV exports to admins only", async () => {
    const admin = await createUser({ roles: ["admin"] });
    const m = await admin.api.get("/admin/metrics?includeDemo=true");
    assert.equal(m.status, 200);
    assert.ok(m.body.bookingRequests > 0);
    assert.ok("value" in m.body.acceptanceRate);
    const h = await admin.api.get("/admin/health");
    assert.equal(h.body.database.ok, true);
    assert.equal(h.body.providers.payments.live, false);
    const csv = await admin.api.get("/admin/exports/bookings?includeDemo=true");
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.match(csv.body.split("\r\n")[0], /^id,status,seats/);
  });
});
