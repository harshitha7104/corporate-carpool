import pg from "pg";
import { logger } from "../lib/logger.js";

// Return int8 (bigint / count) as JS numbers; our counts stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// Keep DATE columns as 'YYYY-MM-DD' strings so no timezone shifting happens.
pg.types.setTypeParser(1082, (v) => v);
// ...and DATE[] the same way, as an array of strings.
pg.types.setTypeParser(1182, pg.types.getTypeParser(1009));

let pool;

export const initPool = (connectionString) => {
  pool = new pg.Pool({
    connectionString,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  pool.on("error", (err) => logger.error("Idle database client error", { error: err.message }));
  return pool;
};

export const getPool = () => {
  if (!pool) throw new Error("Database pool not initialised");
  return pool;
};

export const closePool = async () => {
  if (pool) await pool.end();
  pool = undefined;
};

export const query = (text, params) => getPool().query(text, params);

export const one = async (text, params) => (await query(text, params)).rows[0];
export const many = async (text, params) => (await query(text, params)).rows;

// Run fn(client) inside a transaction. The client exposes the same query helpers.
export const tx = async (fn) => {
  const client = await getPool().connect();
  const scoped = {
    query: (t, p) => client.query(t, p),
    one: async (t, p) => (await client.query(t, p)).rows[0],
    many: async (t, p) => (await client.query(t, p)).rows,
  };
  try {
    await client.query("BEGIN");
    const result = await fn(scoped);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// Helpers that accept either a transaction client or fall back to the pool.
export const db = { query, one, many, tx };
export const using = (client) => client || db;
