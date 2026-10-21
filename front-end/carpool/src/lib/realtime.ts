import { useEffect, useRef, useState } from "react";

// One shared WebSocket per tab. Reconnects with backoff; ride channels are
// re-subscribed after each reconnect.
type Handler = (event: string, data: unknown, channel?: string) => void;

let socket: WebSocket | null = null;
let attempts = 0;
let connected = false;
const handlers = new Set<Handler>();
const rideChannels = new Map<string, number>();
const statusListeners = new Set<(c: boolean) => void>();

const setConnected = (c: boolean) => {
  connected = c;
  statusListeners.forEach((l) => l(c));
};

const connect = () => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    attempts = 0;
    setConnected(true);
    for (const channel of rideChannels.keys()) socket?.send(JSON.stringify({ type: "subscribe", channel }));
  };
  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handlers.forEach((h) => h(msg.event, msg.data, msg.channel));
    } catch {
      // ignore malformed frames
    }
  };
  socket.onclose = () => {
    setConnected(false);
    socket = null;
    if (!handlers.size) return;
    attempts += 1;
    setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)));
  };
};

export const useRealtime = (handler: Handler, enabled = true) => {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const h: Handler = (e, d, c) => ref.current(e, d, c);
    handlers.add(h);
    connect();
    return () => {
      handlers.delete(h);
    };
  }, [enabled]);
};

export const useRideChannel = (rideId: string | undefined, enabled = true) => {
  useEffect(() => {
    if (!rideId || !enabled) return;
    const channel = `ride:${rideId}`;
    rideChannels.set(channel, (rideChannels.get(channel) || 0) + 1);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "subscribe", channel }));
    return () => {
      const n = (rideChannels.get(channel) || 1) - 1;
      if (n <= 0) {
        rideChannels.delete(channel);
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "unsubscribe", channel }));
      } else rideChannels.set(channel, n);
    };
  }, [rideId, enabled]);
};

export const useRealtimeStatus = () => {
  const [c, setC] = useState(connected);
  useEffect(() => {
    statusListeners.add(setC);
    return () => {
      statusListeners.delete(setC);
    };
  }, []);
  return c;
};
