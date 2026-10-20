import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel];

// Carries the request id (correlation id) into every log line of a request.
export const requestContext = new AsyncLocalStorage();

const write = (level, message, fields = {}) => {
  if (LEVELS[level] < threshold || config.isTest) return;
  const ctx = requestContext.getStore();
  const line = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...fields,
  };
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
};

export const logger = {
  debug: (msg, fields) => write("debug", msg, fields),
  info: (msg, fields) => write("info", msg, fields),
  warn: (msg, fields) => write("warn", msg, fields),
  error: (msg, fields) => write("error", msg, fields),
};
