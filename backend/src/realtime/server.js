import { WebSocketServer } from "ws";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { SESSION_COOKIE, parseCookies } from "../http/middleware.js";
import { sessionUser } from "../services/auth.js";
import { rideAccess } from "../services/safety.js";
import { hub } from "./hub.js";

const originOk = (origin, host) => {
  if (!origin) return !config.isProduction;
  if (origin === `http://${host}` || origin === `https://${host}`) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    if (origin === new URL(config.publicAppUrl).origin) return true;
  } catch {
    // ignore
  }
  return !config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

// WebSocket endpoint at /ws. The session cookie authenticates the socket; a
// client joins "ride:<id>" channels only after the same access check the REST
// API uses. Messages from clients are limited to subscribe/unsubscribe.
export const attachRealtime = (httpServer) => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  httpServer.on("upgrade", async (req, socket, head) => {
    if (new URL(req.url, "http://x").pathname !== "/ws") return socket.destroy();
    if (!originOk(req.headers.origin, req.headers.host)) return socket.destroy();
    const user = await sessionUser(parseCookies(req.headers.cookie)[SESSION_COOKIE]).catch(() => null);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, user));
  });

  wss.on("connection", (ws, user) => {
    ws.isAlive = true;
    hub.subscribe(`user:${user.id}`, ws);
    ws.send(JSON.stringify({ event: "ready", data: { userId: user.id } }));
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const match = /^ride:([0-9a-f-]{36})$/.exec(msg?.channel || "");
      if (!match) return;
      if (msg.type === "subscribe") {
        try {
          await rideAccess(user, match[1]);
          hub.subscribe(msg.channel, ws);
          ws.send(JSON.stringify({ event: "subscribed", channel: msg.channel }));
        } catch {
          ws.send(JSON.stringify({ event: "error", channel: msg.channel, data: { message: "You cannot follow this ride." } }));
        }
      } else if (msg.type === "unsubscribe") {
        hub.unsubscribe(msg.channel, ws);
      }
    });
    ws.on("close", () => hub.unsubscribeAll(ws));
  });

  // Drop dead connections so the hub does not leak sockets.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));
  logger.info("Realtime channel ready at /ws");
  return wss;
};
