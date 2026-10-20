import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./index.js";
import { logger } from "../lib/logger.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

// Applies every migrations/NNN_name.sql not yet recorded, each in its own
// transaction, under an advisory lock so two instances cannot race.
export const migrate = async () => {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        logger.info("Applied migration", { version });
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${version} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
};
