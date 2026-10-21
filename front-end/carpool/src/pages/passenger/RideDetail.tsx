import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, Car, Heart, Info, MessageSquareText, ShieldAlert, Snowflake, Users, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PlaceInput } from "@/components/PlaceInput";
import { DriverLine, TripTimeline } from "@/components/RideCard";
import { RideMap } from "@/components/RideMap";
import { BOOKING_STATUS, Button, Card, ErrorState, Field, Notice, PageHeader, Pill, Select, SkeletonList, StatusPill, Textarea, useToast } from "@/components/ui";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { day, duration, km, plate, rupees, time } from "@/lib/format";
import { useMeta } from "@/lib/session";
import type { Booking, Place, Ride } from "@/lib/types";

const parsePlace = (s: string | null): Place | null => {
  try {
    const p = s ? JSON.parse(s) : null;
    return p && typeof p.lat === "number" ? p : null;
  } catch {
    return null;
  }
};

const LUGGAGE: Record<string, string> = { none: "No luggage", small: "Small bag or laptop", medium: "Medium bag", large: "Large suitcase" };

export const RideDetail = () => {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: meta } = useMeta();
  const ride = useQuery({ queryKey: ["ride", id], queryFn: () => api.get<Ride>(`/rides/${id}`) });
  const [seats, setSeats] = useState(Number(params.get("seats") || 1));
  const [pickup, setPickup] = useState<Place | null>(parsePlace(params.get("from")));
  const [dropoff, setDropoff] = useState<Place | null>(parsePlace(params.get("to")));
  const [message, setMessage] = useState("");
  const keyRef = useRef(newIdempotencyKey());

  const effectivePickup = pickup || (ride.data ? ride.data.origin : null);
  const effectiveDropoff = dropoff || (ride.data ? ride.data.destination : null);

  const book = useMutation({
    mutationFn: () =>
      api.post<Booking>(`/rides/${id}/bookings`, { seats, pickup: effectivePickup, dropoff: effectiveDropoff, message: message || undefined }, { idempotencyKey: keyRef.current }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(b.status === "REQUESTED" ? "Request sent to the driver" : "Seat held. Complete payment to confirm.");
      navigate(`/app/bookings/${b.id}`);
    },
    onError: () => {
      // A fresh key so a corrected retry is a new attempt.
      keyRef.current = newIdempotencyKey();
    },
  });

  const fav = useMutation({
    mutationFn: () => api.post(`/users/${ride.data!.driver.id}/favourite`),
    onSuccess: () => toast.success("Driver saved to favourites"),
    onError: (e) => toast.error(e),
  });

  const pins = useMemo(() => {
    if (!ride.data) return [];
    const r = ride.data;
    return [
      { ...r.origin, kind: "origin" as const },
      ...r.stops.map((s) => ({ ...s, kind: "stop" as const })),
      { ...r.destination, kind: "destination" as const },
      ...(pickup ? [{ ...pickup, kind: "pickup" as const }] : []),
      ...(dropoff ? [{ ...dropoff, kind: "dropoff" as const }] : []),
    ];
  }, [ride.data, pickup, dropoff]);

  if (ride.isLoading) return <SkeletonList rows={3} height="h-48" />;
  if (ride.error) return <ErrorState error={ride.error} retry={() => ride.refetch()} />;
  const r = ride.data!;
  const contribution = r.pricePerSeatPaise * seats;
  const feePct = meta?.fees.platform_fee_percent || 0;
  const fee = feePct && contribution ? Math.max(meta!.fees.platform_fee_min_paise, Math.round((contribution * feePct) / 100)) : 0;
  const closed = r.status !== "published" || new Date(r.bookingClosesAt) < new Date();
  const free = Math.round((meta?.cancellation.free_until_minutes_before ?? 120) / 60);

  return (
    <div>
      <PageHeader
        back={{ to: params.get("from") ? `/app/search?${new URLSearchParams({ from: params.get("from")!, to: params.get("to") || "", date: r.departureAt.slice(0, 10) })}` : "/app/search", label: "Back to results" }}
        title={`${r.origin.label} → ${r.destination.label}`}
        subtitle={`${day(r.departureAt)} · departs ${time(r.departureAt)} · ${km(r.distanceM)}, about ${duration(r.durationS)}${r.routeIsEstimate ? " (estimate)" : ""}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <RideMap lines={[{ id: r.id, points: r.route, highlight: true }]} pins={pins} height={340} estimate={r.routeIsEstimate} />
          <Card className="p-5">
            <h2 className="mb-4 text-lg font-semibold">Route and stops</h2>
            <TripTimeline
              items={[
                { time: time(r.departureAt), title: r.origin.label, subtitle: "Driver starts here" },
                ...r.stops.map((s) => ({ time: time(new Date(new Date(r.departureAt).getTime() + s.offsetMinutes * 60000)), title: s.label, subtitle: "Planned stop", tone: "muted" as const })),
                { time: time(r.estArrivalAt), title: r.destination.label, subtitle: `Expected arrival${r.routeIsEstimate ? " (estimate)" : ""}`, tone: "signal" as const },
              ]}
            />
          </Card>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <DriverLine driver={r.driver} />
              {!r.isDriver && (
                <Button variant="ghost" size="sm" onClick={() => fav.mutate()} loading={fav.isPending}>
                  <Heart className="h-4 w-4" /> Save driver
                </Button>
              )}
            </div>
            {r.driver.bio && <p className="mt-3 text-muted">{r.driver.bio}</p>}
            <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><Car className="h-4 w-4 text-muted" /><dd className="flex flex-wrap items-center gap-x-1">{r.vehicle.color} {r.vehicle.make} {r.vehicle.model} · <span className="tabular">{plate(r.vehicle.plateNumber)}</span>{r.vehicle.verified && <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-good"><BadgeCheck className="h-4 w-4" aria-hidden /> documents checked</span>}</dd></div>
              <div className="flex gap-2"><Users className="h-4 w-4 text-muted" /><dd>{r.seatsAvailable} of {r.seatsTotal} seats left</dd></div>
              <div className="flex gap-2"><Info className="h-4 w-4 text-muted" /><dd>{LUGGAGE[r.luggage]}</dd></div>
              {Boolean(r.preferences.ac) && <div className="flex gap-2"><Snowflake className="h-4 w-4 text-muted" /><dd>Air conditioning on</dd></div>}
            </dl>
            {!r.vehicle.plateNumber.includes("•") ? null : <p className="mt-2 text-xs text-muted">The full number plate appears once your seat is accepted.</p>}
            {r.notes && <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm"><span className="font-semibold">Driver's note: </span>{r.notes}</p>}
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Cancellation terms</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>Free cancellation up to {free} hours before departure.</li>
              <li>After that, {meta?.cancellation.late_refund_percent ?? 50}% of your contribution is refunded.</li>
              <li>If the driver cancels, you're refunded in full.</li>
              <li>Booking closes {r.bookingCutoffMinutes} minutes before departure.</li>
            </ul>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-3xl font-semibold tabular">{rupees(r.pricePerSeatPaise)}</p>
              <p className="text-sm text-muted">per seat</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.bookingMode === "instant" ? <Pill tone="brand" icon={<Zap className="h-3 w-3" />}>Instant booking</Pill> : <Pill tone="info">Driver approves requests</Pill>}
              {r.womenOnly && <Pill tone="signal">Women only</Pill>}
              {r.recurringRuleId && <Pill icon={<CalendarClock className="h-3 w-3" />}>Regular commute</Pill>}
            </div>

            {r.isDriver ? (
              <div className="mt-5">
                <Notice tone="info">This is your ride.</Notice>
                <Link to={`/app/drive/rides/${r.id}`} className="btn-primary mt-3 w-full">Manage ride</Link>
              </div>
            ) : r.myBooking && ["REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS"].includes(r.myBooking.status) ? (
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-2"><span className="text-sm text-muted">Your booking:</span> <StatusPill map={BOOKING_STATUS} value={r.myBooking.status} /></div>
                <Link to={`/app/bookings/${r.myBooking.id}`} className="btn-primary w-full">View booking</Link>
              </div>
            ) : closed ? (
              <Notice tone="warn" className="mt-5">{r.status === "published" ? "Booking has closed for this ride." : "This ride isn't taking bookings."}</Notice>
            ) : (
              <form
                className="mt-5 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  book.mutate();
                }}
              >
                <Field label="Seats" htmlFor="b-seats">
                  <Select id="b-seats" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                    {Array.from({ length: Math.min(r.seatsAvailable, meta?.booking.max_seats_per_booking ?? 4) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} seat{n > 1 ? "s" : ""}</option>
                    ))}
                  </Select>
                </Field>
                <PlaceInput label="Pickup" value={effectivePickup} onChange={setPickup} />
                <PlaceInput label="Drop-off" value={effectiveDropoff} onChange={setDropoff} />
                <p className="-mt-2 text-xs text-muted">Pickup and drop-off must be near the route, in the direction it travels.</p>
                {r.bookingMode === "request" && (
                  <Field label="Message to the driver" htmlFor="b-msg" optional>
                    <Textarea id="b-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} placeholder="e.g. I'll wait at the bus stop by the main gate." />
                  </Field>
                )}
                <dl className="space-y-1 border-t border-line pt-3 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">Contribution ({seats} × {rupees(r.pricePerSeatPaise)})</dt><dd className="tabular">{rupees(contribution)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Platform fee</dt><dd className="tabular">{fee ? rupees(fee) : "None"}</dd></div>
                  <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular">{rupees(contribution + fee)}</dd></div>
                </dl>
                {book.error && <Notice tone="bad">{errorMessage(book.error)}</Notice>}
                <Button type="submit" className="w-full" loading={book.isPending} disabled={!effectivePickup || !effectiveDropoff}>
                  {r.bookingMode === "instant" ? (contribution ? "Book and pay" : "Book seat") : "Request to book"}
                </Button>
                <p className="text-center text-xs text-muted">
                  {r.bookingMode === "instant" ? `Your seat is held for ${meta?.booking.payment_window_minutes ?? 30} minutes while you pay.` : "You'll only pay after the driver accepts."}
                </p>
              </form>
            )}
          </Card>
          <Link to="/app/safety" className="mt-3 flex items-center gap-2 px-1 text-sm text-muted hover:text-ink">
            <ShieldAlert className="h-4 w-4" /> Safety tools and trusted contacts
          </Link>
          <Link to="/app/messages" className="mt-1 flex items-center gap-2 px-1 text-sm text-muted hover:text-ink">
            <MessageSquareText className="h-4 w-4" /> You can message the driver after booking
          </Link>
        </aside>
      </div>
    </div>
  );
};
