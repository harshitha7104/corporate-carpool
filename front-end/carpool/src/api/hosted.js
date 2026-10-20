// Backend for the claude.ai-hosted build. It answers the same requests as the
// Express API in backend/app.js, but stores data in the page's shared `db`
// capability instead of MongoDB. Each viewer's credentials live in their own
// private `data/users/<id>/` subtree; rides are shared documents.
import { clearSession, getToken } from "./auth";

const USER_REGEX = /^[a-zA-Z][a-zA-Z0-9-_]{3,23}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const fail = (status, message) => {
  const error = new Error(message);
  error.response = { status, data: { message } };
  return error;
};

const ok = (data, status = 200) => ({ status, data });

let contextPromise;
const context = () => {
  contextPromise ||= (async () => {
    if (!window.claude?.use) return null;
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return null;
    const uid = await user.id();
    return uid ? { db, uid } : null;
  })();
  return contextPromise;
};

const requireContext = async () => {
  const ctx = await context();
  if (!ctx) {
    throw fail(503, "Sign in to claude.ai and open this page there to save accounts and rides.");
  }
  return ctx;
};

// Store writes reject `invalid_argument` when this viewer may only view the page.
const write = async (promise) => {
  try {
    return await promise;
  } catch (err) {
    if (err?.code === "invalid_argument") {
      throw fail(403, "You have view-only access to this page. Ask the owner for Contributor access to make changes.");
    }
    if (err?.code === "quota_exceeded") {
      throw fail(507, "The ride board is full. Remove old rides and try again.");
    }
    throw fail(503, "Saving failed. Please try again in a moment.");
  }
};

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256 = async (text) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

const hashPassword = async (password, salt) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return toHex(bits);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hold a short lease on a document while reading and rewriting it, so two
// people booking the last seat cannot both succeed.
const withLease = async (ref, uid, work) => {
  const holder = `${uid}:${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const lease = await write(ref.acquire({ holder, ttlMs: 5000 }));
    if (lease.acquired) return work();
    await sleep(300 + Math.random() * 300);
  }
  throw fail(409, "Someone else is updating this right now. Please try again.");
};

const claim = async (db, uid, path, takenMessage) => {
  const ref = db.doc(path);
  return withLease(ref, uid, async () => {
    const snap = await ref.get();
    const owner = snap.exists ? snap.data().owner : null;
    if (owner && owner !== uid) throw fail(409, takenMessage);
    if (!owner) await write(ref.set({ owner: uid }));
  });
};

const accountRef = (db, uid) => db.doc(`data/users/${uid}/account`);

const currentAccount = async () => {
  const ctx = await requireContext();
  if (getToken() !== `hosted.${ctx.uid}`) {
    if (getToken()) clearSession();
    throw fail(401, "Please sign in to continue");
  }
  const snap = await accountRef(ctx.db, ctx.uid).get();
  if (!snap.exists) {
    clearSession();
    throw fail(401, "Account not found. Please sign in again.");
  }
  return { ...ctx, account: snap.data() };
};

const toRide = (snap, uid) => {
  const ride = snap.data();
  return {
    id: snap.id,
    driverName: ride.driverName,
    location: ride.location,
    destination: ride.destination,
    departureTime: ride.departureTime || null,
    carNumber: ride.carNumber,
    carType: ride.carType,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    conditions: ride.conditions,
    isDriver: ride.driverUid === uid,
    isBooked: (ride.passengers || []).some((p) => p.uid === uid),
  };
};

const allRides = async (db) => (await db.collection("rides").limit(1000).get()).docs;

const byDepartureThenNewest = (a, b) => {
  const da = a.data().departureTime || "9999";
  const db = b.data().departureTime || "9999";
  if (da !== db) return da < db ? -1 : 1;
  return (b.data().createdAt || "").localeCompare(a.data().createdAt || "");
};

const routes = {
  "POST /Signup": async (body) => {
    const { db, uid } = await requireContext();
    const username = String(body.user || "").trim();
    const password = String(body.pwd || "");
    const email = String(body.email || "").trim().toLowerCase();
    if (!USER_REGEX.test(username) || password.length < 6 || password.length > 64 || !EMAIL_REGEX.test(email)) {
      throw fail(400, "Please provide valid signup details");
    }
    const existing = await accountRef(db, uid).get();
    if (existing.exists) {
      throw fail(409, `Your claude.ai login already has an account here (${existing.data().username}). Sign in instead.`);
    }
    await claim(db, uid, `usernames/${username.toLowerCase()}`, "That username is already taken");
    await claim(db, uid, `emails/${await sha256(email)}`, "That email is already registered");
    const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
    await write(accountRef(db, uid).set({
      username,
      email,
      salt,
      passwordHash: await hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    }));
    return ok({ message: "User created" }, 201);
  },

  "POST /Login": async (body) => {
    const { db, uid } = await requireContext();
    const email = String(body.email || "").trim().toLowerCase();
    const snap = await accountRef(db, uid).get();
    const account = snap.exists ? snap.data() : null;
    if (!account || account.email !== email ||
        account.passwordHash !== await hashPassword(String(body.pwd || ""), account.salt)) {
      throw fail(401, "Email or password is incorrect");
    }
    return ok({ token: `hosted.${uid}`, user: { username: account.username, email: account.email } });
  },

  "GET /Rides": async (body, params) => {
    const { db, uid } = await requireContext();
    const from = String(params.from || "").trim().toLowerCase();
    const to = String(params.to || "").trim().toLowerCase();
    const rides = (await allRides(db))
      .filter((snap) => {
        const ride = snap.data();
        return ride.availableSeats > 0 &&
          (!from || ride.location.toLowerCase().includes(from)) &&
          (!to || ride.destination.toLowerCase().includes(to));
      })
      .sort(byDepartureThenNewest)
      .slice(0, 50)
      .map((snap) => toRide(snap, getToken() === `hosted.${uid}` ? uid : null));
    return ok({ rides });
  },

  "POST /Rides": async (body) => {
    const { db, uid, account } = await currentAccount();
    const text = (value, max) => String(value || "").trim().slice(0, max);
    const total = Number(body.totalSeats);
    const available = Number(body.availableSeats);
    const departure = body.departureTime ? new Date(body.departureTime) : null;
    if (!text(body.location, 120) || !text(body.destination, 120) || !text(body.carNumber, 20) || !text(body.carType, 60) ||
        !Number.isInteger(total) || !Number.isInteger(available) ||
        total < 1 || total > 10 || available < 1 || available > total ||
        (departure && Number.isNaN(departure.getTime()))) {
      throw fail(400, "Please provide valid ride details");
    }
    const ref = db.collection("rides").doc();
    await write(ref.set({
      driverUid: uid,
      driverName: account.username,
      location: text(body.location, 120),
      destination: text(body.destination, 120),
      departureTime: departure ? departure.toISOString() : null,
      carNumber: text(body.carNumber, 20),
      carType: text(body.carType, 60),
      totalSeats: total,
      availableSeats: available,
      conditions: text(body.conditions, 500),
      passengers: [],
      createdAt: new Date().toISOString(),
    }));
    return ok({ message: "Ride offered", ride: toRide(await ref.get(), uid) }, 201);
  },

  "GET /MyRides": async () => {
    const { db, uid } = await currentAccount();
    const rides = (await allRides(db)).sort((a, b) => (b.data().createdAt || "").localeCompare(a.data().createdAt || ""));
    return ok({
      offered: rides
        .filter((snap) => snap.data().driverUid === uid)
        .map((snap) => ({
          ...toRide(snap, uid),
          passengers: (snap.data().passengers || []).map((p) => ({ username: p.username, email: p.email })),
        })),
      booked: rides
        .filter((snap) => (snap.data().passengers || []).some((p) => p.uid === uid))
        .map((snap) => toRide(snap, uid)),
    });
  },

  "POST /Rides/:id/book": async (body, params, id) => {
    const { db, uid, account } = await currentAccount();
    const ref = db.doc(`rides/${id}`);
    return withLease(ref, uid, async () => {
      const snap = await ref.get();
      if (!snap.exists) throw fail(404, "Ride not found");
      const ride = snap.data();
      const passengers = ride.passengers || [];
      if (ride.driverUid === uid) throw fail(400, "You cannot book your own ride");
      if (passengers.some((p) => p.uid === uid)) throw fail(409, "You have already booked this ride");
      if (ride.availableSeats < 1) throw fail(409, "This ride is full");
      await write(ref.update({
        availableSeats: ride.availableSeats - 1,
        passengers: [...passengers, { uid, username: account.username, email: account.email }],
      }));
      return ok({ message: "Seat booked", ride: toRide(await ref.get(), uid) });
    });
  },

  "DELETE /Rides/:id/book": async (body, params, id) => {
    const { db, uid } = await currentAccount();
    const ref = db.doc(`rides/${id}`);
    return withLease(ref, uid, async () => {
      const snap = await ref.get();
      const ride = snap.exists ? snap.data() : null;
      const passengers = ride?.passengers || [];
      if (!ride || !passengers.some((p) => p.uid === uid)) throw fail(404, "Booking not found");
      await write(ref.update({
        availableSeats: ride.availableSeats + 1,
        passengers: passengers.filter((p) => p.uid !== uid),
      }));
      return ok({ message: "Booking cancelled", ride: toRide(await ref.get(), uid) });
    });
  },

  "DELETE /Rides/:id": async (body, params, id) => {
    const { db, uid } = await currentAccount();
    const ref = db.doc(`rides/${id}`);
    const snap = await ref.get();
    if (!snap.exists || snap.data().driverUid !== uid) throw fail(404, "Ride not found");
    await write(ref.delete());
    return ok({ message: "Ride removed" });
  },
};

const request = async (method, url, body = {}, config = {}) => {
  const match = url.match(/^\/Rides\/([A-Za-z0-9_-]+)(\/book)?$/);
  const key = match ? `${method} /Rides/:id${match[2] || ""}` : `${method} ${url}`;
  const handler = routes[key];
  if (!handler) throw fail(404, "Not found");
  try {
    return await handler(typeof body === "string" ? JSON.parse(body) : body || {}, config.params || {}, match?.[1]);
  } catch (err) {
    if (err.response) throw err;
    console.error(err);
    throw fail(500, "Something went wrong. Please try again.");
  }
};

const hostedClient = {
  get: (url, config) => request("GET", url, {}, config),
  post: (url, body, config) => request("POST", url, body, config),
  delete: (url, config) => request("DELETE", url, {}, config),
};

export default hostedClient;
