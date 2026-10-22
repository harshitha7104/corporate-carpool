import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { closePool, initPool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { logger } from "./lib/logger.js";
import { attachRealtime } from "./realtime/server.js";
import { startWorker } from "./workers/index.js";

const main = async () => {
  let devDb;
  let url = config.databaseUrl;
  if (!url) {
    if (config.isProduction) throw new Error("DATABASE_URL is required in production.");
    logger.info("No DATABASE_URL set; starting the embedded development PostgreSQL (first run downloads it).");
    const { startDevDatabase } = await import("./db/devServer.js");
    // DEV_DB_NAME / DEV_DB_FRESH let browser tests use their own throwaway database.
    devDb = await startDevDatabase({ name: process.env.DEV_DB_NAME || "dev", persistent: process.env.DEV_DB_FRESH !== "true" });
    url = devDb.url;
  }
  initPool(url);
  await migrate();

  if (config.seedDemo || (!config.isProduction && !config.databaseUrl)) {
    const { seedIfEmpty } = await import("./db/seed.js");
    await seedIfEmpty();
  }

  const app = createApp();
  const server = http.createServer(app);
  attachRealtime(server);
  const stopWorker = config.workerEnabled ? startWorker() : () => {};
  server.listen(config.port, () => logger.info(`Green Way API listening on http://localhost:${config.port}`, { env: config.env }));

  const shutdown = async (signal) => {
    logger.info("Shutting down", { signal });
    stopWorker();
    server.close();
    await closePool().catch(() => {});
    if (devDb) await devDb.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

// A stray rejection (for example a dropped database connection) is logged
// rather than taking the whole server down; /ready reports the database state.
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled rejection", { error: err instanceof Error ? err.message : String(err) });
});

main().catch((err) => {
  logger.error("Failed to start", { error: err instanceof Error ? err.message : String(err), stack: err?.stack });
  process.exit(1);
});
