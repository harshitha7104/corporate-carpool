import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { BACKEND_ROOT } from "../config.js";
import { logger } from "../lib/logger.js";

// Development and tests only: run a real PostgreSQL server from the
// embedded-postgres package so nothing needs to be installed.
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export const startDevDatabase = async ({ name = "dev", persistent = true } = {}) => {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dataDir = path.join(BACKEND_ROOT, ".data", `pg-${name}`);
  const port = await freePort();
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!persistent && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "greenway",
    password: "greenway",
    port,
    persistent,
    onLog: () => {},
    onError: (msg) => logger.debug("embedded postgres", { msg: String(msg) }),
  });
  if (fresh || !persistent) await server.initialise();
  try {
    await server.start();
  } catch (err) {
    // A previous run killed without a clean shutdown leaves postmaster.pid
    // behind. If no server holds it, remove it and try once more.
    const pidFile = path.join(dataDir, "postmaster.pid");
    const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8").split("\n")[0]) : 0;
    let alive = false;
    try {
      if (pid) process.kill(pid, 0);
      alive = Boolean(pid);
    } catch {
      alive = false;
    }
    if (!pid || alive) throw err instanceof Error ? err : new Error(`Embedded PostgreSQL failed to start: ${String(err)}`);
    logger.warn("Removing a stale PostgreSQL lock file from an unclean shutdown", { pid });
    fs.rmSync(pidFile, { force: true });
    await server.start();
  }
  if (fresh || !persistent) {
    try {
      await server.createDatabase("greenway");
    } catch (err) {
      if (!/already exists/.test(err.message)) throw err;
    }
  }
  return {
    url: `postgres://greenway:greenway@127.0.0.1:${port}/greenway`,
    stop: () => server.stop(),
  };
};
