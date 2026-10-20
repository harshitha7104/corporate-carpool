// In-process pub/sub between services and connected WebSocket clients.
// Channels: "user:<id>" (personal events) and "ride:<id>" (trip events, only
// joined after an access check). A multi-instance deployment would bridge
// this through Redis pub/sub or Postgres LISTEN/NOTIFY.
const channels = new Map();

export const hub = {
  subscribe(channel, socket) {
    if (!channels.has(channel)) channels.set(channel, new Set());
    channels.get(channel).add(socket);
  },
  unsubscribe(channel, socket) {
    const set = channels.get(channel);
    if (!set) return;
    set.delete(socket);
    if (!set.size) channels.delete(channel);
  },
  unsubscribeAll(socket) {
    for (const [name, set] of channels) {
      set.delete(socket);
      if (!set.size) channels.delete(name);
    }
  },
  publish(channel, event, data) {
    const set = channels.get(channel);
    if (!set) return 0;
    const message = JSON.stringify({ channel, event, data, at: new Date().toISOString() });
    for (const socket of set) {
      if (socket.readyState === 1) socket.send(message);
    }
    return set.size;
  },
  listeners(channel) {
    return channels.get(channel)?.size || 0;
  },
  toUser(userId, event, data) {
    return this.publish(`user:${userId}`, event, data);
  },
  toRide(rideId, event, data) {
    return this.publish(`ride:${rideId}`, event, data);
  },
};
