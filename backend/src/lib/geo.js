// Geometry for route matching. Points are { lat, lng } in degrees.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export const haversineM = (a, b) => {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Local equirectangular projection around a reference latitude, in metres.
// Accurate to well under 1% across a metro area.
const project = (p, refLat) => ({
  x: rad(p.lng) * R * Math.cos(rad(refLat)),
  y: rad(p.lat) * R,
});

export const polylineLengthM = (points) => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
};

// Closest point on a polyline to `p`: distance to the line, and how far along
// the line (in metres from the start) that closest point lies.
export const projectOntoPolyline = (p, points) => {
  const refLat = points[0].lat;
  const P = project(p, refLat);
  let best = { distanceM: Infinity, alongM: 0, segment: 0 };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const A = project(points[i - 1], refLat);
    const B = project(points[i], refLat);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const cx = A.x + t * dx;
    const cy = A.y + t * dy;
    const distanceM = Math.hypot(P.x - cx, P.y - cy);
    const segLen = Math.sqrt(len2);
    if (distanceM < best.distanceM) best = { distanceM, alongM: walked + t * segLen, segment: i - 1 };
    walked += segLen;
  }
  return best;
};

export const withinRadius = (p, center, radiusKm) => haversineM(p, center) <= radiusKm * 1000;
