import fs from "node:fs";
import path from "node:path";
import compression from "compression";
import express from "express";
import { BACKEND_ROOT, config } from "./config.js";
import { db } from "./db/index.js";
import { apiRouter, webhookRouter } from "./http/routes.js";
import { authenticate, csrf, errorHandler, notFoundHandler, requestId, securityHeaders } from "./http/middleware.js";

export const createApp = () => {
  const app = express();
  if (config.isProduction) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(securityHeaders);
  // gzip JSON and static files; WebSocket upgrades are unaffected.
  app.use(compression());

  // Liveness: the process is up. Readiness: it can reach the database.
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "database unavailable" });
    }
  });

  app.use("/api/v1/payments/webhooks", webhookRouter());
  app.use(express.json({ limit: "200kb" }));
  app.use(csrf);
  app.use(authenticate);
  app.use("/api/v1", apiRouter());
  app.use("/api", notFoundHandler);

  // Serve the built frontend when present (single-service deployment).
  const dist = path.resolve(BACKEND_ROOT, "../front-end/carpool/dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    // Hashed build files never change, so browsers may keep them for a year.
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "365d", index: false }));
    app.use(express.static(dist, { index: false, maxAge: config.isProduction ? "1h" : 0 }));
    // The page itself is always revalidated so a new release shows immediately.
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
};
