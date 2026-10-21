import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, CalendarClock, IndianRupee, Leaf, MessageCircle, PhoneCall, Route, Search, Share2, ShieldCheck, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlaceInput } from "@/components/PlaceInput";
import { RideMap } from "@/components/RideMap";
import { Button, Card, EmptyState, Notice, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, istDate, plate, relative } from "@/lib/format";
import { useMeta } from "@/lib/session";
import type { Place } from "@/lib/types";

const Wrap = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>
);

const Prose = ({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) => (
  <Wrap className="py-12 sm:py-16">
    <div className="max-w-[68ch]">
      <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
      {lead && <p className="mt-3 text-lg text-muted">{lead}</p>}
      <div className="mt-8 space-y-5 leading-relaxed [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:mt-1.5">{children}</div>
    </div>
  </Wrap>
);

const AREAS = ["Whitefield", "Electronic City", "Sarjapur Road", "Outer Ring Road", "Marathahalli", "Bellandur", "HSR Layout", "Koramangala", "Indiranagar", "Hebbal", "Yelahanka", "JP Nagar", "Banashankari", "Manyata Tech Park"];

// An illustrative route (not live data): Whitefield to Manyata via KR Puram.
const SAMPLE_ROUTE: [number, number][] = [[12.9975, 77.6966], [13.0076, 77.695], [13.0262, 77.6627], [13.045, 77.626]];

export const Landing = () => {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [date, setDate] = useState(istDate(1));
  const go = () => {
    if (!from || !to) return;
    const q = new URLSearchParams({ from: JSON.stringify(from), to: JSON.stringify(to), date });
    navigate(`/app/search?${q}`);
  };
  const perKm = meta ? meta.pricing.suggested_paise_per_km / 100 : null;
  return (
    <>
      <section className="border-b border-line bg-surface">
        <Wrap className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="eyebrow text-brand">Carpooling for Bengaluru</p>
            <h1 className="mt-3 text-[40px] font-semibold leading-[1.05] sm:text-[56px]">
              Same road,
              <br />
              shared seats.
            </h1>
            <p className="mt-5 max-w-[46ch] text-lg text-muted">
              Thousands of cars head down Outer Ring Road every morning with empty seats. Green Way matches you with a driver already going your way, and you split the running cost.
            </p>
            <form
              className="card mt-8 grid gap-3 p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                go();
              }}
            >
              <PlaceInput label="Leaving from" value={from} onChange={setFrom} placeholder="e.g. HSR Layout" />
              <PlaceInput label="Going to" value={to} onChange={setTo} placeholder="e.g. Manyata Tech Park" />
              <div>
                <label className="label" htmlFor="hero-date">Date</label>
                <input id="hero-date" type="date" className="input" value={date} min={istDate()} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={!from || !to}>
                  <Search className="h-4 w-4" /> Find rides
                </Button>
              </div>
            </form>
            <p className="mt-3 text-sm text-muted">
              Have a car? <Link to="/app/drive/new" className="font-semibold text-brand hover:underline">Offer your empty seats</Link>
            </p>
          </div>
          <div className="relative">
            <RideMap lines={[{ id: "sample", points: SAMPLE_ROUTE, highlight: true }]} pins={[{ label: "Phoenix Marketcity", lat: 12.9975, lng: 77.6966, kind: "origin" }, { label: "Manyata Tech Park", lat: 13.045, lng: 77.626, kind: "destination" }]} height={420} />
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-line bg-surface/95 p-4 shadow-lift backdrop-blur sm:right-auto sm:w-80">
              <p className="eyebrow">Illustration</p>
              <p className="mt-1 font-semibold">Whitefield → Manyata Tech Park, via KR Puram</p>
              <p className="mt-1 text-sm text-muted">One driver, three passengers picked up along the way. Four cars fewer at Hebbal flyover.</p>
            </div>
          </div>
        </Wrap>
      </section>

      <Wrap className="py-14">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">Riding with Green Way</h2>
            <ol className="mt-6 space-y-5">
              {[
                ["Search your route", "Enter where you start and end. We look for drivers whose route actually passes near both points, in the right direction, not just nearby addresses."],
                ["Book or request a seat", "Some drivers accept bookings instantly; others approve each request. You see which before you book, with the cancellation terms."],
                ["Ride and share the cost", "Pay your agreed contribution in the app. Chat with your driver without sharing your phone number. Rate the trip afterwards."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft font-display font-semibold text-brand">{i + 1}</span>
                  <div>
                    <p className="font-semibold">{t}</p>
                    <p className="text-muted">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">Driving with Green Way</h2>
            <ol className="mt-6 space-y-5">
              {[
                ["Verify once", "Upload your ID, driving licence, RC and insurance. A Green Way reviewer checks them before you can publish rides."],
                ["Publish your commute", "Set your route, stops, departure time and seats, as a one-off trip or a weekday commute that repeats automatically."],
                ["Share costs, not profit", "We suggest a contribution from the distance and cap it, so passengers share fuel and wear rather than paying a fare."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-signal-soft font-display font-semibold text-signal">{i + 1}</span>
                  <div>
                    <p className="font-semibold">{t}</p>
                    <p className="text-muted">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Wrap>

      <section className="border-y border-line bg-surface">
        <Wrap className="grid gap-6 py-12 sm:grid-cols-3">
          {[
            [<IndianRupee key="i" />, "Fair contributions", perKm ? `Suggested at ₹${perKm} per km per seat, with a cap at ${meta?.pricing.max_multiple_of_suggested}× the suggestion. No surge pricing.` : "Suggested from distance, with a cap. No surge pricing."],
            [<CalendarClock key="c" />, "Built for daily commutes", "Drivers publish weekday schedules once; each day's ride appears automatically and can be booked on its own."],
            [<ShieldCheck key="s" />, "Safety you can see", "Document checks by a human reviewer, trip sharing with family, an SOS button, and reports that go to a real support team."],
          ].map(([icon, title, body]) => (
            <div key={String(title)}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-1 text-muted">{body}</p>
            </div>
          ))}
        </Wrap>
      </section>

      <Wrap className="py-14">
        <h2 className="text-2xl font-semibold">Where people share rides</h2>
        <p className="mt-2 text-muted">Green Way launches across Bengaluru{meta ? `, within ${meta.serviceArea.radius_km} km of the city centre` : ""}.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <span key={a} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium">{a}</span>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl bg-brand px-6 py-8 text-brand-ink sm:flex-row sm:items-center">
          <div>
            <p className="font-display text-2xl font-semibold">Tomorrow's commute could be cheaper.</p>
            <p className="mt-1 opacity-90">Sign in with your mobile number. No passwords.</p>
          </div>
          <Link to="/login" className="btn bg-surface text-ink hover:bg-sunken">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Wrap>
    </>
  );
};

export const HowItWorks = () => {
  const { data: meta } = useMeta();
  return (
    <Prose title="How carpooling works" lead="Green Way connects people already travelling the same way. Nobody drives for hire; everybody shares the cost of a trip that was happening anyway.">
      <h2>Finding a ride</h2>
      <p>Search with your starting point, destination and time. Green Way compares your trip with each driver's planned route. A ride only shows up if both your pickup and your drop-off are close to that route, and in the order the car travels. Results are ranked by how much of your trip the route covers, the detour needed, how close the time is, and the contribution. The ranking is explained on the results screen.</p>
      <h2>Booking</h2>
      <p>Drivers choose instant booking or request-to-book. With instant booking your seat is held as soon as you book; you then have {meta?.booking.payment_window_minutes ?? 30} minutes to pay. With request-to-book, the driver has up to {Math.round((meta?.booking.request_expiry_minutes ?? 240) / 60)} hours to accept, and the request expires if they don't. Booking closes {meta?.booking.default_cutoff_minutes ?? 30} minutes before departure unless the driver sets another cutoff.</p>
      <h2>Paying</h2>
      <p>You pay your contribution in the app. A payment only counts once the payment provider confirms it to our servers. You get a receipt for every successful payment.</p>
      <h2>Cancelling</h2>
      <p>Cancel more than {Math.round((meta?.cancellation.free_until_minutes_before ?? 120) / 60)} hours before departure for a full refund. Later than that, {meta?.cancellation.late_refund_percent ?? 50}% is refunded. If the driver cancels, you get {meta?.cancellation.driver_cancel_refund_percent ?? 100}% back.</p>
      <h2>On the day</h2>
      <p>Chat with your driver inside the booking. When the driver starts the ride, they can choose to share the car's location with confirmed passengers. You can share a live trip link with someone you trust.</p>
      <p><Link to="/login" className="font-semibold text-brand">Sign in to find a ride →</Link></p>
    </Prose>
  );
};

export const Benefits = () => (
  <Wrap className="py-12 sm:py-16">
    <h1 className="text-3xl font-semibold sm:text-4xl">Good for riders, good for drivers</h1>
    <div className="mt-10 grid gap-6 md:grid-cols-2">
      <Card className="p-6">
        <Users className="h-7 w-7 text-brand" />
        <h2 className="mt-3 text-xl font-semibold">If you ride</h2>
        <ul className="mt-4 space-y-3 text-muted">
          <li>Pay a share of fuel and running costs instead of a cab fare.</li>
          <li>Pick drivers by verification status, rating and route fit.</li>
          <li>Save your regular trip and see matching rides for the week.</li>
          <li>Women-only rides for passengers whose profile says female, when the driver offers them.</li>
          <li>Message your driver without giving out your number.</li>
        </ul>
      </Card>
      <Card className="p-6">
        <Leaf className="h-7 w-7 text-signal" />
        <h2 className="mt-3 text-xl font-semibold">If you drive</h2>
        <ul className="mt-4 space-y-3 text-muted">
          <li>Recover part of what your daily commute costs you.</li>
          <li>Approve each passenger, or let verified riders book instantly.</li>
          <li>Set up a weekday commute once; skip holidays in one tap.</li>
          <li>Choose your pickup points and stops along your own route.</li>
          <li>See every contribution and refund in one place.</li>
        </ul>
      </Card>
    </div>
    <Notice tone="info" className="mt-8">
      Contributions on Green Way are a share of trip costs and are capped by distance. Green Way is not a taxi or ride-hailing service, and does not claim any transport licence or insurance cover. Drivers remain responsible for their own vehicle insurance and for following the law.
    </Notice>
  </Wrap>
);

export const SafetyCentre = () => {
  const { data: meta } = useMeta();
  return (
    <Prose title="Safety and trust" lead="What we check, what we don't, and what to do if something goes wrong.">
      <Notice tone="bad" title={`In an emergency, call ${meta?.safety.emergencyNumber ?? "112"}`}>
        {meta?.safety.emergencyLabel ?? "India emergency response"}. Green Way support is not an emergency service and cannot dispatch help.
      </Notice>
      <h2>What Green Way checks</h2>
      <ul>
        <li>Phone numbers are confirmed with a one-time code.</li>
        <li>Drivers upload a government ID and their driving licence. A Green Way reviewer looks at each document before the driver can publish rides.</li>
        <li>Vehicles need their registration certificate and a current insurance policy, also reviewed by a person.</li>
      </ul>
      <h2>What we don't claim</h2>
      <ul>
        <li>Document review is not a police or criminal background check.</li>
        <li>A profile photo, rating or account is not proof that someone is safe.</li>
        <li>Location estimates and arrival times are approximate unless the app says otherwise.</li>
      </ul>
      <h2>Tools during a trip</h2>
      <ul>
        <li><strong>Trip sharing:</strong> send a link to family or friends. It shows the car, route and status, and expires after {meta ? "a set number of hours" : "a few hours"}.</li>
        <li><strong>Live location:</strong> drivers choose whether to share location for each trip. It's only shared while the ride is in progress and stops when it ends.</li>
        <li><strong>SOS:</strong> alerts Green Way staff and texts your trusted contacts, and reminds you to call {meta?.safety.emergencyNumber ?? "112"}. The app tells you whether each text was actually sent.</li>
        <li><strong>Reports and blocking:</strong> report a driver or passenger and block them from your searches and bookings.</li>
      </ul>
      <p><Link to="/app/safety" className="font-semibold text-brand">Set up trusted contacts →</Link></p>
    </Prose>
  );
};

const FAQS: [string, string][] = [
  ["Is Green Way a taxi service?", "No. Drivers are commuters making trips they'd make anyway. Passengers contribute to running costs, and contributions are capped by distance."],
  ["How is the contribution calculated?", "We suggest an amount per seat from the route distance. Drivers can set a lower amount, or a higher one up to the cap shown when they publish."],
  ["What happens if my driver doesn't show up?", "Report it from the booking. If you paid, open a dispute within 7 days and the support team reviews it. Driver cancellations are refunded in full automatically."],
  ["Can I book for a friend?", "You can book up to four seats in one booking. Everyone travelling should ideally have their own account."],
  ["Do I have to share my phone number?", "No. Chat inside the booking instead. Your number is never shown to drivers or passengers."],
  ["What does 'ID checked' mean?", "A Green Way reviewer looked at the person's government ID and driving licence. It isn't a background check."],
  ["Can I set up a daily commute?", "Yes. Drivers can publish a recurring weekday commute. Passengers can save a regular route and see matching rides for the week."],
  ["Which areas are covered?", "Bengaluru. Rides must start and end within the service area shown on the home page."],
];

export const Faq = () => (
  <Prose title="Frequently asked questions">
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {FAQS.map(([q, a]) => (
        <details key={q} className="group px-5 py-4">
          <summary className="cursor-pointer list-none font-semibold marker:hidden">
            <span className="flex items-center justify-between gap-4">
              {q}
              <span className="text-muted transition-transform group-open:rotate-45">+</span>
            </span>
          </summary>
          <p className="mt-2 text-muted">{a}</p>
        </details>
      ))}
    </div>
  </Prose>
);

const LegalNotice = () => (
  <Notice tone="warn" title="Draft for the pilot">
    This document describes how the Green Way pilot works today. It has not been reviewed by a lawyer and must be reviewed before public launch.
  </Notice>
);

export const Terms = () => (
  <Prose title="Terms of service">
    <LegalNotice />
    <h2>What Green Way is</h2>
    <p>Green Way is a platform that helps people travelling in the same direction share a car and share its running costs. Green Way does not provide transport and does not employ drivers.</p>
    <h2>Accounts</h2>
    <p>You need a working Indian mobile number or an email address. Keep your account to yourself. We may suspend accounts that break these terms or put others at risk; suspensions are recorded and can be appealed through support.</p>
    <h2>Drivers</h2>
    <ul>
      <li>You must hold a valid driving licence, and your vehicle must be registered and insured.</li>
      <li>Contributions must stay within the cap Green Way shows. You may not use Green Way to run a commercial transport service.</li>
      <li>You are responsible for driving safely and for following traffic and motor-vehicle law.</li>
    </ul>
    <h2>Passengers</h2>
    <ul>
      <li>Be at your pickup point on time. Repeated no-shows can lead to suspension.</li>
      <li>Treat drivers and other passengers with respect.</li>
    </ul>
    <h2>Payments, cancellations and refunds</h2>
    <p>Contributions are paid through Green Way's payment provider. Refunds follow the cancellation policy shown when you book. Disputes can be opened within 7 days of a trip.</p>
    <h2>Liability</h2>
    <p>To the extent the law allows, Green Way is not liable for what happens during a shared trip. This section in particular needs legal review.</p>
  </Prose>
);

export const Privacy = () => (
  <Prose title="Privacy policy">
    <LegalNotice />
    <h2>What we collect</h2>
    <ul>
      <li>Your phone number or email, name, and the profile details you choose to add.</li>
      <li>For drivers: the documents you upload for review, the last four characters of document numbers, and vehicle details.</li>
      <li>Trips you publish and book, messages within bookings, payments and refunds.</li>
      <li>Live location, only from drivers who turn it on for a trip in progress.</li>
    </ul>
    <h2>What others can see</h2>
    <p>Other members see your first name, initials, verification status, ratings and trip history counts. They never see your phone number, email or gender. Passengers with a confirmed seat see the full number plate of the car.</p>
    <h2>How long we keep it</h2>
    <ul>
      <li>Trip locations are deleted after a short retention period (7 days by default).</li>
      <li>When you delete your account, your personal details are removed and your documents are deleted. Records others depend on, such as past bookings and payments, are kept without your personal details.</li>
    </ul>
    <h2>Who we share it with</h2>
    <p>Our payment, SMS and email providers, only to deliver those services, and authorities where the law requires it.</p>
    <h2>Your choices</h2>
    <p>Change notification settings, export or delete your account from your profile, or contact support.</p>
  </Prose>
);

export const Contact = () => (
  <Prose title="Contact and support" lead="We read every message. Signed-in members get the fastest help through a support ticket, which keeps your booking details attached.">
    <Notice tone="bad">In an emergency, call 112. Green Way support cannot dispatch emergency help.</Notice>
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="p-5">
        <MessageCircle className="h-6 w-6 text-brand" />
        <p className="mt-2 font-semibold">Support ticket</p>
        <p className="text-sm text-muted">For bookings, payments, verification or safety questions.</p>
        <Link to="/app/support" className="btn-primary btn-sm mt-4">Open a ticket</Link>
      </Card>
      <Card className="p-5">
        <PhoneCall className="h-6 w-6 text-brand" />
        <p className="mt-2 font-semibold">Email or phone</p>
        <p className="mt-1 text-sm">
          <span className="select-all">harshitha71004@gmail.com</span>
          <br />
          <span className="select-all tabular">+91 88674 76254</span>
        </p>
        <p className="mt-1 text-xs text-muted">Business hours, Monday to Saturday.</p>
      </Card>
    </div>
  </Prose>
);

// Public page behind a trip-share link.
export const SharedTrip = () => {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["share", token],
    queryFn: () => api.get<{
      status: string; origin: string; destination: string; departureAt: string; estArrivalAt: string; route: [number, number][];
      driverFirstName: string; vehicle: { make: string; model: string; color: string; plateNumber: string };
      location: { lat: number; lng: number; recordedAt: string; stale: boolean } | null; linkExpiresAt: string;
      emergency: { number: string; label: string; notice: string };
    }>(`/share/${token}`),
    refetchInterval: 15_000,
  });
  if (q.isLoading) return <Spinner label="Loading the shared trip" />;
  if (q.error) return <Wrap className="py-16"><EmptyState icon={<Share2 />} title="This trip link isn't available" body="It may have expired, been turned off by the person who shared it, or the trip has ended." /></Wrap>;
  const t = q.data!;
  return (
    <Wrap className="py-10">
      <p className="eyebrow">Shared trip</p>
      <h1 className="mt-1 text-2xl font-semibold">{t.origin} → {t.destination}</h1>
      <p className="mt-1 text-muted">Departs {dateTime(t.departureAt)} · expected around {dateTime(t.estArrivalAt)} (estimate)</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <RideMap lines={[{ id: "r", points: t.route, highlight: true }]} live={t.location ? { ...t.location, label: `${t.vehicle.color} ${t.vehicle.model}` } : null} height={380} estimate />
        <div className="space-y-4">
          <Card className="p-5">
            <p className="eyebrow">Status</p>
            <p className="mt-1 text-lg font-semibold">{{ published: "Not started yet", in_progress: "On the way", completed: "Arrived", cancelled: "Cancelled" }[t.status] || t.status}</p>
            {t.location ? (
              <p className="mt-1 text-sm text-muted">Car location updated {relative(t.location.recordedAt)}{t.location.stale && " (it may have moved since)"}</p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t.status === "in_progress" ? "The driver isn't sharing live location for this trip." : "Live location appears here while the trip is in progress, if the driver shares it."}</p>
            )}
          </Card>
          <Card className="p-5">
            <p className="eyebrow">Car</p>
            <p className="mt-1 font-semibold">{t.vehicle.color} {t.vehicle.make} {t.vehicle.model}</p>
            <p className="font-display text-xl tabular">{plate(t.vehicle.plateNumber)}</p>
            <p className="mt-1 text-sm text-muted">Driver: {t.driverFirstName}</p>
          </Card>
          <Notice tone="bad" title={`Emergency: call ${t.emergency.number}`}>{t.emergency.notice}</Notice>
          <p className="text-xs text-muted">This link stops working {dateTime(t.linkExpiresAt)}.</p>
        </div>
      </div>
    </Wrap>
  );
};

export const NotFound = () => (
  <Wrap className="py-20">
    <EmptyState icon={<Route />} title="That page took a wrong turn" body="The link may be old or mistyped." action={<Link to="/" className="btn-primary">Go home</Link>} />
  </Wrap>
);

export const VerifiedBadgeLegend = () => (
  <span className="inline-flex items-center gap-1 text-xs text-muted"><BadgeCheck className="h-4 w-4 text-good" /> ID checked by a reviewer</span>
);

