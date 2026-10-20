import { config } from "../../config.js";
import { haversineM, polylineLengthM } from "../../lib/geo.js";
import { istMinutesOfDay } from "../../lib/time.js";
import { unavailable } from "../../lib/errors.js";
import { BENGALURU_PLACES } from "./bengaluruPlaces.js";

// Development provider. Searches a fixed list of localities and estimates
// road distance as straight-line distance x 1.35, with a time-of-day speed.
// Every result carries source "estimate" so the UI can label it.
const ROAD_FACTOR = 1.35;

const speedKmh = (departAt) => {
  const m = istMinutesOfDay(departAt);
  const peak = (m >= 8 * 60 && m <= 11 * 60) || (m >= 17 * 60 && m <= 21 * 60);
  return peak ? 18 : 28;
};

const mockProvider = {
  name: "mock",
  live: false,
  async search(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return BENGALURU_PLACES.filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({ label: p.name, address: p.address, lat: p.lat, lng: p.lng, source: "gazetteer" }));
  },
  async route(points, departAt) {
    const straight = polylineLengthM(points);
    const distanceM = Math.round(straight * ROAD_FACTOR);
    const durationS = Math.round((distanceM / 1000 / speedKmh(departAt)) * 3600);
    return { distanceM, durationS, geometry: points.map((p) => [p.lat, p.lng]), source: "estimate" };
  },
};

const fetchJson = async (url, timeoutMs = 6000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw unavailable(`Map service returned ${res.status}.`);
  return res.json();
};

// Mapbox provider: real geocoding and driving directions. Only active when
// MAPS_PROVIDER=mapbox and MAPBOX_TOKEN are set. Not exercised in this
// repository's tests because it needs a live key.
const mapboxProvider = {
  name: "mapbox",
  live: true,
  async search(query) {
    const token = config.maps.mapboxToken;
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&country=in&proximity=77.5946,12.9716&limit=8&access_token=${token}`;
    const data = await fetchJson(url);
    return (data.features || []).map((f) => ({
      label: f.properties.name,
      address: f.properties.full_address || f.properties.place_formatted || f.properties.name,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      source: "mapbox",
    }));
  },
  async route(points) {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?geometries=geojson&overview=simplified&access_token=${config.maps.mapboxToken}`;
    const data = await fetchJson(url);
    const route = data.routes?.[0];
    if (!route) throw unavailable("No driving route found between these points.");
    return {
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: "mapbox",
    };
  },
};

export const maps = config.maps.provider === "mapbox" ? mapboxProvider : mockProvider;

// Straight-line helper for quick checks that do not need a route.
export const straightLineM = haversineM;
