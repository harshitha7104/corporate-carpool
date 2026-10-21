import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CarFront, LocateFixed, Navigation, Phone, Route, Search, Share2, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlaceInput } from "@/components/PlaceInput";
import { TripTimeline } from "@/components/RideCard";
import { RideMap } from "@/components/RideMap";
import { BOOKING_STATUS, Button, Card, DemoTag, EmptyState, ErrorState, Notice, PageHeader, SkeletonList, StatusPill, Tabs, Toggle, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, day, istDate, relative, rupees, time } from "@/lib/format";
import { useRealtime, useRideChannel } from "@/lib/realtime";
import { useMe, useMeta } from "@/lib/session";
import type { Booking, Place, Ride } from "@/lib/types";

export const BookingRow = ({ b }: { b: Booking }) => (
  <Link to={`/app/bookings/${b.id}`} className="card flex items-center justify-between gap-4 p-4 hover:shadow-lift">
    <div className="min-w-0">
      <p className="text-sm text-muted">{day(b.ride.departureAt)} · {time(b.pickupEtaAt || b.ride.departureAt)}</p>
      <p className="truncate font-semibold">{b.pickup.label} → {b.dropoff.label}</p>
      <p className="truncate text-sm text-muted">with {b.ride.driver.displayName} · {b.seats} seat{b.seats > 1 ? "s" : ""} · {rupees(b.totalPaise)}</p>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      <StatusPill map={BOOKING_STATUS} value={b.status} />
      <DemoTag show={b.isDemo} />
    </div>
  </Link>
);

export const PassengerHome = () => {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const upcoming = useQuery({ queryKey: ["bookings", "upcoming"], queryFn: () => api.get<{ items: Booking[] }>("/bookings/me?scope=upcoming&limit=5") });
  const active = useQuery({ queryKey: ["bookings", "active"], queryFn: () => api.get<{ items: Booking[] }>("/bookings/me?scope=active&limit=3") });
  const pendingReviews = useQuery({ queryKey: ["reviews", "pending"], queryFn: () => api.get<{ items: { booking_id: string; origin_label: string; destination_label: string }[] }>("/reviews/pending") });
  const driving = useQuery({ queryKey: ["driver-rides", "upcoming"], queryFn: () => api.get<{ items: Ride[] }>("/rides/mine?scope=upcoming&limit=3"), enabled: Boolean(me?.roles.includes("driver")) });
  const first = (me?.profile?.fullName || "").split(" ")[0];
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const payDue = upcoming.data?.items.filter((b) => b.status === "ACCEPTED") || [];

  return (
    <div>
      <h1 className="text-2xl font-semibold sm:text-3xl">{greeting}, {first}</h1>
      <p className="mt-1 text-muted">Where are you headed?</p>

      {active.data?.items.map((b) => (
        <Link key={b.id} to={`/app/trips/live/${b.ride.id}`} className="mt-5 flex items-center gap-3 rounded-2xl bg-brand px-5 py-4 text-brand-ink">
          <Navigation className="h-6 w-6" />
          <div className="flex-1">
            <p className="font-semibold">Trip in progress</p>
            <p className="text-sm opacity-90">{b.pickup.label} → {b.dropoff.label}</p>
          </div>
          <span className="font-semibold">Open ›</span>
        </Link>
      ))}

      <form
        className="card mt-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) navigate(`/app/search?${new URLSearchParams({ from: JSON.stringify(from), to: JSON.stringify(to), date: istDate() })}`);
        }}
      >
        <PlaceInput label="From" value={from} onChange={setFrom} />
        <PlaceInput label="To" value={to} onChange={setTo} />
        <div className="flex items-end">
          <Button type="submit" className="w-full" disabled={!from || !to}><Search className="h-4 w-4" /> Search</Button>
        </div>
      </form>

      {payDue.map((b) => (
        <Notice key={b.id} tone="warn" title="Payment needed" className="mt-4">
          Pay {rupees(b.totalPaise)} for {b.pickup.label} → {b.dropoff.label} to confirm your seat. <Link className="font-semibold underline" to={`/app/bookings/${b.id}`}>Pay now</Link>
        </Notice>
      ))}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your upcoming rides</h2>
            <Link to="/app/trips" className="text-sm font-semibold text-brand">All trips</Link>
          </div>
          {upcoming.isLoading ? <SkeletonList rows={2} height="h-20" /> : upcoming.error ? <ErrorState error={upcoming.error} /> : upcoming.data!.items.length ? (
            <div className="space-y-3">{upcoming.data!.items.map((b) => <BookingRow key={b.id} b={b} />)}</div>
          ) : (
            <EmptyState icon={<Route />} title="Nothing booked yet" body="Search your commute to see who's driving your way." />
          )}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{me?.roles.includes("driver") ? "Rides you're driving" : "Have a car?"}</h2>
            {me?.roles.includes("driver") && <Link to="/app/drive" className="text-sm font-semibold text-brand">Driver home</Link>}
          </div>
          {me?.roles.includes("driver") ? (
            driving.data?.items.length ? (
              <div className="space-y-3">
                {driving.data.items.map((r) => (
                  <Link key={r.id} to={`/app/drive/rides/${r.id}`} className="card flex items-center justify-between gap-3 p-4 hover:shadow-lift">
                    <div className="min-w-0">
                      <p className="text-sm text-muted">{dateTime(r.departureAt)}</p>
                      <p className="truncate font-semibold">{r.origin.label} → {r.destination.label}</p>
                      <p className="text-sm text-muted">{r.seatsTotal - r.seatsAvailable} of {r.seatsTotal} seats booked{r.pendingRequests ? ` · ${r.pendingRequests} request${r.pendingRequests > 1 ? "s" : ""}` : ""}</p>
                    </div>
                    <DemoTag show={r.isDemo} />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={<CarFront />} title="No rides published" action={<Link to="/app/drive/new" className="btn-primary btn-sm">Offer a ride</Link>} />
            )
          ) : (
            <Card className="p-5">
              <p className="text-muted">Share the drive you already make and split the cost. Verify your ID, licence and car once to start publishing rides.</p>
              <Link to="/app/drive" className="btn-secondary btn-sm mt-4">Become a driver</Link>
            </Card>
          )}
        </section>
      </div>

      {pendingReviews.data && pendingReviews.data.items.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Rate your recent trips</h2>
          <div className="space-y-2">
            {pendingReviews.data.items.map((r) => (
              <Link key={r.booking_id} to={`/app/bookings/${r.booking_id}`} className="card flex items-center justify-between p-4 hover:shadow-lift">
                <span className="font-medium">{r.origin_label} → {r.destination_label}</span>
                <span className="text-sm font-semibold text-brand">Rate ›</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export const Trips = () => {
  const [tab, setTab] = useState<"pending" | "upcoming" | "active" | "past">("upcoming");
  const q = useQuery({ queryKey: ["bookings", tab], queryFn: () => api.get<{ items: Booking[] }>(`/bookings/me?scope=${tab}&limit=50`) });
  const pending = useQuery({ queryKey: ["bookings", "pending"], queryFn: () => api.get<{ items: Booking[] }>("/bookings/me?scope=pending&limit=50") });
  const empty = {
    pending: ["No pending requests", "Requests waiting for a driver, and seats waiting for payment, show up here."],
    upcoming: ["No upcoming trips", "Book a seat and it will show here."],
    active: ["No trip in progress", "When your driver starts the ride, it appears here with the live trip screen."],
    past: ["No past trips yet", "Completed, cancelled and expired bookings are kept here."],
  }[tab];
  return (
    <div>
      <PageHeader title="My trips" actions={<Link to="/app/search" className="btn-primary btn-sm"><Search className="h-4 w-4" /> Find a ride</Link>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "upcoming", label: "Upcoming" }, { value: "pending", label: "Pending", count: pending.data?.items.length }, { value: "active", label: "Active" }, { value: "past", label: "History" }]} />
      {q.isLoading ? <SkeletonList rows={3} height="h-20" /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : q.data!.items.length ? (
        <div className="space-y-3">
          {q.data!.items.map((b) => (tab === "active" ? (
            <Link key={b.id} to={`/app/trips/live/${b.ride.id}`} className="block"><BookingRow b={b} /></Link>
          ) : <BookingRow key={b.id} b={b} />))}
        </div>
      ) : (
        <EmptyState icon={<Route />} title={empty[0]} body={empty[1]} />
      )}
    </div>
  );
};

type LiveState = { rideId: string; role: "driver" | "passenger"; status: string; locationSharing: boolean; location: { lat: number; lng: number; recordedAt: string; stale: boolean; ageSeconds: number } | null };

// The active trip screen, for the driver and for confirmed passengers.
export const LiveTrip = () => {
  const { rideId = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: meta } = useMeta();
  const ride = useQuery({ queryKey: ["ride", rideId], queryFn: () => api.get<Ride>(`/rides/${rideId}`) });
  const live = useQuery({ queryKey: ["live", rideId], queryFn: () => api.get<LiveState>(`/trips/${rideId}/live`), refetchInterval: 20_000 });
  const [loc, setLoc] = useState<LiveState["location"]>(null);
  const [geoError, setGeoError] = useState("");
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  useRideChannel(rideId);

  useEffect(() => {
    if (live.data?.location) setLoc(live.data.location);
  }, [live.data?.location]);

  useRealtime((event, data, channel) => {
    if (channel !== `ride:${rideId}`) return;
    if (event === "location") {
      const d = data as { lat: number; lng: number; recordedAt: string };
      setLoc({ lat: d.lat, lng: d.lng, recordedAt: d.recordedAt, stale: false, ageSeconds: 0 });
    }
    if (event === "ride.status" || event === "location.sharing" || event === "booking.updated") {
      qc.invalidateQueries({ queryKey: ["live", rideId] });
      qc.invalidateQueries({ queryKey: ["ride", rideId] });
    }
  });

  const isDriver = live.data?.role === "driver";
  const sharing = Boolean(live.data?.locationSharing);

  // Driver: send GPS fixes while sharing is on, at most every 5 seconds.
  useEffect(() => {
    if (!isDriver || !sharing || live.data?.status !== "in_progress") return;
    if (!("geolocation" in navigator)) {
      setGeoError("This browser can't share location.");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - lastSent.current < 5000) return;
        lastSent.current = Date.now();
        api.post(`/trips/${rideId}/location`, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) }).catch(() => {});
        setGeoError("");
      },
      (err) => setGeoError(err.code === err.PERMISSION_DENIED ? "Location permission was denied in the browser." : "Couldn't get a location fix."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [isDriver, sharing, live.data?.status, rideId]);

  const toggleSharing = useMutation({
    mutationFn: (enabled: boolean) => api.put(`/trips/${rideId}/location-sharing`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live", rideId] }),
    onError: (e) => toast.error(e),
  });

  const share = useMutation({
    mutationFn: () => api.post<{ url: string; expiresAt: string }>(`/trips/${rideId}/share`),
    onSuccess: async (s) => {
      try {
        await navigator.clipboard.writeText(s.url);
        toast.success("Trip link copied");
      } catch {
        window.prompt("Copy this trip link", s.url);
      }
    },
    onError: (e) => toast.error(e),
  });

  const sos = useMutation({
    mutationFn: () => api.post<{ contacts: { name: string; status: string }[]; emergency: { number: string } }>("/safety/sos", { rideId, lat: loc?.lat, lng: loc?.lng }),
    onSuccess: (r) => {
      const sent = r.contacts.filter((c) => c.status === "sent").length;
      toast.info(`Support has been alerted. ${r.contacts.length ? `${sent} of ${r.contacts.length} contacts were texted${sent < r.contacts.length ? " (texts aren't delivered in this environment)" : ""}.` : "Add trusted contacts so they're texted next time."} Call ${r.emergency.number} if you're in danger.`);
    },
    onError: (e) => toast.error(e),
  });

  if (ride.isLoading || live.isLoading) return <SkeletonList rows={2} height="h-64" />;
  if (live.error) return <ErrorState error={live.error} />;
  const r = ride.data!;
  const age = loc ? Math.round((Date.now() - new Date(loc.recordedAt).getTime()) / 1000) : null;
  const stale = age !== null && age > 60;

  return (
    <div>
      <PageHeader title={r.status === "in_progress" ? "Trip in progress" : r.status === "completed" ? "Trip completed" : "Trip"} subtitle={`${r.origin.label} → ${r.destination.label}`} back={{ to: isDriver ? `/app/drive/rides/${rideId}` : "/app/trips", label: isDriver ? "Manage ride" : "My trips" }} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <RideMap lines={[{ id: r.id, points: r.route, highlight: true }]} pins={[{ ...r.origin, kind: "origin" }, { ...r.destination, kind: "destination" }]} live={loc ? { ...loc, stale, label: isDriver ? "You" : `${r.vehicle.color} ${r.vehicle.model}` } : null} height={420} estimate={r.routeIsEstimate} />
          <p className="mt-2 text-sm text-muted">
            {loc ? <>Car location updated {relative(loc.recordedAt)}{stale && <span className="font-semibold text-warn"> · may be out of date</span>}</> : sharing ? "Waiting for the first location update…" : "The driver isn't sharing live location for this trip."}
          </p>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <TripTimeline items={[{ time: time(r.departureAt), title: r.origin.label, subtitle: "Start" }, { time: time(r.estArrivalAt), title: r.destination.label, subtitle: `Expected arrival${r.routeIsEstimate ? " (estimate)" : ""}`, tone: "signal" }]} />
          </Card>
          {isDriver && r.status === "in_progress" && (
            <Card className="p-5">
              <Toggle checked={sharing} onChange={(v) => toggleSharing.mutate(v)} label="Share my location" description="Confirmed passengers and anyone with a trip link see the car. Stops automatically when the ride ends." />
              {geoError && <p className="error-text">{geoError}</p>}
              {sharing && <p className="mt-1 flex items-center gap-1.5 text-xs text-good"><LocateFixed className="h-3.5 w-3.5" /> Sending location while this screen is open</p>}
            </Card>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => share.mutate()} loading={share.isPending}><Share2 className="h-4 w-4" /> Share trip</Button>
            <Link to={r.myBooking ? `/app/bookings/${r.myBooking.id}` : `/app/drive/rides/${r.id}`} className="btn-secondary">Details</Link>
          </div>
          <Card className="border-bad/40 p-5">
            <p className="flex items-center gap-2 font-semibold text-bad"><ShieldAlert className="h-5 w-5" /> Need help?</p>
            <p className="mt-1 text-sm text-muted">SOS alerts Green Way staff and texts your trusted contacts. It does not call the police.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="danger" onClick={() => sos.mutate()} loading={sos.isPending}>SOS</Button>
              <a href={`tel:${meta?.safety.emergencyNumber ?? "112"}`} className="btn-secondary"><Phone className="h-4 w-4" /> Call {meta?.safety.emergencyNumber ?? "112"}</a>
            </div>
          </Card>
          <Link to={`/app/safety?report=${rideId}`} className="block text-center text-sm font-semibold text-muted underline">Report an issue with this trip</Link>
        </div>
      </div>
      {r.status === "completed" && <Notice tone="good" className="mt-6">This trip is complete. Location sharing has stopped.</Notice>}
      <DemoTag show={r.isDemo} />
    </div>
  );
};
