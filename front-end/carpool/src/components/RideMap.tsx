import L from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Place } from "@/lib/types";

// Tiles default to OpenStreetMap for development. Production should set
// VITE_MAP_TILE_URL to a provider with an appropriate usage agreement.
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const css = (name: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().replace(/ /g, ",")})`;

const Fit = ({ points }: { points: [number, number][] }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
  }, [map, points]);
  return null;
};

export type MapLine = { id: string; points: [number, number][]; highlight?: boolean; onClick?: () => void };

export const RideMap = ({
  lines = [],
  pins = [],
  live,
  height = 320,
  estimate,
}: {
  lines?: MapLine[];
  pins?: (Place & { kind: "pickup" | "dropoff" | "stop" | "origin" | "destination" })[];
  live?: { lat: number; lng: number; stale?: boolean; label?: string } | null;
  height?: number | string;
  estimate?: boolean;
}) => {
  const colours = useMemo(() => ({ brand: css("brand"), muted: css("muted"), signal: css("signal"), bad: css("bad"), surface: css("surface") }), []);
  const all = useMemo(() => [...lines.flatMap((l) => l.points), ...pins.map((p) => [p.lat, p.lng] as [number, number])], [lines, pins]);
  const center: [number, number] = all[0] || [12.9716, 77.5946];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <MapContainer center={center} zoom={12} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }} attributionControl>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        {lines.map((l) => (
          <Polyline
            key={l.id}
            positions={l.points}
            pathOptions={{ color: l.highlight ? colours.brand : colours.muted, weight: l.highlight ? 5 : 3, opacity: l.highlight ? 0.95 : 0.45, dashArray: estimate ? "8 6" : undefined }}
            eventHandlers={l.onClick ? { click: l.onClick } : undefined}
          />
        ))}
        {pins.map((p, i) => (
          <CircleMarker
            key={`${p.kind}-${i}`}
            center={[p.lat, p.lng]}
            radius={p.kind === "stop" ? 5 : 8}
            pathOptions={{ color: colours.surface, weight: 2, fillOpacity: 1, fillColor: p.kind === "pickup" || p.kind === "origin" ? colours.brand : p.kind === "stop" ? colours.muted : colours.signal }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {{ pickup: "Your pickup", dropoff: "Your drop-off", stop: "Stop", origin: "Start", destination: "End" }[p.kind]}: {p.label}
            </Tooltip>
          </CircleMarker>
        ))}
        {live && (
          <CircleMarker center={[live.lat, live.lng]} radius={10} pathOptions={{ color: colours.surface, weight: 3, fillOpacity: 1, fillColor: live.stale ? colours.muted : colours.bad }}>
            <Tooltip permanent direction="right" offset={[10, 0]}>
              {live.label || "Car"}
              {live.stale ? " (last known)" : ""}
            </Tooltip>
          </CircleMarker>
        )}
        <Fit points={all} />
      </MapContainer>
      {estimate && (
        <span className="pointer-events-none absolute bottom-7 left-3 z-[400] rounded-lg bg-surface/95 px-2.5 py-1 text-[11px] font-semibold text-muted shadow-card">
          Route shown is an estimate, not live directions
        </span>
      )}
    </div>
  );
};
