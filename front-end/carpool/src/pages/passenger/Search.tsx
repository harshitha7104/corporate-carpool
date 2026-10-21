import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, Info, List, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PlaceInput } from "@/components/PlaceInput";
import { RideCard } from "@/components/RideCard";
import { RideMap } from "@/components/RideMap";
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Select, SkeletonList, clsx } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { istDate } from "@/lib/format";
import type { Place, Ride } from "@/lib/types";

type Results = { total: number; items: Ride[]; ranking: { sort: string; weights: Record<string, number>; explanation: string }; routesAreEstimates: boolean };

const parsePlace = (s: string | null): Place | null => {
  if (!s) return null;
  try {
    const p = JSON.parse(s);
    return typeof p.lat === "number" && typeof p.lng === "number" && p.label ? p : null;
  } catch {
    return null;
  }
};

export const Search = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [from, setFrom] = useState<Place | null>(parsePlace(params.get("from")));
  const [to, setTo] = useState<Place | null>(parsePlace(params.get("to")));
  const [date, setDate] = useState(params.get("date") || istDate());
  const [timeOfDay, setTimeOfDay] = useState(params.get("time") || "");
  const [seats, setSeats] = useState(params.get("seats") || "1");
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [hover, setHover] = useState<string | null>(null);

  const filters = {
    maxPrice: params.get("maxPrice") || "",
    flex: params.get("flex") || "",
    verifiedOnly: params.get("verifiedOnly") === "true",
    instantOnly: params.get("instantOnly") === "true",
    womenOnly: params.get("womenOnly") === "true",
    sort: params.get("sort") || "best",
  };

  const setParam = (k: string, v: string | boolean) => {
    const next = new URLSearchParams(params);
    if (v === "" || v === false) next.delete(k);
    else next.set(k, String(v));
    setParams(next, { replace: true });
  };

  const submitted = { from: parsePlace(params.get("from")), to: parsePlace(params.get("to")), date: params.get("date") || istDate(), time: params.get("time") || "", seats: params.get("seats") || "1" };

  const query = useQuery({
    queryKey: ["search", params.toString()],
    enabled: Boolean(submitted.from && submitted.to),
    queryFn: ({ signal }) =>
      api.get<Results>(
        `/rides/search${qs({
          fromLat: submitted.from!.lat, fromLng: submitted.from!.lng, fromLabel: submitted.from!.label,
          toLat: submitted.to!.lat, toLng: submitted.to!.lng, toLabel: submitted.to!.label,
          date: submitted.date, time: submitted.time || undefined, seats: submitted.seats,
          flexMinutes: filters.flex || undefined, maxPricePaise: filters.maxPrice ? Number(filters.maxPrice) * 100 : undefined,
          verifiedOnly: filters.verifiedOnly || undefined, instantOnly: filters.instantOnly || undefined, womenOnly: filters.womenOnly || undefined, sort: filters.sort,
        })}`,
        signal
      ),
  });

  useEffect(() => {
    setFrom(parsePlace(params.get("from")));
    setTo(parsePlace(params.get("to")));
  }, [params]);

  const run = () => {
    if (!from || !to) return;
    const next = new URLSearchParams(params);
    next.set("from", JSON.stringify(from));
    next.set("to", JSON.stringify(to));
    next.set("date", date);
    if (timeOfDay) next.set("time", timeOfDay);
    else next.delete("time");
    next.set("seats", seats);
    setParams(next);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const lines = useMemo(
    () => (query.data?.items || []).map((r) => ({ id: r.id, points: r.route, highlight: hover ? hover === r.id : true, onClick: () => navigate(rideLink(r.id)) })),
    [query.data, hover] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rideLink = (id: string) => `/app/rides/${id}${qs({ from: params.get("from"), to: params.get("to"), seats: submitted.seats })}`;

  return (
    <div>
      <PageHeader title="Find a ride" subtitle="Rides whose route passes near your pickup and drop-off, in the right direction." />
      <form
        className="card grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr]"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <PlaceInput label="From" value={from} onChange={setFrom} />
        <button type="button" onClick={swap} className="-my-1 justify-self-end rounded-xl border border-line p-2.5 text-muted hover:bg-sunken md:my-0 md:self-end" aria-label="Swap from and to">
          <ArrowUpDown className="h-5 w-5" />
        </button>
        <PlaceInput label="To" value={to} onChange={setTo} />
        <div className="grid grid-cols-2 gap-3 md:col-span-3 md:grid-cols-[1fr_1fr_120px_auto]">
          <div className="col-span-2 md:col-span-1"><Field label="Date" htmlFor="s-date">
            <Input id="s-date" type="date" value={date} min={istDate()} onChange={(e) => setDate(e.target.value)} />
          </Field></div>
          <Field label="Around" htmlFor="s-time" optional>
            <Input id="s-time" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          </Field>
          <Field label="Seats" htmlFor="s-seats">
            <Select id="s-seats" value={seats} onChange={(e) => setSeats(e.target.value)}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <div className="col-span-2 flex items-end md:col-span-1">
            <Button type="submit" className="w-full" disabled={!from || !to}>Search</Button>
          </div>
        </div>
      </form>

      {submitted.from && submitted.to && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {query.data ? `${query.data.total} matching ride${query.data.total === 1 ? "" : "s"}` : "Searching…"} · {submitted.from.label} → {submitted.to.label}
            </p>
            <div className="flex flex-wrap gap-2">
              <Select aria-label="Sort" className="h-9 w-auto text-sm" value={filters.sort} onChange={(e) => setParam("sort", e.target.value)}>
                <option value="best">Best match</option>
                <option value="earliest">Earliest pickup</option>
                <option value="cheapest">Lowest contribution</option>
              </Select>
              <Button variant="secondary" size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </Button>
              <div className="flex rounded-lg border border-line lg:hidden">
                <button className={clsx("h-9 px-3", view === "list" && "bg-sunken")} onClick={() => setView("list")} aria-label="List view"><List className="h-4 w-4" /></button>
                <button className={clsx("h-9 px-3", view === "map" && "bg-sunken")} onClick={() => setView("map")} aria-label="Map view"><MapIcon className="h-4 w-4" /></button>
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="card mb-4 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Max contribution (₹)" htmlFor="f-price">
                <Input id="f-price" inputMode="numeric" value={filters.maxPrice} onChange={(e) => setParam("maxPrice", e.target.value.replace(/\D/g, ""))} placeholder="Any" />
              </Field>
              <Field label="Time flexibility" htmlFor="f-flex">
                <Select id="f-flex" value={filters.flex} onChange={(e) => setParam("flex", e.target.value)} disabled={!submitted.time}>
                  <option value="">Default (±90 min)</option>
                  <option value="30">±30 min</option>
                  <option value="60">±1 hour</option>
                  <option value="120">±2 hours</option>
                </Select>
              </Field>
              {([
                ["verifiedOnly", "Verified drivers only"],
                ["instantOnly", "Instant booking only"],
                ["womenOnly", "Women-only rides"],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2.5 self-end pb-2.5 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={filters[k]} onChange={(e) => setParam(k, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          )}

          {query.data && (
            <details className="mb-4 rounded-xl bg-sunken px-4 py-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium"><Info className="h-4 w-4 text-muted" /> How results are ranked</summary>
              <p className="mt-2 text-muted">{query.data.ranking.explanation}</p>
              <p className="mt-1 text-muted">
                Weights: route coverage {Math.round(query.data.ranking.weights.overlap * 100)}%, detour {Math.round(query.data.ranking.weights.detour * 100)}%, time {Math.round(query.data.ranking.weights.time * 100)}%, contribution {Math.round(query.data.ranking.weights.price * 100)}%.
                {query.data.routesAreEstimates && " Distances and times are estimates; live routing is not configured."}
              </p>
            </details>
          )}

          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <div className={clsx(view === "map" && "hidden lg:block")}>
              {query.isLoading && <SkeletonList rows={3} height="h-44" />}
              {query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}
              {query.data && query.data.items.length === 0 && (
                <EmptyState
                  title="No rides match this trip yet"
                  body="Try another time, widen the time flexibility, or save it as a regular route to see new rides as drivers publish them."
                  action={<Button variant="secondary" onClick={() => navigate("/app/commutes")}>Save as a regular route</Button>}
                />
              )}
              <div className="space-y-3">
                {query.data?.items.map((r) => <RideCard key={r.id} ride={r} to={rideLink(r.id)} highlight={hover === r.id} onHover={setHover} />)}
              </div>
            </div>
            <div className={clsx("lg:sticky lg:top-6 lg:self-start", view === "list" && "hidden lg:block")}>
              <RideMap
                lines={lines}
                pins={[{ ...submitted.from, kind: "pickup" }, { ...submitted.to, kind: "dropoff" }]}
                height={view === "map" ? "65vh" : 460}
                estimate={query.data?.routesAreEstimates}
              />
              <p className="mt-2 text-xs text-muted">Green dot: your pickup. Amber dot: your drop-off. Hover a ride to highlight its route.</p>
            </div>
          </div>
        </div>
      )}
      {!submitted.from && (
        <Notice tone="info" className="mt-6">Pick a start and destination to see rides. Tip: save home and work under Saved places to fill these in one tap.</Notice>
      )}
    </div>
  );
};
