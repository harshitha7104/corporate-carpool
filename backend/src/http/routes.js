import express from "express";
import { config } from "../config.js";
import { badRequest } from "../lib/errors.js";
import { rateLimit } from "../lib/rateLimit.js";
import { pagination, parse } from "../lib/validate.js";
import { maps } from "../providers/maps/index.js";
import { paymentsProvider } from "../providers/payments.js";
import * as admin from "../services/admin.js";
import * as auth from "../services/auth.js";
import * as bookings from "../services/bookings.js";
import * as chat from "../services/chat.js";
import * as commutes from "../services/commutes.js";
import * as notifications from "../services/notifications.js";
import * as payments from "../services/payments.js";
import * as reviews from "../services/reviews.js";
import * as rides from "../services/rides.js";
import * as safety from "../services/safety.js";
import { SETTING_SCHEMAS, getSettings, updateSetting } from "../services/settings.js";
import * as support from "../services/support.js";
import * as users from "../services/users.js";
import * as vehicles from "../services/vehicles.js";
import * as verification from "../services/verification.js";
import { SESSION_COOKIE, requireAnyPermission, requirePermission, requireUser, sessionCookie } from "./middleware.js";

const page = (req) => parse(pagination, req.query);
const idem = (req) => req.get("idempotency-key");

export const apiRouter = () => {
  const r = express.Router();

  // ---- Public ---------------------------------------------------------------------
  r.get("/meta", async (req, res) => {
    const s = await getSettings();
    res.json({
      environment: config.env,
      serviceArea: s.service_area,
      features: s.features,
      safety: { emergencyNumber: s.safety.emergency_number, emergencyLabel: s.safety.emergency_label },
      pricing: s.pricing,
      cancellation: s.cancellation,
      booking: s.booking,
      matching: s.matching,
      providers: {
        maps: { name: maps.name, live: maps.live },
        payments: { name: paymentsProvider.name, live: paymentsProvider.live },
        otpDevMode: config.otp.provider === "dev",
      },
    });
  });

  r.get("/places", rateLimit({ name: "places", limit: 120, windowMs: 60000 }), async (req, res) => {
    const q = String(req.query.q || "").slice(0, 80);
    res.json({ items: await maps.search(q), provider: maps.name, live: maps.live });
  });

  r.get("/share/:token", rateLimit({ name: "share", limit: 60, windowMs: 60000 }), async (req, res) => {
    res.json(await safety.viewShare(req.params.token));
  });

  r.get("/safety/emergency", async (req, res) => res.json(await safety.emergencyInfo()));

  // ---- Auth -------------------------------------------------------------------------
  r.post("/auth/otp/request", async (req, res) => res.json(await auth.requestOtp(req.body, req.ip)));

  r.post("/auth/otp/verify", async (req, res) => {
    const result = await auth.verifyOtp(req.body, { ip: req.ip, userAgent: req.get("user-agent") });
    res.set("Set-Cookie", sessionCookie(result.token, config.sessionDays * 86400));
    res.json({ isNew: result.isNew });
  });

  r.get("/auth/me", requireUser, async (req, res) => res.json(await users.getMe(req.user)));

  r.post("/auth/logout", requireUser, async (req, res) => {
    await auth.logout(req.user);
    res.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });

  r.post("/auth/logout-all", requireUser, async (req, res) => {
    await auth.logoutEverywhere(req.user.id);
    res.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });

  // Everything below needs a signed-in user.
  r.use(requireUser);

  // ---- Profile ----------------------------------------------------------------------------
  r.get("/users/me", async (req, res) => res.json(await users.getMe(req.user)));
  r.patch("/users/me", async (req, res) => res.json(await users.updateProfile(req.user, req.body)));
  r.put("/users/me/preferences", async (req, res) => res.json(await users.updatePreferences(req.user, req.body)));
  r.post("/users/me/deactivate", async (req, res) => {
    await users.deactivate(req.user);
    res.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });
  r.delete("/users/me", async (req, res) => {
    await users.deleteAccount(req.user);
    res.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });
  r.get("/users/:id/profile", async (req, res) => res.json(await users.publicProfile(req.params.id)));
  r.get("/users/:id/reviews", async (req, res) => res.json(await reviews.reviewsFor(req.params.id, page(req))));

  r.post("/users/me/verification", async (req, res) => res.status(201).json(await verification.submitIdentity(req.user, req.body)));

  r.get("/users/me/places", async (req, res) => res.json({ items: await users.listSaved(req.user) }));
  r.post("/users/me/places", async (req, res) => res.status(201).json(await users.addSaved(req.user, req.body)));
  r.delete("/users/me/places/:id", async (req, res) => {
    await users.removeSaved(req.user, req.params.id);
    res.status(204).end();
  });

  r.get("/users/me/trusted-contacts", async (req, res) => res.json({ items: await users.listContacts(req.user) }));
  r.post("/users/me/trusted-contacts", async (req, res) => res.status(201).json(await users.addContact(req.user, req.body)));
  r.delete("/users/me/trusted-contacts/:id", async (req, res) => {
    await users.removeContact(req.user, req.params.id);
    res.status(204).end();
  });

  r.get("/users/me/blocked", async (req, res) => res.json({ items: await users.listBlocked(req.user) }));
  r.post("/users/:id/block", async (req, res) => {
    await users.block(req.user, req.params.id);
    res.status(204).end();
  });
  r.delete("/users/:id/block", async (req, res) => {
    await users.unblock(req.user, req.params.id);
    res.status(204).end();
  });

  r.get("/users/me/favourites", async (req, res) => res.json({ items: await users.listFavourites(req.user) }));
  r.post("/users/:id/favourite", async (req, res) => {
    await users.addFavourite(req.user, req.params.id);
    res.status(204).end();
  });
  r.delete("/users/:id/favourite", async (req, res) => {
    await users.removeFavourite(req.user, req.params.id);
    res.status(204).end();
  });

  // ---- Files ------------------------------------------------------------------------------
  r.post("/files", express.raw({ type: ["image/jpeg", "image/png", "application/pdf", "application/octet-stream"], limit: "5mb" }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw badRequest("Send the file as the request body with its Content-Type.");
    const declared = req.get("content-type") === "application/octet-stream" ? null : req.get("content-type");
    res.status(201).json(await verification.uploadFile(req.user, String(req.query.purpose || ""), declared, req.body));
  });
  r.get("/files/:id/link", async (req, res) => res.json(await verification.fileLink(req.user, req.params.id)));
  r.get("/files/:id", async (req, res) => {
    const { file, data } = await verification.readFile(req.user, req.params.id, req.query.exp, req.query.sig);
    res.set("Content-Type", file.mime_type);
    res.set("Content-Disposition", "inline");
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.send(data);
  });

  // ---- Vehicles ---------------------------------------------------------------------------
  r.get("/vehicles", async (req, res) => res.json({ items: await vehicles.listVehicles(req.user) }));
  r.post("/vehicles", async (req, res) => res.status(201).json(await vehicles.addVehicle(req.user, req.body)));
  r.patch("/vehicles/:id", async (req, res) => res.json(await vehicles.updateVehicle(req.user, req.params.id, req.body)));
  r.delete("/vehicles/:id", async (req, res) => {
    await vehicles.removeVehicle(req.user, req.params.id);
    res.status(204).end();
  });
  r.post("/vehicles/:id/verification", async (req, res) => res.status(201).json(await verification.submitVehicleVerification(req.user, req.params.id, req.body)));

  // ---- Rides --------------------------------------------------------------------------------
  r.get("/rides/search", rateLimit({ name: "search", limit: 60, windowMs: 60000, key: (req) => req.user.id }), async (req, res) => res.json(await rides.searchRides(req.user, req.query)));
  r.post("/rides/preview", async (req, res) => res.json(await rides.previewRide(req.user, req.body)));
  r.get("/rides/mine", async (req, res) => res.json({ items: await rides.listDriverRides(req.user, req.query) }));
  r.post("/rides", async (req, res) => res.status(201).json(await rides.createRide(req.user, req.body)));
  r.get("/rides/:id", async (req, res) => res.json(await rides.getRide(req.user, req.params.id)));
  r.patch("/rides/:id", async (req, res) => res.json(await rides.updateRide(req.user, req.params.id, req.body)));
  r.delete("/rides/:id", async (req, res) => {
    await rides.deleteDraft(req.user, req.params.id);
    res.status(204).end();
  });
  r.post("/rides/:id/publish", async (req, res) => res.json(await rides.publishRide(req.user, req.params.id)));
  r.post("/rides/:id/cancel", async (req, res) => res.json(await bookings.cancelRide(req.user, req.params.id, req.body)));
  r.post("/rides/:id/start", async (req, res) => res.json(await bookings.startRide(req.user, req.params.id, req.body)));
  r.post("/rides/:id/complete", async (req, res) => res.json(await bookings.completeRide(req.user, req.params.id)));
  r.get("/rides/:id/bookings", async (req, res) => res.json({ items: await bookings.listRideBookings(req.user, req.params.id) }));

  // ---- Bookings ----------------------------------------------------------------------------
  r.post("/rides/:id/bookings", rateLimit({ name: "book", limit: 20, windowMs: 60000, key: (req) => req.user.id }), async (req, res) => {
    const { booking, replayed } = await bookings.createBooking(req.user, req.params.id, req.body, idem(req));
    res.status(replayed ? 200 : 201).json(booking);
  });
  r.get("/bookings/me", async (req, res) => res.json({ items: await bookings.listMyBookings(req.user, req.query) }));
  r.get("/bookings/:id", async (req, res) => res.json(await bookings.getBooking(req.user, req.params.id)));
  r.post("/bookings/:id/accept", async (req, res) => res.json(await bookings.acceptBooking(req.user, req.params.id)));
  r.post("/bookings/:id/reject", async (req, res) => res.json(await bookings.rejectBooking(req.user, req.params.id, req.body)));
  r.post("/bookings/:id/cancel", async (req, res) => res.json(await bookings.cancelByPassenger(req.user, req.params.id, req.body)));
  r.post("/bookings/:id/driver-cancel", async (req, res) => res.json(await bookings.cancelByDriver(req.user, req.params.id, req.body)));
  r.post("/bookings/:id/pickup", async (req, res) => res.json(await bookings.markPickedUp(req.user, req.params.id)));
  r.post("/bookings/:id/no-show", async (req, res) => res.json(await bookings.markNoShow(req.user, req.params.id)));
  r.post("/bookings/:id/complete", async (req, res) => res.json(await bookings.completeBooking(req.user, req.params.id)));
  r.post("/bookings/:id/dispute", async (req, res) => res.status(201).json(await bookings.openDispute(req.user, req.params.id, req.body)));
  r.post("/bookings/:id/review", async (req, res) => res.status(201).json(await reviews.submitReview(req.user, req.params.id, req.body)));

  r.get("/reviews/pending", async (req, res) => res.json({ items: await reviews.pendingReviews(req.user) }));
  r.get("/reviews/written", async (req, res) => res.json({ items: await reviews.reviewsWritten(req.user, page(req)) }));

  // ---- Commutes ---------------------------------------------------------------------------
  r.post("/commutes", async (req, res) => res.status(201).json(await commutes.createRule(req.user, req.body)));
  r.get("/commutes/me", async (req, res) => res.json({ items: await commutes.listRules(req.user) }));
  r.patch("/commutes/:id", async (req, res) => res.json(await commutes.updateRule(req.user, req.params.id, req.body)));
  r.get("/passenger-commutes", async (req, res) => res.json({ items: await commutes.listPassengerCommutes(req.user) }));
  r.post("/passenger-commutes", async (req, res) => res.status(201).json(await commutes.addPassengerCommute(req.user, req.body)));
  r.delete("/passenger-commutes/:id", async (req, res) => {
    await commutes.removePassengerCommute(req.user, req.params.id);
    res.status(204).end();
  });
  r.get("/passenger-commutes/:id/matches", async (req, res) => res.json(await commutes.matchesForPassengerCommute(req.user, req.params.id)));

  // ---- Payments ------------------------------------------------------------------------------
  r.post("/payments/checkout", async (req, res) => res.status(201).json(await payments.checkout(req.user, String(req.body?.bookingId || ""), idem(req))));
  r.get("/payments/me", async (req, res) => res.json({ items: await payments.listMyPayments(req.user, page(req)) }));
  r.get("/payments/driver-summary", async (req, res) => res.json(await payments.driverContributions(req.user, page(req))));
  r.get("/payments/:id", async (req, res) => res.json(await payments.getPayment(req.user, req.params.id)));
  r.get("/payments/:id/receipt", async (req, res) => res.json(await payments.receipt(req.user, req.params.id)));
  r.post("/payments/:id/simulate", async (req, res) => res.json(await payments.simulateOutcome(req.user, req.params.id, req.body)));
  r.post("/payments/:id/verify", async (req, res) => res.json(await payments.verifyRazorpay(req.user, req.params.id, req.body)));

  // ---- Notifications and chat ------------------------------------------------------------
  r.get("/notifications", async (req, res) => res.json(await notifications.listNotifications(req.user.id, { ...page(req), unreadOnly: req.query.unread === "true" })));
  r.get("/notifications/:id/deliveries", async (req, res) => res.json({ items: await notifications.deliveriesFor(req.user.id, req.params.id) }));
  r.post("/notifications/read", async (req, res) => {
    const ids = req.body?.ids === "all" ? "all" : Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === "string").slice(0, 200) : [];
    await notifications.markRead(req.user.id, ids);
    res.status(204).end();
  });
  r.get("/conversations", async (req, res) => res.json({ items: await chat.listConversations(req.user) }));
  r.get("/conversations/:id/messages", async (req, res) => res.json(await chat.getMessages(req.user, req.params.id)));
  r.post("/conversations/:id/messages", async (req, res) => res.status(201).json(await chat.sendMessage(req.user, req.params.id, req.body)));

  // ---- Safety ------------------------------------------------------------------------------
  r.post("/safety/reports", async (req, res) => res.status(201).json(await safety.createReport(req.user, req.body)));
  r.get("/safety/reports/me", async (req, res) => res.json({ items: await safety.myReports(req.user) }));
  r.post("/safety/sos", async (req, res) => res.status(201).json(await safety.triggerSos(req.user, req.body)));
  r.post("/trips/:id/share", async (req, res) => res.status(201).json(await safety.createShare(req.user, req.params.id)));
  r.get("/trips/:id/shares", async (req, res) => res.json({ items: await safety.listShares(req.user, req.params.id) }));
  r.delete("/trip-shares/:id", async (req, res) => {
    await safety.revokeShare(req.user, req.params.id);
    res.status(204).end();
  });
  r.get("/trips/:id/live", async (req, res) => res.json(await safety.getLiveState(req.user, req.params.id)));
  r.post("/trips/:id/location", async (req, res) => res.json(await safety.postLocation(req.user, req.params.id, req.body)));
  r.put("/trips/:id/location-sharing", async (req, res) => res.json(await safety.setLocationSharing(req.user, req.params.id, req.body)));

  // ---- Support -------------------------------------------------------------------------------
  r.post("/support/tickets", async (req, res) => res.status(201).json(await support.createTicket(req.user, req.body)));
  r.get("/support/tickets/me", async (req, res) => res.json({ items: await support.myTickets(req.user) }));
  r.get("/support/queue", requirePermission("support.tickets.read_queue"), async (req, res) => res.json({ items: await support.queue(req.user, req.query) }));
  r.get("/support/tickets/:id", async (req, res) => res.json(await support.getTicket(req.user, req.params.id)));
  r.post("/support/tickets/:id/messages", async (req, res) => res.status(201).json(await support.reply(req.user, req.params.id, req.body)));
  r.post("/support/tickets/:id/status", async (req, res) => res.json(await support.setStatus(req.user, req.params.id, req.body)));
  r.post("/support/tickets/:id/assign", requirePermission("support.tickets.work"), async (req, res) => res.json(await support.assign(req.user, req.params.id, req.body)));
  r.post("/support/tickets/:id/escalate", requirePermission("support.tickets.escalate"), async (req, res) => res.json(await support.escalate(req.user, req.params.id, req.body)));

  // ---- Admin ---------------------------------------------------------------------------------
  const a = express.Router();
  a.get("/metrics", requirePermission("admin.metrics.read"), async (req, res) => res.json(await admin.metrics(req.query)));
  a.get("/users", requirePermission("admin.users.read"), async (req, res) => res.json({ items: await admin.listUsers(req.query) }));
  a.get("/users/:id", requirePermission("admin.users.read"), async (req, res) => res.json(await admin.userDetail(req.user, req.params.id)));
  a.patch("/users/:id/status", requirePermission("admin.users.manage"), async (req, res) => res.json(await admin.setUserStatus(req.user, req.params.id, req.body)));
  a.post("/users/:id/roles", requirePermission("admin.roles.manage"), async (req, res) => res.json(await admin.setRole(req.user, req.params.id, req.body)));
  a.get("/verifications", requirePermission("admin.verifications.review"), async (req, res) =>
    res.json({ items: await verification.listQueue({ type: req.query.type === "vehicle" ? "vehicle" : "identity", status: ["pending_review", "verified", "rejected", "needs_info"].includes(req.query.status) ? req.query.status : "pending_review", ...page(req) }) })
  );
  a.post("/verifications/:type/:id/decision", requirePermission("admin.verifications.review"), async (req, res) =>
    res.json(await verification.decide(req.user, req.params.type === "vehicle" ? "vehicle" : "identity", req.params.id, req.body))
  );
  a.get("/rides", requirePermission("admin.rides.read"), async (req, res) => res.json({ items: await admin.listRides(req.query) }));
  a.post("/rides/:id/cancel", requirePermission("admin.rides.read", "admin.safety.manage"), async (req, res) => res.json(await bookings.cancelRide(req.user, req.params.id, req.body, { asAdmin: true })));
  a.get("/bookings", requirePermission("admin.bookings.read"), async (req, res) => res.json({ items: await admin.listBookings(req.query) }));
  a.get("/disputes", requirePermission("admin.bookings.read"), async (req, res) => res.json({ items: await admin.listDisputes() }));
  a.post("/disputes/:id/resolve", requirePermission("admin.bookings.read", "admin.refunds.issue"), async (req, res) => res.json(await bookings.resolveDispute(req.user, req.params.id, req.body)));
  a.get("/reports", requirePermission("admin.safety.manage"), async (req, res) => res.json({ items: await admin.listReports(req.query) }));
  a.patch("/reports/:id", requirePermission("admin.safety.manage"), async (req, res) => res.json(await admin.updateReport(req.user, req.params.id, req.body)));
  a.get("/payments", requirePermission("admin.payments.read"), async (req, res) => res.json({ items: await admin.listPayments(req.query) }));
  a.get("/refunds", requirePermission("admin.payments.read"), async (req, res) => res.json({ items: await admin.listRefunds(req.query) }));
  a.get("/reconciliation", requirePermission("admin.payments.read"), async (req, res) => res.json(await admin.reconciliation()));
  a.post("/payments/:id/refund", requirePermission("admin.refunds.issue"), async (req, res) => res.status(201).json(await payments.adminRefund(req.user, req.params.id, req.body)));
  a.get("/config", requirePermission("admin.config.manage"), async (req, res) => res.json({ settings: await getSettings(), editable: Object.keys(SETTING_SCHEMAS) }));
  a.put("/config/:key", requirePermission("admin.config.manage"), async (req, res) => res.json(await updateSetting(req.user, req.params.key, req.body)));
  a.get("/audit", requirePermission("admin.audit.read"), async (req, res) => res.json({ items: await admin.listAudit(req.query) }));
  a.get("/exports/:kind", requirePermission("admin.exports.run"), async (req, res) => {
    const out = await admin.exportCsv(req.user, req.params.kind, req.query);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.send(out.body);
  });
  a.get("/health", requirePermission("admin.health.read"), async (req, res) => res.json(await admin.health()));
  r.use("/admin", requireAnyPermission("admin.metrics.read", "admin.users.read"), a);

  return r;
};

// Signed provider webhooks need the raw body for signature checks.
export const webhookRouter = () => {
  const r = express.Router();
  r.post("/:provider", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    res.json(await payments.handleWebhook(req.params.provider, raw, req.headers));
  });
  return r;
};
