import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, MessageCircle, Navigation, Receipt, Share2, Star } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DriverLine, TripTimeline } from "@/components/RideCard";
import { BOOKING_STATUS, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, Notice, PageHeader, SkeletonList, StatusPill, Textarea, useToast } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/api";
import { dateTime, day, km, plate, relative, rupees, time } from "@/lib/format";
import { useRideChannel } from "@/lib/realtime";
import { useMeta } from "@/lib/session";
import type { Booking } from "@/lib/types";

type Checkout = { payment: { id: string; amountPaise: number; isSimulated: boolean }; checkout: { type: "simulated" | "razorpay"; orderId: string; keyId?: string; amountPaise: number } };

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

const loadRazorpay = () =>
  new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection."));
    document.body.appendChild(s);
  });

const EVENT_LABEL: Record<string, string> = {
  REQUESTED: "Requested", ACCEPTED: "Accepted", CONFIRMED: "Confirmed", IN_PROGRESS: "Picked up", COMPLETED: "Completed",
  REJECTED: "Declined", CANCELLED_BY_PASSENGER: "Cancelled by passenger", CANCELLED_BY_DRIVER: "Cancelled by driver", EXPIRED: "Expired", NO_SHOW: "Marked no-show", DISPUTED: "Disputed",
};

const Stars = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
  <div className="flex gap-1" role="radiogroup" aria-label="Rating">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => onChange(n)} className="rounded p-0.5">
        <Star className={`h-8 w-8 ${n <= value ? "fill-signal text-signal" : "text-line"}`} />
      </button>
    ))}
  </div>
);

export const BookingDetail = () => {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: meta } = useMeta();
  const q = useQuery({ queryKey: ["booking", id], queryFn: () => api.get<Booking>(`/bookings/${id}`), refetchInterval: (query) => (query.state.data?.status === "ACCEPTED" ? 15_000 : false) });
  useRideChannel(q.data?.ride.id, Boolean(q.data && ["CONFIRMED", "IN_PROGRESS"].includes(q.data.status)));
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const payKey = useRef(newIdempotencyKey());

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["booking", id] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
  };

  const startPay = useMutation({
    mutationFn: () => api.post<Checkout>("/payments/checkout", { bookingId: id }, { idempotencyKey: payKey.current }),
    onSuccess: async (c) => {
      if (c.checkout.type === "simulated") return setCheckout(c);
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: c.checkout.keyId,
        order_id: c.checkout.orderId,
        amount: c.checkout.amountPaise,
        currency: "INR",
        name: "Green Way",
        description: "Ride cost contribution",
        handler: async (resp: { razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api.post(`/payments/${c.payment.id}/verify`, { razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature });
            toast.success("Payment confirmed");
          } catch (e) {
            toast.error(e);
          }
          refresh();
        },
      });
      rz.open();
    },
    onError: (e) => toast.error(e),
  });

  const simulate = useMutation({
    mutationFn: (outcome: "success" | "failure") => api.post<{ status: string }>(`/payments/${checkout!.payment.id}/simulate`, { outcome }),
    onSuccess: (p) => {
      setCheckout(null);
      payKey.current = newIdempotencyKey();
      if (p.status === "captured") toast.success("Payment received. Your seat is confirmed.");
      else toast.error(new Error("The simulated payment failed. You can try again."));
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => api.post<{ refund: { amountPaise: number; rule: string } }>(`/bookings/${id}/cancel`, { reason: reason || undefined }),
    onSuccess: (r) => {
      setCancelOpen(false);
      toast.success(r.refund.amountPaise ? `Cancelled. ${rupees(r.refund.amountPaise)} will be refunded (${r.refund.rule}).` : "Booking cancelled.");
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const dispute = useMutation({
    mutationFn: () => api.post(`/bookings/${id}/dispute`, { reason: disputeText }),
    onSuccess: () => {
      setDisputeOpen(false);
      toast.success("Dispute opened. Support will review it.");
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const review = useMutation({
    mutationFn: () => api.post(`/bookings/${id}/review`, { rating, comment: comment || undefined }),
    onSuccess: () => {
      toast.success("Thanks for the review");
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const share = useMutation({
    mutationFn: () => api.post<{ url: string; expiresAt: string }>(`/trips/${q.data!.ride.id}/share`),
    onSuccess: async (s) => {
      try {
        await navigator.clipboard.writeText(s.url);
        toast.success(`Trip link copied. It works until ${dateTime(s.expiresAt)}.`);
      } catch {
        window.prompt("Copy this trip link", s.url);
      }
    },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading) return <SkeletonList rows={3} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const b = q.data!;
  const isPassenger = b.viewerRole === "passenger";
  const cancellable = isPassenger && ["REQUESTED", "ACCEPTED", "CONFIRMED"].includes(b.status) && b.ride.status !== "in_progress";
  const minutesToGo = (new Date(b.ride.departureAt).getTime() - Date.now()) / 60000;
  const freeUntil = meta?.cancellation.free_until_minutes_before ?? 120;
  const paid = b.payment && ["captured", "partially_refunded"].includes(b.payment.status) ? b.payment.amountPaise - b.payment.refundedPaise : 0;
  const expectedRefund = paid ? (minutesToGo >= freeUntil ? paid : Math.round((paid * (meta?.cancellation.late_refund_percent ?? 50)) / 100)) : 0;
  const disputable = ["IN_PROGRESS", "COMPLETED", "NO_SHOW"].includes(b.status);

  return (
    <div>
      <PageHeader back={{ to: isPassenger ? "/app/trips" : `/app/drive/rides/${b.ride.id}`, label: isPassenger ? "My trips" : "Manage ride" }} title={`${b.ride.origin} → ${b.ride.destination}`} subtitle={`${day(b.ride.departureAt)} · ${b.seats} seat${b.seats > 1 ? "s" : ""}`} actions={<StatusPill map={BOOKING_STATUS} value={b.status} />} />

      {b.status === "ACCEPTED" && isPassenger && (
        <Notice tone="warn" title="Pay to confirm your seat" className="mb-5">
          Your seat is held until {b.expiresAt ? time(b.expiresAt) : "shortly before departure"}. If payment isn't completed by then, the seat is released.
        </Notice>
      )}
      {b.status === "REQUESTED" && isPassenger && (
        <Notice tone="info" title="Waiting for the driver" className="mb-5">
          You'll be notified when they respond. {b.expiresAt && `The request expires at ${time(b.expiresAt)} if they don't.`} You won't be charged until they accept.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card className="p-5">
            <TripTimeline
              items={[
                { time: b.pickupEtaAt ? time(b.pickupEtaAt) : time(b.ride.departureAt), title: b.pickup.label, subtitle: `Your pickup${b.pickupEtaAt ? " (estimated time)" : ""}` },
                { time: time(b.ride.estArrivalAt), title: b.dropoff.label, subtitle: "Your drop-off", tone: "signal" },
              ]}
            />
            {b.detourM ? <p className="mt-3 text-xs text-muted">About {km(b.detourM)} of extra driving for your pickup and drop-off (estimate).</p> : null}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-lg font-semibold">{isPassenger ? "Your driver" : "Passenger"}</h2>
            {isPassenger ? <DriverLine driver={b.ride.driver} /> : b.passenger && <DriverLine driver={b.passenger} asPassenger />}
            {b.ride.vehicle && (
              <p className="mt-3 text-sm">
                {b.ride.vehicle.color} {b.ride.vehicle.make} {b.ride.vehicle.model}
                {b.ride.vehicle.plateNumber ? <span className="ml-2 rounded-md bg-sunken px-2 py-0.5 font-display font-semibold tabular">{plate(b.ride.vehicle.plateNumber)}</span> : <span className="ml-1 text-muted">· plate shown once accepted</span>}
              </p>
            )}
            {b.message && <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm"><span className="font-semibold">Message: </span>{b.message}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {b.conversationId && <Link className="btn-secondary btn-sm" to={`/app/messages/${b.conversationId}`}><MessageCircle className="h-4 w-4" /> Message</Link>}
              {["CONFIRMED", "IN_PROGRESS"].includes(b.status) && (
                <>
                  <Link className="btn-secondary btn-sm" to={`/app/trips/live/${b.ride.id}`}><Navigation className="h-4 w-4" /> Trip screen</Link>
                  <Button variant="secondary" size="sm" onClick={() => share.mutate()} loading={share.isPending}><Share2 className="h-4 w-4" /> Share trip</Button>
                </>
              )}
            </div>
          </Card>

          {b.status === "COMPLETED" && !b.myReview && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold">How was the trip?</h2>
              <p className="text-sm text-muted">Reviews help everyone choose who to ride with. Only completed trips can be reviewed.</p>
              <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); review.mutate(); }}>
                <Stars value={rating} onChange={setRating} />
                <Field label="Comment" htmlFor="rv-c" optional>
                  <Textarea id="rv-c" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                </Field>
                <Button type="submit" disabled={!rating} loading={review.isPending}>Submit review</Button>
              </form>
            </Card>
          )}
          {b.myReview && <Notice tone="good">You rated this trip {b.myReview.rating} out of 5{b.myReview.comment ? `: "${b.myReview.comment}"` : "."}</Notice>}

          <Card className="p-5">
            <h2 className="mb-3 text-lg font-semibold">History</h2>
            <ol className="space-y-2 text-sm">
              {b.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>
                    <span className="font-medium">{EVENT_LABEL[e.to_status] || e.to_status}</span>
                    <span className="text-muted"> · by {e.actor_role}</span>
                    {e.reason && <span className="block text-muted">{e.reason}</span>}
                  </span>
                  <span className="shrink-0 text-muted">{relative(e.created_at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Payment</h2>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Contribution</dt><dd className="tabular">{rupees(b.contributionPaise)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Platform fee</dt><dd className="tabular">{b.platformFeePaise ? rupees(b.platformFeePaise) : "None"}</dd></div>
              <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular">{rupees(b.totalPaise)}</dd></div>
            </dl>
            {b.payment && (
              <p className="mt-3 text-sm">
                Status: <span className="font-semibold">{b.payment.status.replace(/_/g, " ")}</span>
                {b.payment.refundedPaise > 0 && <span className="text-muted"> · {rupees(b.payment.refundedPaise)} refunded</span>}
                {b.payment.isSimulated && <span className="block text-xs text-muted">Simulated payment. No real money moved.</span>}
              </p>
            )}
            {isPassenger && b.status === "ACCEPTED" && b.totalPaise > 0 && (
              <Button className="mt-4 w-full" onClick={() => startPay.mutate()} loading={startPay.isPending}><CreditCard className="h-4 w-4" /> Pay {rupees(b.totalPaise)}</Button>
            )}
            {b.payment && ["captured", "refunded", "partially_refunded"].includes(b.payment.status) && (
              <Link to={`/app/payments/${b.payment.id}`} className="btn-secondary btn-sm mt-3 w-full"><Receipt className="h-4 w-4" /> Receipt</Link>
            )}
          </Card>
          {cancellable && (
            <Button variant="secondary" className="w-full" onClick={() => setCancelOpen(true)}>Cancel booking</Button>
          )}
          {disputable && (
            <button className="w-full text-sm font-semibold text-muted underline hover:text-ink" onClick={() => setDisputeOpen(true)}>Something went wrong? Open a dispute</button>
          )}
          {b.isDemo && <p className="text-center text-xs text-muted">This booking is fictional demo data.</p>}
        </aside>
      </div>

      <Dialog open={Boolean(checkout)} onClose={() => setCheckout(null)} title="Simulated checkout">
        <div className="space-y-4">
          <Notice tone="warn" title="No real money moves">This development payment page stands in for the payment provider. Choose an outcome to see how Green Way handles it.</Notice>
          <p className="font-display text-3xl font-semibold tabular">{rupees(checkout?.payment.amountPaise)}</p>
          <p className="text-sm text-muted">Order {checkout?.checkout.orderId}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={() => simulate.mutate("success")} loading={simulate.isPending && simulate.variables === "success"}>Pay (simulated)</Button>
            <Button variant="secondary" onClick={() => simulate.mutate("failure")} loading={simulate.isPending && simulate.variables === "failure"}>Simulate a failure</Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => cancel.mutate(reason)}
        busy={cancel.isPending}
        title="Cancel this booking?"
        danger
        confirmLabel="Cancel booking"
        reasonLabel="Reason for the driver"
        body={paid ? <>You paid {rupees(paid)}. Cancelling now refunds <strong className="text-ink">{rupees(expectedRefund)}</strong>{minutesToGo >= freeUntil ? " (free cancellation window)." : ` (${meta?.cancellation.late_refund_percent ?? 50}% within ${Math.round(freeUntil / 60)} hours of departure).`}</> : "You haven't paid anything, so there's nothing to refund."}
      />

      <Dialog open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Open a dispute" footer={<><Button variant="secondary" onClick={() => setDisputeOpen(false)}>Close</Button><Button onClick={() => dispute.mutate()} disabled={disputeText.trim().length < 10} loading={dispute.isPending}>Send to support</Button></>}>
        <p className="mb-3 text-sm text-muted">A support agent reviews disputes and can issue refunds. The other person is told a dispute was opened.</p>
        <Field label="What happened?" htmlFor="dsp">
          <Textarea id="dsp" rows={5} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} maxLength={1000} />
        </Field>
      </Dialog>
    </div>
  );
};
