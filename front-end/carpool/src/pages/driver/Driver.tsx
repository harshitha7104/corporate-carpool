import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Car, CheckCircle2, Circle, ClipboardCheck, Plus, Repeat, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlaceInput } from "@/components/PlaceInput";
import { DriverLine, TripTimeline } from "@/components/RideCard";
import { RideMap } from "@/components/RideMap";
import {
  BOOKING_STATUS, Button, Card, ConfirmDialog, DemoTag, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Pill, RIDE_STATUS,
  Section, Select, SkeletonList, Stat, StatusPill, Textarea, Toggle, VERIFICATION_STATUS, clsx, useToast,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { WEEKDAYS, dateTime, day, duration, fullDate, istDate, istToIso, km, plate, rupees, time, until } from "@/lib/format";
import { useRideChannel } from "@/lib/realtime";
import { isVerifiedDriver, useMe, useMeta } from "@/lib/session";
import type { Booking, Place, Ride, Vehicle } from "@/lib/types";
import { UploadField } from "../passenger/Profile";

const useVehicles = () => useQuery({ queryKey: ["vehicles"], queryFn: () => api.get<{ items: Vehicle[] }>("/vehicles") });

// ---- Driver home --------------------------------------------------------------------------
export const DriverHome = () => {
  const { data: me } = useMe();
  const vehicles = useVehicles();
  const rides = useQuery({ queryKey: ["driver-rides", "upcoming"], queryFn: () => api.get<{ items: Ride[] }>("/rides/mine?scope=upcoming&limit=20") });
  const drafts = useQuery({ queryKey: ["driver-rides", "drafts"], queryFn: () => api.get<{ items: Ride[] }>("/rides/mine?scope=drafts&limit=20") });
  const summary = useQuery({ queryKey: ["driver-summary"], queryFn: () => api.get<{ netPaise: number; payments: number }>("/payments/driver-summary?limit=1") });
  if (!me) return null;
  const v = me.verification;
  const verifiedVehicle = vehicles.data?.items.some((x) => x.verification.status === "verified");
  const steps = [
    { done: v.government_id.status === "verified", label: "Government ID verified", status: v.government_id.status, to: "/app/drive/verification" },
    { done: v.driving_license.status === "verified", label: "Driving licence verified", status: v.driving_license.status, to: "/app/drive/verification" },
    { done: Boolean(verifiedVehicle), label: "A vehicle with verified documents", status: vehicles.data?.items.length ? vehicles.data.items[0].verification.status : "not_submitted", to: "/app/drive/vehicles" },
  ];
  const ready = steps.every((s) => s.done);
  const pending = (rides.data?.items || []).reduce((n, r) => n + (r.pendingRequests || 0), 0);
  return (
    <div>
      <PageHeader title="Driver home" actions={<Link to="/app/drive/new" className="btn-primary"><Plus className="h-4 w-4" /> Offer a ride</Link>} />
      {!ready && (
        <Card className="mb-6 p-5">
          <h2 className="text-lg font-semibold">Before you can publish rides</h2>
          <p className="text-sm text-muted">You can save rides as drafts now. Publishing needs all three checks.</p>
          <ul className="mt-4 space-y-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-sunken">
                  <span className="flex items-center gap-2.5">{s.done ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-line" />}<span className={clsx(s.done && "text-muted")}>{s.label}</span></span>
                  <StatusPill map={VERIFICATION_STATUS} value={s.done ? "verified" : s.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Upcoming rides" value={rides.data?.items.length ?? "—"} />
        <Stat label="Requests waiting" value={pending} hint={pending ? <Link to="/app/drive/requests" className="font-semibold text-brand">Review now</Link> : "None right now"} />
        <Stat label="Contributions received" value={summary.data ? rupees(summary.data.netPaise, { free: "₹0" }) : "—"} hint="After refunds" />
      </div>
      <Section title="Upcoming rides">
        {rides.isLoading ? <SkeletonList rows={2} height="h-20" /> : rides.data?.items.length ? (
          <div className="space-y-3">{rides.data.items.map((r) => <DriverRideRow key={r.id} r={r} />)}</div>
        ) : <EmptyState icon={<Car />} title="No upcoming rides" body="Publish your next commute and passengers going your way can book." action={<Link to="/app/drive/new" className="btn-primary btn-sm">Offer a ride</Link>} />}
      </Section>
      {drafts.data && drafts.data.items.length > 0 && (
        <Section title="Drafts">
          <div className="space-y-3">{drafts.data.items.map((r) => <DriverRideRow key={r.id} r={r} />)}</div>
        </Section>
      )}
    </div>
  );
};

const DriverRideRow = ({ r }: { r: Ride }) => (
  <Link to={`/app/drive/rides/${r.id}`} className="card flex items-center justify-between gap-3 p-4 hover:shadow-lift">
    <div className="min-w-0">
      <p className="text-sm text-muted">{dateTime(r.departureAt)}{r.recurringRuleId && " · commute"}</p>
      <p className="truncate font-semibold">{r.origin.label} → {r.destination.label}</p>
      <p className="text-sm text-muted">{r.seatsTotal - r.seatsAvailable} of {r.seatsTotal} seats taken · {rupees(r.pricePerSeatPaise)} per seat</p>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      <StatusPill map={RIDE_STATUS} value={r.status} />
      {r.pendingRequests ? <Pill tone="info">{r.pendingRequests} request{r.pendingRequests > 1 ? "s" : ""}</Pill> : null}
      <DemoTag show={r.isDemo} />
    </div>
  </Link>
);

// ---- Shared ride form fields -----------------------------------------------------------------
type Preview = { distanceM: number; durationS: number; suggestedPaise: number; maxPaise: number; routeIsEstimate: boolean; geometry: [number, number][] };

const useRoutePreview = (origin: Place | null, destination: Place | null, stops: Place[], departureAt: string | null) =>
  useQuery({
    queryKey: ["preview", origin?.lat, origin?.lng, destination?.lat, destination?.lng, stops.map((s) => `${s.lat},${s.lng}`).join("|"), departureAt],
    queryFn: () => api.post<Preview>("/rides/preview", { origin, destination, stops, departureAt }),
    enabled: Boolean(origin && destination && departureAt),
    staleTime: 60_000,
    retry: false,
  });

const RouteBuilder = ({ origin, setOrigin, destination, setDestination, stops, setStops }: { origin: Place | null; setOrigin: (p: Place | null) => void; destination: Place | null; setDestination: (p: Place | null) => void; stops: (Place | null)[]; setStops: (s: (Place | null)[]) => void }) => (
  <div className="space-y-3">
    <PlaceInput label="Starting point" value={origin} onChange={setOrigin} />
    {stops.map((s, i) => (
      <div key={i} className="flex items-end gap-2">
        <div className="flex-1"><PlaceInput label={`Stop ${i + 1} (pickup or drop-off point)`} value={s} onChange={(p) => setStops(stops.map((x, j) => (j === i ? p : x)))} /></div>
        <Button type="button" variant="ghost" onClick={() => setStops(stops.filter((_, j) => j !== i))} aria-label={`Remove stop ${i + 1}`}><Trash2 className="h-4 w-4" /></Button>
      </div>
    ))}
    {stops.length < 4 && <Button type="button" variant="ghost" size="sm" onClick={() => setStops([...stops, null])}><Plus className="h-4 w-4" /> Add a stop</Button>}
    <PlaceInput label="Destination" value={destination} onChange={setDestination} />
  </div>
);

const PriceField = ({ preview, value, setValue }: { preview?: Preview; value: number | null; setValue: (n: number) => void }) => {
  useEffect(() => {
    if (preview && (value === null || value > preview.maxPaise)) setValue(preview.suggestedPaise);
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!preview) return <Field label="Contribution per seat"><p className="text-sm text-muted">Choose the route and time to see the suggested contribution.</p></Field>;
  const rs = (value ?? preview.suggestedPaise) / 100;
  return (
    <Field label="Contribution per seat" hint={`Suggested ${rupees(preview.suggestedPaise)} for ${km(preview.distanceM)}. Maximum ${rupees(preview.maxPaise)} so it stays cost sharing.`}>
      <div className="flex items-center gap-3">
        <input type="range" className="flex-1 accent-[rgb(var(--brand))]" min={0} max={preview.maxPaise / 100} step={5} value={rs} onChange={(e) => setValue(Number(e.target.value) * 100)} aria-label="Contribution per seat in rupees" />
        <div className="flex w-28 items-center rounded-xl border border-line bg-surface px-3">
          <span className="text-muted">₹</span>
          <input className="h-11 w-full bg-transparent px-1 text-right font-semibold tabular outline-none" inputMode="numeric" value={rs} onChange={(e) => setValue(Math.min(preview.maxPaise, Number(e.target.value.replace(/\D/g, "") || 0) * 100))} aria-label="Contribution amount" />
        </div>
      </div>
    </Field>
  );
};

const Preferences = ({ ac, setAc, luggage, setLuggage, womenOnly, setWomenOnly, mode, setMode, cutoff, setCutoff, canWomenOnly }: {
  ac: boolean; setAc: (v: boolean) => void; luggage: string; setLuggage: (v: string) => void; womenOnly: boolean; setWomenOnly: (v: boolean) => void;
  mode: "instant" | "request"; setMode: (v: "instant" | "request") => void; cutoff: number; setCutoff: (v: number) => void; canWomenOnly: boolean;
}) => (
  <div className="space-y-4">
    <div>
      <p className="label">Booking</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {([["request", "Approve each request", "You see who's asking before they get a seat."], ["instant", "Instant booking", "Passengers get a seat straight away."]] as const).map(([v, t, d]) => (
          <button type="button" key={v} onClick={() => setMode(v)} aria-pressed={mode === v} className={clsx("rounded-xl border p-3 text-left", mode === v ? "border-brand bg-brand-soft" : "border-line")}>
            <span className="block font-semibold">{t}</span><span className="block text-sm text-muted">{d}</span>
          </button>
        ))}
      </div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Luggage space" htmlFor="pf-lug">
        <Select id="pf-lug" value={luggage} onChange={(e) => setLuggage(e.target.value)}>
          <option value="none">No luggage</option><option value="small">Small bag or laptop</option><option value="medium">Medium bag</option><option value="large">Large suitcase</option>
        </Select>
      </Field>
      <Field label="Booking closes" htmlFor="pf-cut">
        <Select id="pf-cut" value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))}>
          {[10, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`} before departure</option>)}
        </Select>
      </Field>
    </div>
    <Toggle label="Air conditioning on" checked={ac} onChange={setAc} />
    <Toggle label="Women-only ride" description={canWomenOnly ? "Only passengers whose profile says female can book." : "Available when your profile gender is set to female."} checked={womenOnly} onChange={(v) => canWomenOnly && setWomenOnly(v)} />
  </div>
);

// ---- Create ride ------------------------------------------------------------------------------------
export const CreateRide = () => {
  const { data: me } = useMe();
  const { data: meta } = useMeta();
  const vehicles = useVehicles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState("");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [stops, setStops] = useState<(Place | null)[]>([]);
  const [date, setDate] = useState(istDate(1));
  const [clock, setClock] = useState("08:30");
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState<number | null>(null);
  const [mode, setMode] = useState<"instant" | "request">("request");
  const [cutoff, setCutoff] = useState(30);
  const [luggage, setLuggage] = useState("small");
  const [ac, setAc] = useState(true);
  const [womenOnly, setWomenOnly] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vehicleId && vehicles.data?.items.length) setVehicleId((vehicles.data.items.find((v) => v.verification.status === "verified") || vehicles.data.items[0]).id);
  }, [vehicles.data, vehicleId]);

  const departureAt = date && clock ? istToIso(date, clock) : null;
  const cleanStops = stops.filter(Boolean) as Place[];
  const preview = useRoutePreview(origin, destination, cleanStops, departureAt);
  const vehicle = vehicles.data?.items.find((v) => v.id === vehicleId);
  const canPublish = isVerifiedDriver(me) && vehicle?.verification.status === "verified";

  const create = useMutation({
    mutationFn: (publish: boolean) => api.post<Ride>("/rides", {
      vehicleId, origin, destination, stops: cleanStops, departureAt, seatsTotal: seats, pricePerSeatPaise: price ?? preview.data?.suggestedPaise ?? 0,
      bookingMode: mode, bookingCutoffMinutes: cutoff, womenOnly, luggage, notes: notes || undefined, preferences: { ac }, publish,
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["driver-rides"] });
      toast.success(r.status === "published" ? "Ride published" : "Draft saved");
      navigate(`/app/drive/rides/${r.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (vehicles.isLoading) return <SkeletonList />;
  if (!vehicles.data?.items.length) {
    return (
      <div>
        <PageHeader title="Offer a ride" />
        <EmptyState icon={<Car />} title="Add your car first" body="Tell us about the vehicle you'll drive, then upload its RC and insurance for review." action={<Link to="/app/drive/vehicles" className="btn-primary">Add a vehicle</Link>} />
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Offer a ride" subtitle="Publish a trip you're already making and share the cost with people going your way." />
      {!canPublish && <Notice tone="warn" className="mb-5">You can save this as a draft. Publishing needs a verified ID, licence and vehicle. <Link className="font-semibold underline" to="/app/drive">See what's missing</Link></Notice>}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setError(""); create.mutate(true); }}>
          <Card className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">Route</h2>
            <RouteBuilder origin={origin} setOrigin={setOrigin} destination={destination} setDestination={setDestination} stops={stops} setStops={setStops} />
          </Card>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="text-lg font-semibold sm:col-span-2">When and who</h2>
            <Field label="Date" htmlFor="cr-d"><Input id="cr-d" type="date" value={date} min={istDate()} max={istDate(60)} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Departure time" htmlFor="cr-t" hint="India Standard Time"><Input id="cr-t" type="time" value={clock} onChange={(e) => setClock(e.target.value)} /></Field>
            <Field label="Vehicle" htmlFor="cr-v">
              <Select id="cr-v" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                {vehicles.data.items.map((v) => <option key={v.id} value={v.id}>{v.color} {v.make} {v.model} ({plate(v.plateNumber)}){v.verification.status !== "verified" ? " · not verified" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Seats offered" htmlFor="cr-s">
              <Select id="cr-s" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                {Array.from({ length: vehicle?.seats || 4 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">Contribution</h2>
            <PriceField preview={preview.data} value={price} setValue={setPrice} />
            {meta && meta.fees.platform_fee_percent > 0 && <p className="text-sm text-muted">Green Way adds a {meta.fees.platform_fee_percent}% platform fee to what passengers pay; you receive the full contribution.</p>}
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">Preferences</h2>
            <Preferences ac={ac} setAc={setAc} luggage={luggage} setLuggage={setLuggage} womenOnly={womenOnly} setWomenOnly={setWomenOnly} mode={mode} setMode={setMode} cutoff={cutoff} setCutoff={setCutoff} canWomenOnly={me?.profile?.gender === "female" && Boolean(meta?.features.women_only_rides)} />
            <Field label="Note for passengers" htmlFor="cr-n" optional><Textarea id="cr-n" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. Pickup at the main gate, I leave on time." /></Field>
          </Card>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!origin || !destination || !preview.data || !canPublish} loading={create.isPending && create.variables === true}>Publish ride</Button>
            <Button type="button" variant="secondary" disabled={!origin || !destination || !preview.data} loading={create.isPending && create.variables === false} onClick={() => { setError(""); create.mutate(false); }}>Save as draft</Button>
          </div>
        </form>
        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <RideMap lines={preview.data ? [{ id: "p", points: preview.data.geometry, highlight: true }] : []} pins={[...(origin ? [{ ...origin, kind: "origin" as const }] : []), ...cleanStops.map((s) => ({ ...s, kind: "stop" as const })), ...(destination ? [{ ...destination, kind: "destination" as const }] : [])]} height={320} estimate={preview.data?.routeIsEstimate} />
          {preview.error && <Notice tone="bad">{errorMessage(preview.error)}</Notice>}
          {preview.data && (
            <Card className="p-4 text-sm">
              <p><span className="font-semibold">{km(preview.data.distanceM)}</span> · about {duration(preview.data.durationS)}{preview.data.routeIsEstimate && " (estimate)"}</p>
              {departureAt && <p className="text-muted">Arrives around {time(new Date(new Date(departureAt).getTime() + preview.data.durationS * 1000))}</p>}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
};

// ---- Manage a ride ---------------------------------------------------------------------------------------
export const ManageRide = () => {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const ride = useQuery({ queryKey: ["ride", id], queryFn: () => api.get<Ride>(`/rides/${id}`) });
  const bookings = useQuery({ queryKey: ["ride-bookings", id], queryFn: () => api.get<{ items: Booking[] }>(`/rides/${id}/bookings`) });
  useRideChannel(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reject, setReject] = useState<Booking | null>(null);
  const [driverCancel, setDriverCancel] = useState<Booking | null>(null);
  const [shareLocation, setShareLocation] = useState(true);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ride", id] });
    qc.invalidateQueries({ queryKey: ["ride-bookings", id] });
    qc.invalidateQueries({ queryKey: ["driver-rides"] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(path, body),
    onSuccess: refresh,
    onError: (e) => toast.error(e),
  });
  const del = useMutation({ mutationFn: () => api.del(`/rides/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["driver-rides"] }); navigate("/app/drive"); } });

  if (ride.isLoading) return <SkeletonList rows={3} />;
  if (ride.error) return <ErrorState error={ride.error} />;
  const r = ride.data!;
  const list = bookings.data?.items || [];
  const requests = list.filter((b) => b.status === "REQUESTED");
  const riders = list.filter((b) => ["ACCEPTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "DISPUTED"].includes(b.status));
  const other = list.filter((b) => !requests.includes(b) && !riders.includes(b));
  const minutesToGo = (new Date(r.departureAt).getTime() - Date.now()) / 60000;
  const past = minutesToGo < 0;

  return (
    <div>
      <PageHeader back={{ to: "/app/drive", label: "Driver home" }} title={`${r.origin.label} → ${r.destination.label}`} subtitle={`${dateTime(r.departureAt)} · ${r.seatsTotal - r.seatsAvailable} of ${r.seatsTotal} seats taken · ${rupees(r.pricePerSeatPaise)} per seat`} actions={<><StatusPill map={RIDE_STATUS} value={r.status} /><DemoTag show={r.isDemo} /></>} />

      {r.status === "draft" && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <p>This ride is a draft. Passengers can't see it yet.</p>
          <div className="flex gap-2">
            <Button onClick={() => act.mutate({ path: `/rides/${id}/publish` }, { onSuccess: () => toast.success("Published") })} loading={act.isPending}>Publish</Button>
            <Button variant="secondary" onClick={() => del.mutate()} loading={del.isPending}>Delete draft</Button>
          </div>
        </Card>
      )}
      {r.status === "published" && (
        <Card className="mb-5 p-4">
          {minutesToGo <= 60 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Ready to go?</p>
                <p className="text-sm text-muted">Starting the ride notifies confirmed passengers. Unpaid and unanswered bookings lapse.</p>
                <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} /> Share my live location with confirmed passengers during the trip</label>
              </div>
              <Button onClick={() => act.mutate({ path: `/rides/${id}/start`, body: { shareLocation } }, { onSuccess: () => navigate(`/app/trips/live/${id}`) })} loading={act.isPending}>Start ride</Button>
            </div>
          ) : (
            <p className="text-sm text-muted">You can start the ride from an hour before departure ({time(new Date(new Date(r.departureAt).getTime() - 3600000))}).</p>
          )}
        </Card>
      )}
      {r.status === "in_progress" && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="font-semibold">Ride in progress</p>
          <div className="flex gap-2">
            <Link to={`/app/trips/live/${id}`} className="btn-secondary">Trip screen</Link>
            <Button onClick={() => act.mutate({ path: `/rides/${id}/complete` }, { onSuccess: () => toast.success("Ride completed") })} loading={act.isPending}>Complete ride</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section title={`Requests${requests.length ? ` (${requests.length})` : ""}`}>
            {requests.length ? (
              <div className="space-y-3">
                {requests.map((b) => (
                  <Card key={b.id} className="p-4">
                    {b.passenger && <DriverLine driver={b.passenger} compact asPassenger />}
                    <p className="mt-3 text-sm">{b.seats} seat{b.seats > 1 ? "s" : ""} · {b.pickup.label} → {b.dropoff.label}{b.detourM ? ` · about ${km(b.detourM)} detour` : ""}</p>
                    {b.message && <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-sm">{b.message}</p>}
                    {b.expiresAt && <p className="mt-2 text-xs text-muted">Request expires {until(b.expiresAt)}, at {time(b.expiresAt)}</p>}
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => act.mutate({ path: `/bookings/${b.id}/accept` }, { onSuccess: () => toast.success("Accepted") })} loading={act.isPending && act.variables?.path.includes(b.id)}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => setReject(b)}>Decline</Button>
                      {b.conversationId && <Link to={`/app/messages/${b.conversationId}`} className="btn-ghost btn-sm">Message</Link>}
                    </div>
                  </Card>
                ))}
              </div>
            ) : <p className="text-sm text-muted">No requests waiting.</p>}
          </Section>

          <Section title="Passengers">
            {riders.length ? (
              <div className="space-y-3">
                {riders.map((b) => (
                  <Card key={b.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {b.passenger && <DriverLine driver={b.passenger} compact asPassenger />}
                      <StatusPill map={BOOKING_STATUS} value={b.status} override={b.status === "CANCELLED_BY_PASSENGER" ? "Cancelled by passenger" : undefined} />
                    </div>
                    <p className="mt-2 text-sm">{b.seats} seat{b.seats > 1 ? "s" : ""} · pickup {b.pickup.label}{b.pickupEtaAt && ` around ${time(b.pickupEtaAt)}`} · drop-off {b.dropoff.label}</p>
                    <p className="text-sm text-muted">{b.status === "ACCEPTED" ? "Waiting for payment" : b.payment?.status === "captured" ? `Paid ${rupees(b.payment.amountPaise)}${b.payment.isSimulated ? " (simulated)" : ""}` : b.totalPaise === 0 ? "No payment due" : ""}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.status === "in_progress" && b.status === "CONFIRMED" && (
                        <>
                          <Button size="sm" onClick={() => act.mutate({ path: `/bookings/${b.id}/pickup` })}>Picked up</Button>
                          {past && <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: `/bookings/${b.id}/no-show` })}>No-show</Button>}
                        </>
                      )}
                      {r.status === "in_progress" && b.status === "IN_PROGRESS" && <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: `/bookings/${b.id}/complete` })}>Dropped off</Button>}
                      {["ACCEPTED", "CONFIRMED"].includes(b.status) && r.status === "published" && <Button size="sm" variant="ghost" onClick={() => setDriverCancel(b)}>Cancel seat</Button>}
                      {b.conversationId && <Link to={`/app/messages/${b.conversationId}`} className="btn-ghost btn-sm">Message</Link>}
                      <Link to={`/app/bookings/${b.id}`} className="btn-ghost btn-sm">Details</Link>
                    </div>
                  </Card>
                ))}
              </div>
            ) : <p className="text-sm text-muted">No passengers yet.</p>}
          </Section>
          {other.length > 0 && (
            <Section title="Earlier requests">
              <ul className="card divide-y divide-line text-sm">
                {other.map((b) => <li key={b.id} className="flex justify-between px-4 py-2.5"><span>{b.passenger?.displayName} · {b.seats} seat{b.seats > 1 ? "s" : ""}</span><StatusPill map={BOOKING_STATUS} value={b.status} /></li>)}
              </ul>
            </Section>
          )}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <RideMap lines={[{ id: r.id, points: r.route, highlight: true }]} pins={[{ ...r.origin, kind: "origin" }, ...r.stops.map((s) => ({ ...s, kind: "stop" as const })), { ...r.destination, kind: "destination" }, ...riders.map((b) => ({ ...b.pickup, kind: "pickup" as const }))]} height={260} estimate={r.routeIsEstimate} />
          <Card className="p-4">
            <TripTimeline items={[{ time: time(r.departureAt), title: r.origin.label }, ...r.stops.map((s) => ({ time: time(new Date(new Date(r.departureAt).getTime() + s.offsetMinutes * 60000)), title: s.label, tone: "muted" as const })), { time: time(r.estArrivalAt), title: r.destination.label, tone: "signal" as const }]} />
          </Card>
          <Card className="p-4 text-sm">
            <p>{r.vehicle.color} {r.vehicle.make} {r.vehicle.model} · <span className="tabular">{plate(r.vehicle.plateNumber)}</span></p>
            <p className="text-muted">{r.bookingMode === "instant" ? "Instant booking" : "You approve requests"} · closes {r.bookingCutoffMinutes} min before</p>
          </Card>
          {["draft", "published"].includes(r.status) && <Button variant="secondary" className="w-full" onClick={() => setCancelOpen(true)}>Cancel this ride</Button>}
        </aside>
      </div>

      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} danger title="Cancel this ride?" confirmLabel="Cancel ride" reasonLabel="Tell your passengers why" reasonRequired busy={act.isPending}
        body={riders.length ? `${riders.length} passenger booking${riders.length > 1 ? "s" : ""} will be cancelled and fully refunded. Frequent cancellations affect your standing.` : "Nobody has booked yet."}
        onConfirm={(reason) => act.mutate({ path: `/rides/${id}/cancel`, body: { reason } }, { onSuccess: () => { setCancelOpen(false); toast.success("Ride cancelled"); } })} />
      <ConfirmDialog open={Boolean(reject)} onClose={() => setReject(null)} title="Decline this request?" confirmLabel="Decline" reasonLabel="Message to the passenger" busy={act.isPending}
        body="The passenger is told you couldn't take them and can look for another ride."
        onConfirm={(reason) => act.mutate({ path: `/bookings/${reject!.id}/reject`, body: { reason: reason || undefined } }, { onSuccess: () => setReject(null) })} />
      <ConfirmDialog open={Boolean(driverCancel)} onClose={() => setDriverCancel(null)} danger title="Cancel this passenger's seat?" confirmLabel="Cancel seat" reasonLabel="Reason" reasonRequired busy={act.isPending}
        body="They'll be refunded in full and notified."
        onConfirm={(reason) => act.mutate({ path: `/bookings/${driverCancel!.id}/driver-cancel`, body: { reason } }, { onSuccess: () => setDriverCancel(null) })} />
    </div>
  );
};

// ---- All pending requests --------------------------------------------------------------------
export const DriverRequests = () => {
  const rides = useQuery({ queryKey: ["driver-rides", "upcoming"], queryFn: () => api.get<{ items: Ride[] }>("/rides/mine?scope=upcoming&limit=50") });
  const withRequests = (rides.data?.items || []).filter((r) => r.pendingRequests);
  return (
    <div>
      <PageHeader title="Booking requests" subtitle="Requests expire if you don't answer in time, so passengers can find another ride." />
      {rides.isLoading ? <SkeletonList rows={2} /> : withRequests.length ? (
        <div className="space-y-3">{withRequests.map((r) => <DriverRideRow key={r.id} r={r} />)}</div>
      ) : <EmptyState icon={<ClipboardCheck />} title="No requests waiting" body="When a passenger asks for a seat on a request-to-book ride, it shows here." />}
    </div>
  );
};

// ---- Recurring commutes -----------------------------------------------------------------------
type Rule = { id: string; status: string; isDemo: boolean; vehicleId: string; origin: Place; destination: Place; daysOfWeek: number[]; departureTime: string; startDate: string; endDate: string | null; skipDates: string[]; seatsTotal: number; pricePerSeatPaise: number; bookingMode: string; upcoming: { id: string; service_date: string; departure_at: string; status: string; seats_available: number }[] };

export const DriverCommutes = () => {
  const { data: me } = useMe();
  const vehicles = useVehicles();
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.get<{ items: Rule[] }>("/commutes/me") });
  const [show, setShow] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [stops, setStops] = useState<(Place | null)[]>([]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [clock, setClock] = useState("08:30");
  const [startDate, setStartDate] = useState(istDate(1));
  const [endDate, setEndDate] = useState("");
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState<number | null>(null);
  const [mode, setMode] = useState<"instant" | "request">("instant");
  const [skip, setSkip] = useState<Record<string, string>>({});
  const cleanStops = stops.filter(Boolean) as Place[];
  const preview = useRoutePreview(origin, destination, cleanStops, startDate ? istToIso(startDate, clock) : null);
  useEffect(() => {
    if (!vehicleId && vehicles.data?.items.length) setVehicleId(vehicles.data.items[0].id);
  }, [vehicles.data, vehicleId]);
  const create = useMutation({
    mutationFn: () => api.post("/commutes", { vehicleId, origin, destination, stops: cleanStops, daysOfWeek: days, departureTime: clock, startDate, endDate: endDate || null, seatsTotal: seats, pricePerSeatPaise: price ?? preview.data?.suggestedPaise ?? 0, bookingMode: mode, preferences: { ac: true } }),
    onSuccess: () => { setShow(false); qc.invalidateQueries({ queryKey: ["rules"] }); qc.invalidateQueries({ queryKey: ["driver-rides"] }); toast.success("Commute published. Rides for the next two weeks are live."); },
    onError: (e) => toast.error(e),
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api.patch(`/commutes/${id}`, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); qc.invalidateQueries({ queryKey: ["driver-rides"] }); }, onError: (e) => toast.error(e) });
  return (
    <div>
      <PageHeader title="Recurring commutes" subtitle="Publish your regular trip once. Each day's ride appears two weeks ahead and is booked on its own." actions={<Button onClick={() => setShow((s) => !s)}><Repeat className="h-4 w-4" /> New commute</Button>} />
      {!isVerifiedDriver(me) && <Notice tone="warn" className="mb-5">Recurring commutes publish automatically, so they need a verified ID, licence and vehicle.</Notice>}
      {show && (
        <form className="card mb-6 grid gap-5 p-5 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-4">
            <RouteBuilder origin={origin} setOrigin={setOrigin} destination={destination} setDestination={setDestination} stops={stops} setStops={setStops} />
            <div>
              <p className="label">Days</p>
              <div className="flex flex-wrap gap-1.5">{WEEKDAYS.map((d, i) => (
                <button type="button" key={d} aria-pressed={days.includes(i)} onClick={() => setDays((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort()))} className={clsx("rounded-lg border px-3 py-1.5 text-sm font-semibold", days.includes(i) ? "border-brand bg-brand-soft text-brand" : "border-line text-muted")}>{d}</button>
              ))}</div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Departure (IST)" htmlFor="rc-t"><Input id="rc-t" type="time" value={clock} onChange={(e) => setClock(e.target.value)} /></Field>
              <Field label="Seats" htmlFor="rc-s"><Select id="rc-s" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
              <Field label="Starts" htmlFor="rc-sd"><Input id="rc-sd" type="date" min={istDate()} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
              <Field label="Ends" htmlFor="rc-ed" optional><Input id="rc-ed" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
            </div>
            <Field label="Vehicle" htmlFor="rc-v"><Select id="rc-v" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.data?.items.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} ({plate(v.plateNumber)})</option>)}</Select></Field>
            <PriceField preview={preview.data} value={price} setValue={setPrice} />
            <Field label="Booking" htmlFor="rc-m"><Select id="rc-m" value={mode} onChange={(e) => setMode(e.target.value as "instant" | "request")}><option value="instant">Instant booking</option><option value="request">Approve each request</option></Select></Field>
            {preview.error && <Notice tone="bad">{errorMessage(preview.error)}</Notice>}
            <Button type="submit" disabled={!origin || !destination || !days.length || !preview.data} loading={create.isPending}>Publish commute</Button>
          </div>
        </form>
      )}
      {rules.isLoading ? <SkeletonList rows={2} /> : rules.data?.items.length ? (
        <div className="space-y-4">
          {rules.data.items.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{r.origin.label} → {r.destination.label}</p>
                  <p className="text-sm text-muted">{r.daysOfWeek.map((d) => WEEKDAYS[d]).join(", ")} at {r.departureTime} · {r.seatsTotal} seats · {rupees(r.pricePerSeatPaise)} · from {fullDate(r.startDate)}{r.endDate && ` to ${fullDate(r.endDate)}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={r.status === "active" ? "good" : r.status === "paused" ? "warn" : "neutral"}>{r.status}</Pill>
                  <DemoTag show={r.isDemo} />
                  {r.status === "active" && <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: r.id, body: { status: "paused" } })}>Pause</Button>}
                  {r.status === "paused" && <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: r.id, body: { status: "active" } })}>Resume</Button>}
                  {r.status !== "ended" && <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: r.id, body: { status: "ended" } })}>End</Button>}
                </div>
              </div>
              {r.skipDates.length > 0 && <p className="mt-2 text-xs text-muted">Skipping: {r.skipDates.map((d) => day(`${d}T06:00:00Z`)).join(", ")}</p>}
              {r.upcoming.length > 0 && (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {r.upcoming.map((u) => (
                    <li key={u.id} className="flex items-center justify-between rounded-xl bg-sunken px-3 py-2 text-sm">
                      <Link to={`/app/drive/rides/${u.id}`} className="font-medium hover:underline">{day(u.departure_at)} {time(u.departure_at)}</Link>
                      <span className="flex items-center gap-2 text-muted">{u.status === "cancelled" ? "skipped" : `${u.seats_available} left`}
                        {u.status === "published" && (
                          skip[u.id] !== undefined ? (
                            <span className="flex gap-1">
                              <input className="input h-8 w-36 text-xs" placeholder="Reason" value={skip[u.id]} onChange={(e) => setSkip({ ...skip, [u.id]: e.target.value })} aria-label="Reason for skipping" />
                              <Button size="sm" variant="danger" disabled={(skip[u.id] || "").trim().length < 3} onClick={() => patch.mutate({ id: r.id, body: { skipDate: u.service_date, reason: skip[u.id] } }, { onSuccess: () => setSkip({ ...skip, [u.id]: undefined as unknown as string }) })}>Skip</Button>
                            </span>
                          ) : <button className="text-xs font-semibold text-bad" onClick={() => setSkip({ ...skip, [u.id]: "" })}>Skip day</button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      ) : <EmptyState icon={<CalendarClock />} title="No recurring commutes" body="Drive the same route most days? Set it up once." />}
    </div>
  );
};

// ---- Vehicles ------------------------------------------------------------------------------------
export const Vehicles = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const vehicles = useVehicles();
  const [form, setForm] = useState({ make: "", model: "", color: "", plateNumber: "", seats: "4", fuelType: "petrol", year: "" });
  const [docs, setDocs] = useState<Record<string, { rc?: string; ins?: string; expiry?: string }>>({});
  const add = useMutation({
    mutationFn: () => api.post("/vehicles", { ...form, seats: Number(form.seats), year: form.year ? Number(form.year) : undefined }),
    onSuccess: () => { setForm({ make: "", model: "", color: "", plateNumber: "", seats: "4", fuelType: "petrol", year: "" }); qc.invalidateQueries({ queryKey: ["vehicles"] }); toast.success("Vehicle added. Upload its documents for review."); },
    onError: (e) => toast.error(e),
  });
  const submit = useMutation({
    mutationFn: (id: string) => api.post(`/vehicles/${id}/verification`, { rcFileId: docs[id].rc, insuranceFileId: docs[id].ins, insuranceExpiry: docs[id].expiry }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); toast.success("Sent for review"); },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/vehicles/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }), onError: (e) => toast.error(e) });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Vehicles" subtitle="Each car needs its registration certificate (RC) and a current insurance policy, reviewed by a person." />
      <div className="space-y-4">
        {vehicles.isLoading ? <SkeletonList rows={1} /> : vehicles.data?.items.map((v) => {
          const st = v.verification.status;
          const d = docs[v.id] || {};
          return (
            <Card key={v.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{v.color} {v.make} {v.model} {v.year && <span className="text-muted">({v.year})</span>}</p>
                  <p className="text-sm text-muted"><span className="font-display tabular">{plate(v.plateNumber)}</span> · {v.seats} passenger seats{v.fuelType && ` · ${v.fuelType}`}</p>
                </div>
                <div className="flex items-center gap-2"><StatusPill map={VERIFICATION_STATUS} value={st} /><DemoTag show={v.isDemo} /><Button variant="ghost" size="sm" onClick={() => remove.mutate(v.id)} aria-label="Remove vehicle"><Trash2 className="h-4 w-4" /></Button></div>
              </div>
              {v.verification.reviewerNotes && <Notice tone="warn" className="mt-3">Reviewer: {v.verification.reviewerNotes}</Notice>}
              {v.verification.insuranceExpiry && st === "verified" && <p className="mt-2 text-sm text-muted">Insurance valid until {fullDate(v.verification.insuranceExpiry)}</p>}
              {["not_submitted", "rejected", "needs_info", "expired"].includes(st) && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <UploadField purpose="vehicle_rc" label="Registration certificate (RC)" onUploaded={(id) => setDocs({ ...docs, [v.id]: { ...d, rc: id } })} />
                  <UploadField purpose="vehicle_insurance" label="Insurance policy" onUploaded={(id) => setDocs({ ...docs, [v.id]: { ...d, ins: id } })} />
                  <Field label="Insurance valid until" htmlFor={`ins-${v.id}`}><Input id={`ins-${v.id}`} type="date" min={istDate()} value={d.expiry || ""} onChange={(e) => setDocs({ ...docs, [v.id]: { ...d, expiry: e.target.value } })} /></Field>
                  <div className="flex items-end"><Button disabled={!d.rc || !d.ins || !d.expiry} loading={submit.isPending} onClick={() => submit.mutate(v.id)}>Submit for review</Button></div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Section title="Add a vehicle" className="mt-8">
        <form className="card grid gap-3 p-5 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Make" htmlFor="v-make"><Input id="v-make" value={form.make} onChange={set("make")} placeholder="Maruti Suzuki" /></Field>
          <Field label="Model" htmlFor="v-model"><Input id="v-model" value={form.model} onChange={set("model")} placeholder="Swift" /></Field>
          <Field label="Colour" htmlFor="v-color"><Input id="v-color" value={form.color} onChange={set("color")} placeholder="White" /></Field>
          <Field label="Registration number" htmlFor="v-plate"><Input id="v-plate" value={form.plateNumber} onChange={set("plateNumber")} placeholder="KA 01 AB 1234" /></Field>
          <Field label="Passenger seats" htmlFor="v-seats"><Select id="v-seats" value={form.seats} onChange={set("seats")}>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n}>{n}</option>)}</Select></Field>
          <Field label="Fuel" htmlFor="v-fuel"><Select id="v-fuel" value={form.fuelType} onChange={set("fuelType")}>{["petrol", "diesel", "cng", "electric", "hybrid"].map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
          <Field label="Year" htmlFor="v-year" optional><Input id="v-year" inputMode="numeric" value={form.year} onChange={set("year")} /></Field>
          <div className="flex items-end sm:col-span-2"><Button type="submit" disabled={!form.make || !form.model || !form.color || !form.plateNumber} loading={add.isPending}>Add vehicle</Button></div>
        </form>
      </Section>
    </div>
  );
};

// ---- Contribution history --------------------------------------------------------------------------
type Contribution = { id: string; status: string; amount_paise: number; driver_share_paise: number; refunded_paise: number; provider: string; captured_at: string; ride_id: string; origin_label: string; destination_label: string; departure_at: string; seats: number };

export const Earnings = () => {
  const q = useQuery({ queryKey: ["driver-summary", "full"], queryFn: () => api.get<{ netPaise: number; payments: number; items: Contribution[] }>("/payments/driver-summary?limit=100") });
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of q.data?.items || []) {
      const k = new Date(c.captured_at).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
      m.set(k, (m.get(k) || 0) + c.driver_share_paise - Math.round((c.refunded_paise * c.driver_share_paise) / Math.max(c.amount_paise, 1)));
    }
    return [...m.entries()];
  }, [q.data]);
  return (
    <div>
      <PageHeader title="Contributions" subtitle="What passengers have contributed towards your trips, after refunds." />
      {q.isLoading ? <SkeletonList /> : q.error ? <ErrorState error={q.error} /> : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Total received" value={rupees(q.data!.netPaise, { free: "₹0" })} />
            <Stat label="Payments" value={q.data!.payments} />
            {byMonth[0] && <Stat label={byMonth[0][0]} value={rupees(byMonth[0][1], { free: "₹0" })} />}
          </div>
          {q.data!.items.length ? (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-3 font-medium">Trip</th><th className="px-4 py-3 font-medium">Paid</th><th className="px-4 py-3 font-medium">Seats</th><th className="px-4 py-3 text-right font-medium">Your share</th></tr></thead>
                <tbody className="divide-y divide-line">{q.data!.items.map((c) => (
                  <tr key={c.id}><td className="px-4 py-3"><Link to={`/app/drive/rides/${c.ride_id}`} className="font-medium hover:underline">{c.origin_label} → {c.destination_label}</Link><span className="block text-xs text-muted">{dateTime(c.departure_at)}{c.provider === "simulated" && " · simulated"}</span></td><td className="px-4 py-3 text-muted">{fullDate(c.captured_at)}</td><td className="px-4 py-3">{c.seats}</td><td className="px-4 py-3 text-right tabular">{rupees(c.driver_share_paise)}{c.refunded_paise > 0 && <span className="block text-xs text-muted">refund {rupees(c.refunded_paise)}</span>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <EmptyState icon={<Wallet />} title="No contributions yet" body="When passengers pay for seats on your rides, they show here." />}
        </>
      )}
    </div>
  );
};
