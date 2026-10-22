import { getPool } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { expireBookings, sendReminders } from "../services/bookings.js";
import { generateAll } from "../services/commutes.js";
import { processDeliveries } from "../services/notifications.js";
import { retryPendingRefunds } from "../services/payments.js";
import { purgeLocations } from "../services/safety.js";
import { purgeExpiredFiles } from "../services/retention.js";
import { recordRun } from "./status.js";

// Periodic tasks. Each run takes a Postgres advisory lock, so with several
// server instances only one runs a given task at a time.
export const TASKS = [
  { name: "expire-bookings", everyMs: 30_000, lockId: 72101, run: expireBookings },
  { name: "deliver-notifications", everyMs: 10_000, lockId: 72102, run: processDeliveries },
  { name: "ride-reminders", everyMs: 60_000, lockId: 72103, run: sendReminders },
  { name: "generate-commutes", everyMs: 15 * 60_000, lockId: 72104, run: generateAll, runAtStart: true },
  { name: "retry-refunds", everyMs: 60_000, lockId: 72105, run: retryPendingRefunds },
  { name: "purge-locations", everyMs: 60 * 60_000, lockId: 72106, run: purgeLocations },
  { name: "purge-files", everyMs: 60 * 60_000, lockId: 72107, run: purgeExpiredFiles },
];

export const runTask = async (task) => {
  let client;
  try {
    client = await getPool().connect();
  } catch (err) {
    // Database unreachable (e.g. the machine slept): skip this run, retry next tick.
    logger.warn("Worker task skipped: database unavailable", { task: task.name, error: err.message });
    recordRun(task.name, { ok: false, error: `database unavailable: ${err.message}` });
    return { ok: false, error: err.message };
  }
  let locked = false;
  let broken = null;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock($1) AS ok", [task.lockId])).rows[0].ok;
    if (!locked) return { skipped: true };
    const started = Date.now();
    const result = await task.run();
    const outcome = { ok: true, result, ms: Date.now() - started };
    recordRun(task.name, outcome);
    return outcome;
  } catch (err) {
    logger.error("Worker task failed", { task: task.name, error: err.message });
    recordRun(task.name, { ok: false, error: err.message });
    if (/terminat|ECONNRESET|ECONNREFUSED|timeout/i.test(err.message)) broken = err;
    await client.query(
      `INSERT INTO jobs (type, status, attempts, last_error, payload) VALUES ($1, 'failed', 1, $2, '{}')`,
      [task.name, err.message.slice(0, 500)]
    ).catch(() => {});
    return { ok: false, error: err.message };
  } finally {
    if (locked && !broken) await client.query("SELECT pg_advisory_unlock($1)", [task.lockId]).catch(() => {});
    // Passing the error makes the pool discard a dead connection instead of reusing it.
    client.release(broken || undefined);
  }
};

export const startWorker = () => {
  const timers = [];
  for (const task of TASKS) {
    const tick = () => runTask(task);
    if (task.runAtStart) setTimeout(tick, 2000).unref();
    const t = setInterval(tick, task.everyMs);
    t.unref();
    timers.push(t);
  }
  logger.info("Background worker started", { tasks: TASKS.map((t) => t.name) });
  return () => timers.forEach(clearInterval);
};
