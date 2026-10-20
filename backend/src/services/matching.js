import { haversineM, polylineLengthM, projectOntoPolyline } from "../lib/geo.js";
import { clamp } from "../lib/util.js";

const ROAD_FACTOR = 1.35;

// How well a passenger's trip fits a ride's route.
// route: [[lat, lng], ...] in driving order. Returns null when incompatible.
export const evaluateFit = ({ route, pickup, dropoff, matching }) => {
  const points = route.map(([lat, lng]) => ({ lat, lng }));
  const routeLengthM = polylineLengthM(points);
  const p = projectOntoPolyline(pickup, points);
  const d = projectOntoPolyline(dropoff, points);
  const reasons = [];
  if (p.distanceM > matching.max_pickup_km * 1000) reasons.push("pickup_too_far");
  if (d.distanceM > matching.max_dropoff_km * 1000) reasons.push("dropoff_too_far");
  // Sequencing: the passenger must be picked up before being dropped off.
  if (d.alongM - p.alongM < 500) reasons.push("wrong_direction");
  const passengerTripM = haversineM(pickup, dropoff);
  const sharedM = Math.max(0, d.alongM - p.alongM);
  const overlap = passengerTripM > 0 ? clamp(sharedM / passengerTripM, 0, 1) : 0;
  if (overlap < 0.5) reasons.push("low_overlap");
  // Detour: leaving the route to the pickup and back, and the same at drop-off.
  const detourM = Math.round(2 * (p.distanceM + d.distanceM) * ROAD_FACTOR);
  return {
    compatible: reasons.length === 0,
    reasons,
    pickupDistanceM: Math.round(p.distanceM),
    dropoffDistanceM: Math.round(d.distanceM),
    pickupFraction: routeLengthM ? p.alongM / routeLengthM : 0,
    dropoffFraction: routeLengthM ? d.alongM / routeLengthM : 1,
    sharedM: Math.round(sharedM),
    overlap,
    detourM,
  };
};

// Weighted score in [0, 1] plus the parts, so the UI can explain the ranking.
export const scoreFit = ({ fit, pickupAt, desiredAt, windowMinutes, pricePerSeatPaise, suggestedPaise, matching }) => {
  const w = matching.weights;
  const maxDetourM = 2 * (matching.max_pickup_km + matching.max_dropoff_km) * 1000 * ROAD_FACTOR;
  const parts = {
    overlap: fit.overlap,
    detour: 1 - clamp(fit.detourM / maxDetourM, 0, 1),
    time: desiredAt ? 1 - clamp(Math.abs(pickupAt - desiredAt) / 60000 / windowMinutes, 0, 1) : 1,
    price: suggestedPaise > 0 ? clamp(1 - (pricePerSeatPaise - suggestedPaise) / suggestedPaise, 0, 1) : 1,
  };
  const total = w.overlap + w.detour + w.time + w.price || 1;
  const score = (parts.overlap * w.overlap + parts.detour * w.detour + parts.time * w.time + parts.price * w.price) / total;
  return { score: Math.round(score * 1000) / 1000, parts };
};
