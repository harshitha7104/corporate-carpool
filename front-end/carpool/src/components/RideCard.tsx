import { BadgeCheck, Briefcase, Leaf, Star, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { duration, km, plate, rupees, time } from "@/lib/format";
import type { PublicProfile, Ride } from "@/lib/types";
import { Avatar, DemoTag, Pill, clsx } from "./ui";

export const DriverLine = ({ driver, compact, asPassenger }: { driver: PublicProfile; compact?: boolean; asPassenger?: boolean }) => {
  const verified = driver.idVerified && driver.licenceVerified;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar initials={driver.initials} size={compact ? 36 : 44} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 font-semibold">
          <span className="truncate">{driver.displayName}</span>
          {verified ? (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-good" title="ID and driving licence checked by Green Way reviewers">
              <BadgeCheck className="h-4 w-4" aria-hidden />
              ID checked
            </span>
          ) : asPassenger ? null : (
            <span className="text-xs text-muted">Not yet verified</span>
          )}
          <DemoTag show={driver.isDemo} />
        </p>
        <p className="text-sm text-muted">
          {driver.rating !== null ? (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-signal text-signal" aria-hidden />
              <span className="font-semibold text-ink">{driver.rating.toFixed(1)}</span>
              <span>({driver.reviewCount} review{driver.reviewCount === 1 ? "" : "s"})</span>
            </span>
          ) : (
            <span>No reviews yet</span>
          )}
          {driver.ridesDriven > 0 && <span> · {driver.ridesDriven} ride{driver.ridesDriven === 1 ? "" : "s"} driven</span>}
        </p>
      </div>
    </div>
  );
};

// A two-stop timeline: where you get in and where you get out.
export const TripTimeline = ({ items }: { items: { time?: string; title: string; subtitle?: string; tone?: "brand" | "signal" | "muted" }[] }) => (
  <ol className="relative space-y-3">
    {items.map((it, i) => (
      <li key={i} className="relative flex gap-3">
        <div className="flex w-[58px] shrink-0 justify-end whitespace-nowrap pt-0.5 text-sm font-semibold tabular">{it.time}</div>
        <div className="relative flex flex-col items-center">
          <span className={clsx("mt-1.5 h-3 w-3 rounded-full border-2 border-surface ring-2", it.tone === "signal" ? "bg-signal ring-signal" : it.tone === "muted" ? "bg-line ring-line" : "bg-brand ring-brand")} />
          {i < items.length - 1 && <span className="absolute top-5 h-[calc(100%+4px)] w-0.5 bg-line" />}
        </div>
        <div className="min-w-0 pb-1">
          <p className="truncate font-medium">{it.title}</p>
          {it.subtitle && <p className="truncate text-xs text-muted">{it.subtitle}</p>}
        </div>
      </li>
    ))}
  </ol>
);

export const RideCard = ({ ride, to, highlight, onHover }: { ride: Ride; to: string; highlight?: boolean; onHover?: (id: string | null) => void }) => {
  const m = ride.match;
  const pickupAt = m?.estimatedPickupAt || ride.departureAt;
  const dropAt = m?.estimatedDropoffAt || ride.estArrivalAt;
  return (
    <Link
      to={to}
      onMouseEnter={() => onHover?.(ride.id)}
      onMouseLeave={() => onHover?.(null)}
      className={clsx("card block p-4 transition-shadow hover:shadow-lift sm:p-5", highlight && "ring-2 ring-brand")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><TripTimeline
          items={[
            { time: time(pickupAt), title: m ? `Pickup ${m.pickupDistanceM < 150 ? "at your point" : `${km(m.pickupDistanceM)} from you`}` : ride.origin.label, subtitle: `Driver starts at ${ride.origin.label}` },
            { time: time(dropAt), title: m ? `Drop-off ${m.dropoffDistanceM < 150 ? "at your point" : `${km(m.dropoffDistanceM)} from you`}` : ride.destination.label, subtitle: `Driver ends at ${ride.destination.label}`, tone: "signal" },
          ]}
        /></div>
        <div className="shrink-0 text-right">
          <p className="font-display text-2xl font-semibold tabular">{rupees(ride.pricePerSeatPaise)}</p>
          <p className="text-xs text-muted">per seat</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {ride.bookingMode === "instant" ? (
          <Pill tone="brand" icon={<Zap className="h-3 w-3" />}>Instant booking</Pill>
        ) : (
          <Pill tone="info">Driver approves requests</Pill>
        )}
        <Pill tone={ride.seatsAvailable <= 1 ? "warn" : "neutral"} icon={<Users className="h-3 w-3" />}>
          {ride.seatsAvailable} of {ride.seatsTotal} seats left
        </Pill>
        {ride.womenOnly && <Pill tone="signal">Women only</Pill>}
        {ride.recurringRuleId && <Pill tone="neutral">Regular commute</Pill>}
        {ride.luggage !== "none" && <Pill tone="neutral" icon={<Briefcase className="h-3 w-3" />}>{ride.luggage} bags</Pill>}
        {ride.vehicle.fuelType === "electric" && <Pill tone="good" icon={<Leaf className="h-3 w-3" />}>Electric</Pill>}
        <DemoTag show={ride.isDemo} />
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <DriverLine driver={ride.driver} compact />
        <div className="text-right text-xs text-muted">
          <p>
            {ride.vehicle.color} {ride.vehicle.make} {ride.vehicle.model} · {plate(ride.vehicle.plateNumber)}
          </p>
          <p>
            {m ? `${km(m.sharedDistanceM)} together · ${m.detourM < 100 ? "no detour" : `about ${km(m.detourM)} detour`}` : `${km(ride.distanceM)} · ${duration(ride.durationS)}`}
            {ride.routeIsEstimate && " (estimates)"}
          </p>
        </div>
      </div>
    </Link>
  );
};
