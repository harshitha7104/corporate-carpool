import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CreditCard, Heart, MapPinned, MessageCircle, Repeat, Send, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlaceInput } from "@/components/PlaceInput";
import { DriverLine, RideCard } from "@/components/RideCard";
import { Button, Card, DemoTag, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Pill, SkeletonList, Tabs, clsx, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { WEEKDAYS, dateTime, day, fullDate, relative, rupees, time } from "@/lib/format";
import { useRealtime } from "@/lib/realtime";
import { useMe } from "@/lib/session";
import type { Notification, Place, PublicProfile, Ride } from "@/lib/types";

// ---- Messages -------------------------------------------------------------------------
type Conversation = { id: string; booking_id: string; booking_status: string; origin_label: string; destination_label: string; departure_at: string; other_name: string; last_message: string | null; last_at: string | null; unread: number };

export const Messages = () => {
  const q = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<{ items: Conversation[] }>("/conversations") });
  return (
    <div>
      <PageHeader title="Messages" subtitle="Chats are tied to a booking. Phone numbers are never shared." />
      {q.isLoading ? <SkeletonList rows={4} height="h-16" /> : q.error ? <ErrorState error={q.error} /> : q.data!.items.length ? (
        <ul className="card divide-y divide-line">
          {q.data!.items.map((c) => (
            <li key={c.id}>
              <Link to={`/app/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-sunken">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">{c.other_name.split(" ")[0]} <span className="text-xs font-normal text-muted">· {c.origin_label} → {c.destination_label}, {day(c.departure_at)}</span></p>
                  <p className="truncate text-sm text-muted">{c.last_message || "No messages yet"}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                  {c.last_at && relative(c.last_at)}
                  {c.unread > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-ink">{c.unread}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<MessageCircle />} title="No conversations yet" body="Once you request or book a seat, you can message the driver here." />
      )}
    </div>
  );
};

type Thread = { conversation: { id: string; bookingId: string; bookingStatus: string; open: boolean; title: string }; messages: { id: string; sender_id: string; body: string; created_at: string }[] };

export const MessageThread = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["thread", id], queryFn: () => api.get<Thread>(`/conversations/${id}/messages`) });
  useRealtime((event, data) => {
    if (event === "message" && (data as { conversationId: string }).conversationId === id) qc.invalidateQueries({ queryKey: ["thread", id] });
  });
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [q.data?.messages.length]);
  const send = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/messages`, { text }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["thread", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <SkeletonList rows={4} height="h-12" />;
  if (q.error) return <ErrorState error={q.error} />;
  const t = q.data!;
  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[420px] flex-col">
      <PageHeader back={{ to: "/app/messages", label: "Messages" }} title={t.conversation.title} actions={<Link className="btn-secondary btn-sm" to={`/app/bookings/${t.conversation.bookingId}`}>Booking</Link>} />
      <div className="card flex-1 space-y-2 overflow-y-auto p-4">
        {t.messages.length === 0 && <p className="py-10 text-center text-sm text-muted">Say hello and agree on the exact pickup spot.</p>}
        {t.messages.map((m) => {
          const mine = m.sender_id === me?.id;
          return (
            <div key={m.id} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
              <div className={clsx("max-w-[78%] rounded-2xl px-3.5 py-2", mine ? "rounded-br-md bg-brand text-brand-ink" : "rounded-bl-md bg-sunken")}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={clsx("mt-0.5 text-[11px]", mine ? "opacity-80" : "text-muted")}>{time(m.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {t.conversation.open ? (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
          <Input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Write a message" />
          <Button type="submit" loading={send.isPending} disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      ) : (
        <Notice tone="info" className="mt-3">This conversation has closed because the booking ended more than 7 days ago.</Notice>
      )}
    </div>
  );
};

// ---- Notifications ---------------------------------------------------------------------
const notificationLink = (n: Notification) => {
  if (n.data.conversationId) return `/app/messages/${n.data.conversationId}`;
  if (n.data.ticketId) return `/app/support/${n.data.ticketId}`;
  if (n.type.startsWith("booking.request") || n.type === "booking.instant") return n.data.rideId ? `/app/drive/rides/${n.data.rideId}` : null;
  if (n.data.bookingId) return `/app/bookings/${n.data.bookingId}`;
  if (n.data.rideId) return `/app/rides/${n.data.rideId}`;
  if (n.type === "verification.result") return "/app/profile";
  return null;
};

export const Notifications = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["notifications", "list"], queryFn: () => api.get<{ items: Notification[]; unread: number }>("/notifications?limit=50") });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read", { ids: "all" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const open = async (n: Notification) => {
    if (!n.read_at) await api.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["notifications"] });
    const to = notificationLink(n);
    if (to) navigate(to);
  };
  return (
    <div>
      <PageHeader title="Notifications" actions={q.data?.unread ? <Button variant="secondary" size="sm" onClick={() => readAll.mutate()}>Mark all read</Button> : undefined} />
      {q.isLoading ? <SkeletonList rows={5} height="h-16" /> : q.error ? <ErrorState error={q.error} /> : q.data!.items.length ? (
        <ul className="card divide-y divide-line">
          {q.data!.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => open(n)} className={clsx("flex w-full gap-3 px-4 py-3.5 text-left hover:bg-sunken", !n.read_at && "bg-brand-soft/40")}>
                <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{n.title}</span>
                  <span className="block text-sm text-muted">{n.body}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{relative(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Bell />} title="You're all caught up" body="Booking updates, payments, reminders and verification results will appear here." />
      )}
      <p className="mt-4 text-xs text-muted">Email and SMS copies follow your preferences on the profile page. In this environment they are logged on the server, not delivered.</p>
    </div>
  );
};

// ---- Payments ------------------------------------------------------------------------------
type PaymentRow = { id: string; status: string; amountPaise: number; refundedPaise: number; receiptNumber: string; isSimulated: boolean; createdAt: string; bookingId: string; ride: { originLabel: string; destinationLabel: string; departureAt: string } };

export const Payments = () => {
  const q = useQuery({ queryKey: ["payments"], queryFn: () => api.get<{ items: PaymentRow[] }>("/payments/me?limit=50") });
  return (
    <div>
      <PageHeader title="Payments" subtitle="Every contribution you've paid, with refunds." />
      {q.isLoading ? <SkeletonList rows={4} height="h-16" /> : q.error ? <ErrorState error={q.error} /> : q.data!.items.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr><th className="px-4 py-3 font-medium">Trip</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data!.items.map((p) => (
                <tr key={p.id} className="hover:bg-sunken">
                  <td className="px-4 py-3"><Link to={`/app/payments/${p.id}`} className="font-medium hover:underline">{p.ride.originLabel} → {p.ride.destinationLabel}</Link>{p.isSimulated && <span className="ml-2 text-xs text-muted">simulated</span>}</td>
                  <td className="px-4 py-3 text-muted">{fullDate(p.createdAt)}</td>
                  <td className="px-4 py-3"><Pill tone={p.status === "captured" ? "good" : p.status === "failed" ? "bad" : p.status.includes("refund") ? "info" : "neutral"}>{p.status.replace(/_/g, " ")}</Pill></td>
                  <td className="px-4 py-3 text-right tabular">{rupees(p.amountPaise)}{p.refundedPaise > 0 && <span className="block text-xs text-muted">−{rupees(p.refundedPaise)} refunded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={<CreditCard />} title="No payments yet" body="Payments appear here once a driver accepts your booking and you pay." />
      )}
    </div>
  );
};

type ReceiptData = { id: string; status: string; amountPaise: number; platformFeePaise: number; refundedPaise: number; receiptNumber: string; capturedAt: string; provider: string; simulatedNotice: string | null; refunds: { amount_paise: number; status: string; reason: string; created_at: string }[]; trip: { origin_label: string; destination_label: string; departure_at: string; seats: number; driver_name: string } };

export const ReceiptPage = () => {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["receipt", id], queryFn: () => api.get<ReceiptData>(`/payments/${id}/receipt`) });
  if (q.isLoading) return <SkeletonList rows={1} height="h-80" />;
  if (q.error) return <ErrorState error={q.error} />;
  const r = q.data!;
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader back={{ to: "/app/payments", label: "Payments" }} title="Receipt" actions={<Button variant="secondary" size="sm" onClick={() => window.print()}>Print</Button>} />
      <Card className="p-6">
        {r.simulatedNotice && <Notice tone="warn" className="mb-4">{r.simulatedNotice}</Notice>}
        <p className="eyebrow">Receipt number</p>
        <p className="font-display text-xl font-semibold tabular">{r.receiptNumber}</p>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Trip</dt><dd className="text-right">{r.trip.origin_label} → {r.trip.destination_label}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Travel date</dt><dd>{dateTime(r.trip.departure_at)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Driver</dt><dd>{r.trip.driver_name.split(" ")[0]}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Seats</dt><dd>{r.trip.seats}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Paid on</dt><dd>{fullDate(r.capturedAt)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Contribution</dt><dd className="tabular">{rupees(r.amountPaise - r.platformFeePaise)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Platform fee</dt><dd className="tabular">{r.platformFeePaise ? rupees(r.platformFeePaise) : "None"}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Total paid</dt><dd className="tabular">{rupees(r.amountPaise)}</dd></div>
          {r.refunds.map((f, i) => (
            <div key={i} className="flex justify-between text-muted"><dt>Refund ({f.status}) · {f.reason}</dt><dd className="tabular">−{rupees(f.amount_paise)}</dd></div>
          ))}
        </dl>
        <p className="mt-6 text-xs text-muted">Green Way · cost-sharing contribution. This is not a tax invoice.</p>
      </Card>
    </div>
  );
};

// ---- Reviews -----------------------------------------------------------------------------
type ReviewItem = { rating: number; comment: string | null; created_at: string; reviewer_role: string; reviewer_first_name: string; is_demo: boolean };

export const Reviews = () => {
  const { data: me } = useMe();
  const [tab, setTab] = useState<"about" | "written" | "pending">("about");
  const about = useQuery({ queryKey: ["reviews", "about", me?.id], queryFn: () => api.get<{ summary: { average: number | null; count: number }; items: ReviewItem[] }>(`/users/${me!.id}/reviews?limit=50`), enabled: Boolean(me) });
  const written = useQuery({ queryKey: ["reviews", "written"], queryFn: () => api.get<{ items: { booking_id: string; rating: number; comment: string | null; origin_label: string; destination_label: string; created_at: string }[] }>("/reviews/written?limit=50"), enabled: tab === "written" });
  const pending = useQuery({ queryKey: ["reviews", "pending"], queryFn: () => api.get<{ items: { booking_id: string; origin_label: string; destination_label: string; departure_at: string; review_of: string }[] }>("/reviews/pending") });
  return (
    <div>
      <PageHeader title="Ratings and reviews" />
      <Tabs value={tab} onChange={setTab} options={[{ value: "about", label: "About you" }, { value: "written", label: "You wrote" }, { value: "pending", label: "To review", count: pending.data?.items.length }]} />
      {tab === "about" && (about.isLoading ? <SkeletonList /> : about.data && (
        <>
          <Card className="mb-4 flex items-center gap-4 p-5">
            <Star className="h-8 w-8 fill-signal text-signal" />
            <div>
              <p className="font-display text-2xl font-semibold">{about.data.summary.average !== null ? about.data.summary.average.toFixed(1) : "No rating yet"}</p>
              <p className="text-sm text-muted">{about.data.summary.count} review{about.data.summary.count === 1 ? "" : "s"} from people you've travelled with</p>
            </div>
          </Card>
          {about.data.items.length ? (
            <ul className="space-y-3">
              {about.data.items.map((r, i) => (
                <li key={i} className="card p-4">
                  <p className="flex items-center gap-2 text-sm"><span className="font-semibold">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span> <span className="text-muted">{r.reviewer_first_name}, as {r.reviewer_role} · {relative(r.created_at)}</span> <DemoTag show={r.is_demo} /></p>
                  {r.comment && <p className="mt-1">{r.comment}</p>}
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Star />} title="No reviews yet" body="After a completed trip, the people you travelled with can review you." />}
        </>
      ))}
      {tab === "written" && (written.isLoading ? <SkeletonList /> : written.data?.items.length ? (
        <ul className="space-y-3">{written.data.items.map((r) => (
          <li key={r.booking_id} className="card p-4"><p className="font-semibold">{r.origin_label} → {r.destination_label}</p><p className="text-sm">{"★".repeat(r.rating)} {r.comment && <span className="text-muted">· {r.comment}</span>}</p></li>
        ))}</ul>
      ) : <EmptyState title="You haven't written any reviews" />)}
      {tab === "pending" && (pending.data?.items.length ? (
        <ul className="space-y-2">{pending.data.items.map((r) => (
          <li key={r.booking_id}><Link to={`/app/bookings/${r.booking_id}`} className="card flex justify-between p-4 hover:shadow-lift"><span><span className="font-semibold">{r.origin_label} → {r.destination_label}</span><span className="block text-sm text-muted">{day(r.departure_at)} · review the {r.review_of}</span></span><span className="font-semibold text-brand">Review ›</span></Link></li>
        ))}</ul>
      ) : <EmptyState title="Nothing to review" body="Completed trips from the last 14 days that you haven't reviewed appear here." />)}
    </div>
  );
};

// ---- Saved places --------------------------------------------------------------------------------
export const SavedPlaces = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState("Home");
  const [place, setPlace] = useState<Place | null>(null);
  const q = useQuery({ queryKey: ["saved-places"], queryFn: () => api.get<{ items: (Place & { id: string; address: string })[] }>("/users/me/places") });
  const add = useMutation({
    mutationFn: () => api.post("/users/me/places", { label, address: place!.address || place!.label, lat: place!.lat, lng: place!.lng }),
    onSuccess: () => { setPlace(null); qc.invalidateQueries({ queryKey: ["saved-places"] }); toast.success("Place saved"); },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/users/me/places/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-places"] }) });
  return (
    <div className="max-w-2xl">
      <PageHeader title="Saved places" subtitle="Saved places appear first when you search, so home and office are one tap away." />
      <form className="card grid gap-3 p-4 sm:grid-cols-[140px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label="Name" htmlFor="sp-label"><Input id="sp-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></Field>
        <PlaceInput label="Place" value={place} onChange={setPlace} />
        <div className="flex items-end"><Button type="submit" disabled={!place || !label.trim()} loading={add.isPending}>Save</Button></div>
      </form>
      <div className="mt-5">
        {q.isLoading ? <SkeletonList rows={2} height="h-14" /> : q.data?.items.length ? (
          <ul className="card divide-y divide-line">
            {q.data.items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span><span className="font-semibold">{p.label}</span><span className="block text-sm text-muted">{p.address}</span></span>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(p.id)} aria-label={`Remove ${p.label}`}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<MapPinned />} title="No saved places" body="Add home, office or campus above." />}
      </div>
    </div>
  );
};

// ---- Regular routes and favourite drivers -------------------------------------------------------
type PassengerCommute = { id: string; origin_label: string; destination_label: string; origin_lat: number; origin_lng: number; destination_lat: number; destination_lng: number; days_of_week: number[]; window_start: string; window_end: string };

// Carry the passenger's own points to the ride page so booking uses them.
const rideLinkFor = (rideId: string, c?: PassengerCommute) =>
  c
    ? `/app/rides/${rideId}?${new URLSearchParams({
        from: JSON.stringify({ label: c.origin_label, lat: c.origin_lat, lng: c.origin_lng }),
        to: JSON.stringify({ label: c.destination_label, lat: c.destination_lat, lng: c.destination_lng }),
      })}`
    : `/app/rides/${rideId}`;

export const Commutes = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("09:30");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["passenger-commutes"], queryFn: () => api.get<{ items: PassengerCommute[] }>("/passenger-commutes") });
  const favs = useQuery({ queryKey: ["favourites"], queryFn: () => api.get<{ items: PublicProfile[] }>("/users/me/favourites") });
  const matches = useQuery({ queryKey: ["commute-matches", selected], queryFn: () => api.get<{ days: { date: string; rides: Ride[] }[] }>(`/passenger-commutes/${selected}/matches`), enabled: Boolean(selected) });
  const add = useMutation({
    mutationFn: () => api.post<PassengerCommute>("/passenger-commutes", { origin: from, destination: to, daysOfWeek: days, windowStart: start, windowEnd: end }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["passenger-commutes"] }); setSelected(c.id); setFrom(null); setTo(null); toast.success("Regular route saved"); },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/passenger-commutes/${id}`), onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ["passenger-commutes"] }); } });
  const unfav = useMutation({ mutationFn: (id: string) => api.del(`/users/${id}/favourite`), onSuccess: () => qc.invalidateQueries({ queryKey: ["favourites"] }) });

  return (
    <div>
      <PageHeader title="Regular routes and favourites" subtitle="Save the trip you make every week and see which drivers match it." />
      <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <PlaceInput label="From" value={from} onChange={setFrom} />
        <PlaceInput label="To" value={to} onChange={setTo} />
        <div className="sm:col-span-2">
          <p className="label">Days</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <button type="button" key={d} aria-pressed={days.includes(i)} onClick={() => setDays((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort()))} className={clsx("rounded-lg border px-3 py-1.5 text-sm font-semibold", days.includes(i) ? "border-brand bg-brand-soft text-brand" : "border-line text-muted")}>{d}</button>
            ))}
          </div>
        </div>
        <Field label="Earliest departure" htmlFor="pc-s"><Input id="pc-s" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Latest departure" htmlFor="pc-e"><Input id="pc-e" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={!from || !to || !days.length} loading={add.isPending}><Repeat className="h-4 w-4" /> Save regular route</Button></div>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Your routes</h2>
          {list.data?.items.length ? (
            <ul className="space-y-2">
              {list.data.items.map((c) => (
                <li key={c.id} className={clsx("card cursor-pointer p-4", selected === c.id && "ring-2 ring-brand")} onClick={() => setSelected(c.id)}>
                  <p className="font-semibold">{c.origin_label} → {c.destination_label}</p>
                  <p className="text-sm text-muted">{c.days_of_week.map((d) => WEEKDAYS[d]).join(", ")} · {c.window_start.slice(0, 5)}–{c.window_end.slice(0, 5)}</p>
                  <button className="mt-1 text-xs font-semibold text-bad" onClick={(e) => { e.stopPropagation(); remove.mutate(c.id); }}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Repeat />} title="No regular routes" body="Save one above to see matching rides for the week." />}
          <h2 className="mb-3 mt-8 text-lg font-semibold">Favourite drivers</h2>
          {favs.data?.items.length ? (
            <ul className="space-y-2">{favs.data.items.map((d) => (
              <li key={d.id} className="card flex items-center justify-between gap-2 p-3"><DriverLine driver={d} compact /><Button variant="ghost" size="sm" onClick={() => unfav.mutate(d.id)} aria-label="Remove favourite"><Heart className="h-4 w-4 fill-bad text-bad" /></Button></li>
            ))}</ul>
          ) : <p className="text-sm text-muted">Tap "Save driver" on a ride to keep drivers you liked.</p>}
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Matching rides this week</h2>
          {!selected ? <p className="text-muted">Select a route to see matches.</p> : matches.isLoading ? <SkeletonList rows={3} height="h-40" /> : matches.error ? <ErrorState error={matches.error} /> : (
            <div className="space-y-6">
              {matches.data!.days.map((d) => (
                <div key={d.date}>
                  <p className="eyebrow mb-2">{day(`${d.date}T06:00:00Z`)}</p>
                  {d.rides.length ? <div className="space-y-3">{d.rides.map((r) => <RideCard key={r.id} ride={r} to={rideLinkFor(r.id, list.data?.items.find((c) => c.id === selected))} />)}</div> : <p className="text-sm text-muted">No matching rides yet.</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
