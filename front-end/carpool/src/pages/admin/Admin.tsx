import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Download, ExternalLink, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import {
  BOOKING_STATUS, Button, Card, ConfirmDialog, DemoTag, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Pill, RIDE_STATUS,
  Section, Select, SkeletonList, Stat, StatusPill, Tabs, Textarea, VERIFICATION_STATUS, clsx, useToast,
} from "@/components/ui";
import { api, errorMessage, qs } from "@/lib/api";
import { dateTime, fullDate, istDate, maskPhone, relative, rupees } from "@/lib/format";
import { can, useMe } from "@/lib/session";
import { TicketStatus } from "../passenger/Profile";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// Generic table for operational lists.
const Table = ({ rows, cols, empty = "Nothing here." }: { rows: Row[] | undefined; cols: { key: string; label: string; render?: (r: Row) => ReactNode; className?: string }[]; empty?: string }) => {
  if (!rows) return <SkeletonList rows={3} height="h-12" />;
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-line text-left text-muted">
          <tr>{cols.map((c) => <th key={c.key} className={clsx("px-4 py-3 font-medium", c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={s(r.id) || i} className="align-top hover:bg-sunken">{cols.map((c) => <td key={c.key} className={clsx("px-4 py-3", c.className)}>{c.render ? c.render(r) : s(r[c.key])}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
};

const NAV: [string, string, string][] = [
  ["/admin", "Overview", "admin.metrics.read"], ["/admin/users", "Users", "admin.users.read"], ["/admin/verifications", "Verification", "admin.verifications.review"],
  ["/admin/rides", "Rides", "admin.rides.read"], ["/admin/bookings", "Bookings & disputes", "admin.bookings.read"], ["/admin/safety", "Safety", "admin.safety.manage"],
  ["/admin/payments", "Payments", "admin.payments.read"], ["/admin/config", "Configuration", "admin.config.manage"], ["/admin/audit", "Audit log", "admin.audit.read"],
  ["/admin/analytics", "Analytics & exports", "admin.exports.run"], ["/admin/health", "System health", "admin.health.read"],
];

export const AdminLayout = () => {
  const { data: me } = useMe();
  return (
    <div>
      <p className="eyebrow mb-2">Admin console</p>
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-sunken p-1" aria-label="Admin sections">
        {NAV.filter(([, , p]) => can(me, p)).map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/admin"} className={({ isActive }) => clsx("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold", isActive ? "bg-surface shadow-card" : "text-muted hover:text-ink")}>{label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
};

// ---- Overview / metrics ---------------------------------------------------------------------------
type Metrics = {
  window: { from: string; to: string; includeDemo: boolean };
  registeredUsers: number; activeUsers: number; verifiedDrivers: number; ridesPublished: number; ridesCompleted: number; bookingRequests: number;
  acceptanceRate: { value: number | null; accepted: number; decided: number };
  cancellationRate: { value: number | null; byPassenger: number; byDriver: number; base: number };
  searchToBooking: { value: number | null; searches: number; requests: number };
  seatUtilisation: { value: number | null; seatsUsed: number; seatsOffered: number; averageSeatsPerRide: number | null };
  recurringAdoption: { value: number | null; fromCommutes: number; activeRules: number };
  contributionVolume: { capturedPaise: number; refundedPaise: number; netPaise: number; platformFeesPaise: number };
  safety: { reports: number; serious: number; open: number };
  support: { opened: number; resolved: number };
  paymentFailures: { value: number | null; failed: number; attempts: number };
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);

const useWindow = () => {
  const [from, setFrom] = useState(istDate(-30));
  const [to, setTo] = useState(istDate());
  const [demo, setDemo] = useState(false);
  const controls = (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <Field label="From" htmlFor="mw-f"><Input id="mw-f" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To" htmlFor="mw-t"><Input id="mw-t" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      <label className="flex items-center gap-2 pb-3 text-sm font-medium"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Include demo data</label>
    </div>
  );
  return { from, to, demo, controls, params: qs({ from, to, includeDemo: demo }) };
};

export const AdminOverview = () => {
  const w = useWindow();
  const q = useQuery({ queryKey: ["metrics", w.params], queryFn: () => api.get<Metrics>(`/admin/metrics${w.params}`) });
  const m = q.data;
  return (
    <div>
      <PageHeader title="Operations overview" subtitle="Database-backed metrics for the selected window (Asia/Kolkata). Demo data is excluded unless you include it." />
      {w.controls}
      {q.error && <ErrorState error={q.error} />}
      {!m ? <SkeletonList rows={2} height="h-24" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="New users" value={m.registeredUsers} hint={`${m.activeUsers} active in total`} />
            <Stat label="Verified drivers" value={m.verifiedDrivers} hint="ID and licence currently verified" />
            <Stat label="Rides published" value={m.ridesPublished} hint={`${m.ridesCompleted} completed`} />
            <Stat label="Booking requests" value={m.bookingRequests} />
            <Stat label="Acceptance rate" value={pct(m.acceptanceRate.value)} hint={`${m.acceptanceRate.accepted} of ${m.acceptanceRate.decided} decided requests`} />
            <Stat label="Cancellation rate" value={pct(m.cancellationRate.value)} hint={`${m.cancellationRate.byPassenger} by passengers, ${m.cancellationRate.byDriver} by drivers`} />
            <Stat label="Search to booking" value={pct(m.searchToBooking.value)} hint={`${m.searchToBooking.requests} requests from ${m.searchToBooking.searches} searches`} />
            <Stat label="Seat utilisation" value={pct(m.seatUtilisation.value)} hint={`avg ${m.seatUtilisation.averageSeatsPerRide ?? "—"} seats per completed ride`} />
            <Stat label="Recurring adoption" value={pct(m.recurringAdoption.value)} hint={`${m.recurringAdoption.activeRules} active commute rules`} />
            <Stat label="Contributions (net)" value={rupees(m.contributionVolume.netPaise, { free: "₹0" })} hint={`${rupees(m.contributionVolume.refundedPaise, { free: "₹0" })} refunded`} />
            <Stat label="Safety reports" value={m.safety.reports} hint={`${m.safety.serious} serious · ${m.safety.open} open`} />
            <Stat label="Payment failures" value={pct(m.paymentFailures.value)} hint={`${m.paymentFailures.failed} of ${m.paymentFailures.attempts} attempts`} />
          </div>
          <details className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">Metric definitions</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Acceptance rate: request-to-book requests made in the window that a driver accepted, divided by those the driver accepted, declined or let expire. Instant bookings and passenger withdrawals are excluded.</li>
              <li>Cancellation rate: bookings that reached "accepted" and were later cancelled by either side, divided by all bookings in the window that reached "accepted".</li>
              <li>Search to booking: booking requests divided by searches, both in the window.</li>
              <li>Seat utilisation: completed-booking seats divided by seats offered, over rides completed in the window.</li>
              <li>Recurring adoption: share of rides published in the window that came from a recurring commute.</li>
              <li>Contributions: payments captured in the window, minus refunds on those payments.</li>
              <li>Full definitions: docs/metrics.md.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
};

// ---- Users -----------------------------------------------------------------------------------------
export const AdminUsers = () => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const list = useQuery({ queryKey: ["admin-users", q, status, role], queryFn: () => api.get<{ items: Row[] }>(`/admin/users${qs({ q, status, role, limit: 50 })}`) });
  return (
    <div>
      <PageHeader title="Users" />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input aria-label="Search users" className="pl-9" placeholder="Name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["active", "suspended", "deactivated", "deleted"].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select aria-label="Role" className="w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Any role</option>{["passenger", "driver", "support", "admin"].map((x) => <option key={x}>{x}</option>)}</Select>
      </div>
      <Table rows={list.data?.items} empty="No users match." cols={[
        { key: "full_name", label: "Name", render: (r) => <Link to={`/admin/users/${r.id}`} className="font-semibold hover:underline">{s(r.full_name) || "No name yet"}</Link> },
        { key: "contact", label: "Contact", render: (r) => <span className="tabular text-muted">{r.phone ? maskPhone(s(r.phone)) : s(r.email)}</span> },
        { key: "roles", label: "Roles", render: (r) => (r.roles as string[] | null || []).join(", ") },
        { key: "status", label: "Status", render: (r) => <><Pill tone={r.status === "active" ? "good" : r.status === "suspended" ? "bad" : "neutral"}>{s(r.status)}</Pill> <DemoTag show={Boolean(r.is_demo)} /></> },
        { key: "reports_against", label: "Reports", render: (r) => (Number(r.reports_against) ? <Pill tone="warn">{s(r.reports_against)}</Pill> : "0") },
        { key: "created_at", label: "Joined", render: (r) => fullDate(s(r.created_at)) },
      ]} />
    </div>
  );
};

type UserDetail = { id: string; phone: string | null; email: string | null; status: string; statusReason: string | null; isDemo: boolean; createdAt: string; fullName: string | null; homeArea: string | null; workArea: string | null; roles: string[]; verification: Record<string, { status: string }>; vehicles: Row[]; rides: Row[]; bookings: Row[]; reports: Row[]; activeSessions: number };

export const AdminUserDetail = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"suspended" | "active" | null>(null);
  const q = useQuery({ queryKey: ["admin-user", id], queryFn: () => api.get<UserDetail>(`/admin/users/${id}`) });
  const setStatus = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason: string }) => api.patch(`/admin/users/${id}/status`, { status, reason }),
    onSuccess: () => { setConfirm(null); qc.invalidateQueries({ queryKey: ["admin-user", id] }); toast.success("Status updated and recorded in the audit log"); },
    onError: (e) => toast.error(e),
  });
  const role = useMutation({ mutationFn: (b: { role: string; grant: boolean }) => api.post(`/admin/users/${id}/roles`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-user", id] }), onError: (e) => toast.error(e) });
  if (q.isLoading) return <SkeletonList />;
  if (q.error) return <ErrorState error={q.error} />;
  const u = q.data!;
  return (
    <div>
      <PageHeader back={{ to: "/admin/users", label: "Users" }} title={u.fullName || "No name yet"} subtitle={`${u.phone || u.email} · joined ${fullDate(u.createdAt)} · ${u.activeSessions} active session${u.activeSessions === 1 ? "" : "s"}`} actions={<><Pill tone={u.status === "active" ? "good" : "bad"}>{u.status}</Pill><DemoTag show={u.isDemo} /></>} />
      <Notice tone="info" className="mb-5">Opening this page was recorded in the audit log.</Notice>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Account</h2>
          {u.statusReason && <p className="mt-1 text-sm text-muted">Status reason: {u.statusReason}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {u.status === "active" && can(me, "admin.users.manage") && <Button variant="danger" size="sm" onClick={() => setConfirm("suspended")}>Suspend</Button>}
            {u.status === "suspended" && can(me, "admin.users.manage") && <Button size="sm" onClick={() => setConfirm("active")}>Reinstate</Button>}
          </div>
          <h3 className="mt-5 text-sm font-semibold">Roles</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["driver", "support", "admin"] as const).map((r) => {
              const has = u.roles.includes(r);
              return <Button key={r} size="sm" variant={has ? "secondary" : "ghost"} disabled={!can(me, "admin.roles.manage")} onClick={() => role.mutate({ role: r, grant: !has })}>{has ? `Remove ${r}` : `Grant ${r}`}</Button>;
            })}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Verification</h2>
          <ul className="mt-2 space-y-1.5 text-sm">{Object.entries(u.verification).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k.replace(/_/g, " ")}</span><StatusPill map={VERIFICATION_STATUS} value={v.status} /></li>)}</ul>
          <h3 className="mt-4 text-sm font-semibold">Vehicles</h3>
          <ul className="mt-1 text-sm text-muted">{u.vehicles.length ? u.vehicles.map((v) => <li key={s(v.id)}>{s(v.make)} {s(v.model)} · {s(v.plate_number)}{v.deleted_at ? " (removed)" : ""}</li>) : <li>None</li>}</ul>
        </Card>
      </div>
      <Section title="Recent rides driven" className="mt-6"><Table rows={u.rides} empty="No rides." cols={[{ key: "route", label: "Route", render: (r) => `${s(r.origin_label)} → ${s(r.destination_label)}` }, { key: "departure_at", label: "Departure", render: (r) => dateTime(s(r.departure_at)) }, { key: "status", label: "Status", render: (r) => <StatusPill map={RIDE_STATUS} value={s(r.status)} /> }]} /></Section>
      <Section title="Recent bookings"><Table rows={u.bookings} empty="No bookings." cols={[{ key: "route", label: "Route", render: (r) => `${s(r.origin_label)} → ${s(r.destination_label)}` }, { key: "departure_at", label: "Departure", render: (r) => dateTime(s(r.departure_at)) }, { key: "status", label: "Status", render: (r) => <StatusPill map={BOOKING_STATUS} value={s(r.status)} /> }, { key: "total_paise", label: "Total", render: (r) => rupees(Number(r.total_paise)) }]} /></Section>
      <Section title="Safety reports involving this user"><Table rows={u.reports} empty="None." cols={[{ key: "category", label: "Category" }, { key: "severity", label: "Severity" }, { key: "status", label: "Status" }, { key: "filed_by_user", label: "Filed by them", render: (r) => (r.filed_by_user ? "Yes" : "No") }, { key: "created_at", label: "When", render: (r) => relative(s(r.created_at)) }]} /></Section>
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} danger={confirm === "suspended"} reasonRequired reasonLabel="Reason (recorded in the audit log)" busy={setStatus.isPending}
        title={confirm === "suspended" ? "Suspend this account?" : "Reinstate this account?"} confirmLabel={confirm === "suspended" ? "Suspend" : "Reinstate"}
        body={confirm === "suspended" ? "They are signed out everywhere and their open rides stop taking bookings. Existing bookings stay for staff to handle." : "They can sign in and use Green Way again."}
        onConfirm={(reason) => setStatus.mutate({ status: confirm!, reason })} />
    </div>
  );
};

// ---- Verification queue ---------------------------------------------------------------------------
export const AdminVerifications = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<"identity" | "vehicle">("identity");
  const [status, setStatus] = useState("pending_review");
  const [decision, setDecision] = useState<{ id: string; kind: "verified" | "rejected" | "needs_info" } | null>(null);
  const q = useQuery({ queryKey: ["admin-verifications", type, status], queryFn: () => api.get<{ items: Row[] }>(`/admin/verifications${qs({ type, status })}`) });
  const open = async (fileId: string) => {
    try {
      const r = await api.get<{ url: string }>(`/files/${fileId}/link`);
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e);
    }
  };
  const decide = useMutation({
    mutationFn: (notes: string) => api.post(`/admin/verifications/${type}/${decision!.id}/decision`, { decision: decision!.kind, notes: notes || undefined }),
    onSuccess: () => { setDecision(null); qc.invalidateQueries({ queryKey: ["admin-verifications"] }); toast.success("Decision recorded and the member notified"); },
    onError: (e) => toast.error(e),
  });
  return (
    <div>
      <PageHeader title="Verification queue" subtitle="Check that the document is legible, current, matches the name, and that the last four characters match." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={type} onChange={setType} options={[{ value: "identity", label: "ID and licences" }, { value: "vehicle", label: "Vehicles" }]} />
        <Select aria-label="Status" className="mb-5 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(VERIFICATION_STATUS).filter(([k]) => !["not_submitted", "expired"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
      </div>
      {q.isLoading ? <SkeletonList /> : q.data?.items.length ? (
        <div className="space-y-3">
          {q.data.items.map((r) => (
            <Card key={s(r.id)} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{type === "identity" ? s(r.user_name) : s(r.owner_name)}</p>
                  <p className="text-sm text-muted">
                    {type === "identity" ? `${s(r.kind).replace(/_/g, " ")} · ${s(r.document_type).replace(/_/g, " ")} ending ${s(r.document_last4)}${r.expires_at ? ` · valid to ${fullDate(s(r.expires_at))}` : ""}` : `${s(r.color)} ${s(r.make)} ${s(r.model)} · ${s(r.plate_number)} · ${s(r.seats)} seats · insurance to ${fullDate(s(r.insurance_expiry))}`}
                  </p>
                  <p className="text-xs text-muted">Submitted {relative(s(r.submitted_at))}</p>
                  {Boolean(r.reviewer_notes) && <p className="mt-1 text-sm">Notes: {s(r.reviewer_notes)}</p>}
                </div>
                <StatusPill map={VERIFICATION_STATUS} value={s(r.status)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {type === "identity" ? <Button size="sm" variant="secondary" onClick={() => open(s(r.document_file_id))}><ExternalLink className="h-4 w-4" /> View document</Button> : (
                  <><Button size="sm" variant="secondary" onClick={() => open(s(r.rc_file_id))}><ExternalLink className="h-4 w-4" /> RC</Button><Button size="sm" variant="secondary" onClick={() => open(s(r.insurance_file_id))}><ExternalLink className="h-4 w-4" /> Insurance</Button></>
                )}
                {r.status === "pending_review" && (
                  <>
                    <Button size="sm" onClick={() => setDecision({ id: s(r.id), kind: "verified" })}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => setDecision({ id: s(r.id), kind: "needs_info" })}>Ask for more</Button>
                    <Button size="sm" variant="danger" onClick={() => setDecision({ id: s(r.id), kind: "rejected" })}>Reject</Button>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">Document links expire after 5 minutes and every view is audited.</p>
            </Card>
          ))}
        </div>
      ) : <EmptyState title="Queue is clear" body="New submissions appear here." />}
      <ConfirmDialog open={decision !== null} onClose={() => setDecision(null)} busy={decide.isPending} danger={decision?.kind === "rejected"}
        title={{ verified: "Approve this submission?", rejected: "Reject this submission?", needs_info: "Ask for more information?" }[decision?.kind || "verified"]}
        confirmLabel={{ verified: "Approve", rejected: "Reject", needs_info: "Send request" }[decision?.kind || "verified"]}
        reasonLabel={decision?.kind === "verified" ? undefined : "What should they fix? (sent to the member)"} reasonRequired={decision?.kind !== "verified"}
        body={decision?.kind === "verified" ? "Approving a driving licence also gives the person the driver role." : "The member sees this note and can resubmit."}
        onConfirm={(reason) => decide.mutate(reason)} />
    </div>
  );
};

// ---- Rides -------------------------------------------------------------------------------------------
export const AdminRides = () => {
  const [status, setStatus] = useState("");
  const [qText, setQText] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const [cancel, setCancel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin-rides", status, qText], queryFn: () => api.get<{ items: Row[] }>(`/admin/rides${qs({ status, q: qText, limit: 50 })}`) });
  const doCancel = useMutation({ mutationFn: (reason: string) => api.post(`/admin/rides/${cancel}/cancel`, { reason }), onSuccess: () => { setCancel(null); qc.invalidateQueries({ queryKey: ["admin-rides"] }); toast.success("Ride cancelled; passengers refunded"); }, onError: (e) => toast.error(e) });
  return (
    <div>
      <PageHeader title="Rides" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search by place" className="max-w-xs" placeholder="Search by place" value={qText} onChange={(e) => setQText(e.target.value)} />
        <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{Object.keys(RIDE_STATUS).map((k) => <option key={k}>{k}</option>)}</Select>
      </div>
      <Table rows={q.data?.items} cols={[
        { key: "route", label: "Route", render: (r) => <Link className="font-medium hover:underline" to={`/app/rides/${r.id}`}>{s(r.origin_label)} → {s(r.destination_label)}</Link> },
        { key: "driver_name", label: "Driver", render: (r) => <Link className="hover:underline" to={`/admin/users/${r.driver_id}`}>{s(r.driver_name)}</Link> },
        { key: "departure_at", label: "Departure", render: (r) => dateTime(s(r.departure_at)) },
        { key: "seats", label: "Seats", render: (r) => `${s(r.seats_reserved)}/${s(r.seats_total)}` },
        { key: "price", label: "Per seat", render: (r) => rupees(Number(r.price_per_seat_paise)) },
        { key: "status", label: "Status", render: (r) => <><StatusPill map={RIDE_STATUS} value={s(r.status)} /> {Boolean(r.recurring) && <Pill>commute</Pill>} <DemoTag show={Boolean(r.is_demo)} /></> },
        { key: "act", label: "", render: (r) => (["draft", "published"].includes(s(r.status)) ? <Button size="sm" variant="ghost" onClick={() => setCancel(s(r.id))}>Cancel</Button> : null) },
      ]} />
      <ConfirmDialog open={Boolean(cancel)} onClose={() => setCancel(null)} danger title="Cancel this ride as Green Way?" confirmLabel="Cancel ride" reasonLabel="Reason shown to passengers" reasonRequired busy={doCancel.isPending} body="All bookings are cancelled and paid passengers refunded in full. Use for safety or policy reasons." onConfirm={(reason) => doCancel.mutate(reason)} />
    </div>
  );
};

// ---- Bookings and disputes -------------------------------------------------------------------------
export const AdminBookings = () => {
  const [tab, setTab] = useState<"disputes" | "all">("disputes");
  const [status, setStatus] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const [resolve, setResolve] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState("COMPLETED");
  const [refund, setRefund] = useState(0);
  const [note, setNote] = useState("");
  const disputes = useQuery({ queryKey: ["admin-disputes"], queryFn: () => api.get<{ items: Row[] }>("/admin/disputes"), enabled: tab === "disputes" });
  const all = useQuery({ queryKey: ["admin-bookings", status], queryFn: () => api.get<{ items: Row[] }>(`/admin/bookings${qs({ status, limit: 50 })}`), enabled: tab === "all" });
  const doResolve = useMutation({
    mutationFn: () => api.post(`/admin/disputes/${resolve!.id}/resolve`, { outcome, refundPercent: refund, note }),
    onSuccess: () => { setResolve(null); setNote(""); qc.invalidateQueries({ queryKey: ["admin-disputes"] }); toast.success("Dispute resolved"); },
    onError: (e) => toast.error(e),
  });
  return (
    <div>
      <PageHeader title="Bookings and disputes" />
      <Tabs value={tab} onChange={setTab} options={[{ value: "disputes", label: "Open disputes", count: disputes.data?.items.length }, { value: "all", label: "All bookings" }]} />
      {tab === "disputes" ? (
        <Table rows={disputes.data?.items} empty="No open disputes." cols={[
          { key: "route", label: "Trip", render: (r) => <>{s(r.origin_label)} → {s(r.destination_label)}<span className="block text-xs text-muted">{dateTime(s(r.departure_at))}</span></> },
          { key: "opened_by", label: "Opened by" },
          { key: "reason", label: "Reason", className: "max-w-xs" },
          { key: "total", label: "Total", render: (r) => rupees(Number(r.total_paise)) },
          { key: "act", label: "", render: (r) => <Button size="sm" onClick={() => setResolve(r)}>Resolve</Button> },
        ]} />
      ) : (
        <>
          <Select aria-label="Status" className="mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{Object.keys(BOOKING_STATUS).map((k) => <option key={k}>{k}</option>)}</Select>
          <Table rows={all.data?.items} cols={[
            { key: "route", label: "Trip", render: (r) => <Link className="hover:underline" to={`/app/bookings/${r.id}`}>{s(r.origin_label)} → {s(r.destination_label)}</Link> },
            { key: "people", label: "People", render: (r) => <>{s(r.passenger_name)}<span className="block text-xs text-muted">driver {s(r.driver_name)}</span></> },
            { key: "departure_at", label: "Departure", render: (r) => dateTime(s(r.departure_at)) },
            { key: "status", label: "Status", render: (r) => <><StatusPill map={BOOKING_STATUS} value={s(r.status)} /> <DemoTag show={Boolean(r.is_demo)} /></> },
            { key: "total", label: "Total", render: (r) => rupees(Number(r.total_paise)) },
          ]} />
        </>
      )}
      {resolve && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Resolve dispute">
          <Card className="w-full max-w-md space-y-4 p-5">
            <h2 className="text-lg font-semibold">Resolve dispute</h2>
            <p className="text-sm text-muted">{s(resolve.reason)}</p>
            <Field label="Outcome" htmlFor="rs-o"><Select id="rs-o" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="COMPLETED">Trip happened (completed)</option><option value="NO_SHOW">Passenger didn't show</option><option value="CANCELLED_BY_DRIVER">Driver at fault (cancelled)</option></Select></Field>
            <Field label={`Refund to passenger: ${refund}%`} htmlFor="rs-r"><input id="rs-r" type="range" className="w-full" min={0} max={100} step={10} value={refund} onChange={(e) => setRefund(Number(e.target.value))} /></Field>
            <Field label="Resolution note (sent to both people)" htmlFor="rs-n"><Textarea id="rs-n" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setResolve(null)}>Close</Button><Button disabled={note.trim().length < 5} loading={doResolve.isPending} onClick={() => doResolve.mutate()}>Resolve</Button></div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ---- Safety ------------------------------------------------------------------------------------------
export const AdminSafety = () => {
  const [status, setStatus] = useState("open");
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Row | null>(null);
  const [next, setNext] = useState("investigating");
  const [resolution, setResolution] = useState("");
  const q = useQuery({ queryKey: ["admin-reports", status], queryFn: () => api.get<{ items: Row[] }>(`/admin/reports${qs({ status, limit: 50 })}`) });
  const save = useMutation({ mutationFn: () => api.patch(`/admin/reports/${edit!.id}`, { status: next, resolution: resolution || undefined }), onSuccess: () => { setEdit(null); setResolution(""); qc.invalidateQueries({ queryKey: ["admin-reports"] }); toast.success("Report updated"); }, onError: (e) => toast.error(e) });
  const tone = (sev: string) => (sev === "critical" ? "bad" : sev === "high" ? "warn" : "neutral");
  return (
    <div>
      <PageHeader title="Safety incidents" subtitle="Critical and high-severity reports also open an urgent support ticket." />
      <Select aria-label="Status" className="mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>{["open", "investigating", "resolved", "dismissed"].map((x) => <option key={x}>{x}</option>)}</Select>
      <Table rows={q.data?.items} empty="No reports with this status." cols={[
        { key: "severity", label: "Severity", render: (r) => <Pill tone={tone(s(r.severity)) as "bad"}>{s(r.severity)}</Pill> },
        { key: "category", label: "Category", render: (r) => s(r.category).replace(/_/g, " ") },
        { key: "description", label: "Description", className: "max-w-sm" },
        { key: "people", label: "People", render: (r) => <>by <Link className="hover:underline" to={`/admin/users/${r.reporter_id}`}>{s(r.reporter_name)}</Link>{r.subject_user_id ? <> about <Link className="hover:underline" to={`/admin/users/${r.subject_user_id}`}>{s(r.subject_name) || "member"}</Link></> : null}</> },
        { key: "created_at", label: "When", render: (r) => relative(s(r.created_at)) },
        { key: "act", label: "", render: (r) => <Button size="sm" variant="secondary" onClick={() => { setEdit(r); setNext(r.status === "open" ? "investigating" : "resolved"); }}>Update</Button> },
      ]} />
      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Update report">
          <Card className="w-full max-w-md space-y-4 p-5">
            <h2 className="text-lg font-semibold">Update report</h2>
            <Field label="Status" htmlFor="sr-s"><Select id="sr-s" value={next} onChange={(e) => setNext(e.target.value)}>{["open", "investigating", "resolved", "dismissed"].map((x) => <option key={x}>{x}</option>)}</Select></Field>
            <Field label="Outcome (sent to the reporter when closing)" htmlFor="sr-r"><Textarea id="sr-r" value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Close</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ---- Payments --------------------------------------------------------------------------------------------
type Recon = { staleOrders: Row[]; capturedWithoutConfirmedBooking: Row[]; stuckRefunds: Row[]; webhookErrors: Row[] };

export const AdminPayments = () => {
  const [tab, setTab] = useState<"payments" | "refunds" | "reconciliation">("payments");
  const qc = useQueryClient();
  const toast = useToast();
  const [refundFor, setRefundFor] = useState<Row | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const payments = useQuery({ queryKey: ["admin-payments"], queryFn: () => api.get<{ items: Row[] }>("/admin/payments?limit=50"), enabled: tab === "payments" });
  const refunds = useQuery({ queryKey: ["admin-refunds"], queryFn: () => api.get<{ items: Row[] }>("/admin/refunds?limit=50"), enabled: tab === "refunds" });
  const recon = useQuery({ queryKey: ["admin-recon"], queryFn: () => api.get<Recon>("/admin/reconciliation"), enabled: tab === "reconciliation" });
  const doRefund = useMutation({
    mutationFn: () => api.post(`/admin/payments/${refundFor!.id}/refund`, { amountPaise: Math.round(Number(amount) * 100), reason }),
    onSuccess: () => { setRefundFor(null); setAmount(""); setReason(""); qc.invalidateQueries({ queryKey: ["admin-payments"] }); toast.success("Refund issued"); },
    onError: (e) => toast.error(e),
  });
  const payTone = (st: string) => (st === "captured" ? "good" : st === "failed" ? "bad" : st.includes("refund") ? "info" : "neutral");
  return (
    <div>
      <PageHeader title="Payments and refunds" />
      <Tabs value={tab} onChange={setTab} options={[{ value: "payments", label: "Payments" }, { value: "refunds", label: "Refunds" }, { value: "reconciliation", label: "Reconciliation" }]} />
      {tab === "payments" && <Table rows={payments.data?.items} cols={[
        { key: "receipt_number", label: "Receipt", render: (r) => <span className="tabular">{s(r.receipt_number)}</span> },
        { key: "amount", label: "Amount", render: (r) => <>{rupees(Number(r.amount_paise))}{Number(r.refunded_paise) > 0 && <span className="block text-xs text-muted">−{rupees(Number(r.refunded_paise))}</span>}</> },
        { key: "provider", label: "Provider" },
        { key: "status", label: "Status", render: (r) => <><Pill tone={payTone(s(r.status)) as "good"}>{s(r.status).replace(/_/g, " ")}</Pill> <DemoTag show={Boolean(r.is_demo)} /></> },
        { key: "booking_status", label: "Booking", render: (r) => <StatusPill map={BOOKING_STATUS} value={s(r.booking_status)} /> },
        { key: "created_at", label: "Created", render: (r) => relative(s(r.created_at)) },
        { key: "act", label: "", render: (r) => (["captured", "partially_refunded"].includes(s(r.status)) ? <Button size="sm" variant="ghost" onClick={() => setRefundFor(r)}>Refund</Button> : null) },
      ]} />}
      {tab === "refunds" && <Table rows={refunds.data?.items} empty="No refunds." cols={[
        { key: "amount", label: "Amount", render: (r) => rupees(Number(r.amount_paise)) },
        { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "processed" ? "good" : r.status === "failed" ? "bad" : "info"}>{s(r.status)}</Pill> },
        { key: "reason", label: "Reason", className: "max-w-sm" },
        { key: "failure_reason", label: "Last error" },
        { key: "created_at", label: "Created", render: (r) => relative(s(r.created_at)) },
      ]} />}
      {tab === "reconciliation" && (recon.isLoading ? <SkeletonList /> : recon.data && (
        <div className="space-y-6">
          <Notice tone="info">Each list shows states that shouldn't last. Empty lists mean payments, bookings and refunds agree.</Notice>
          <Section title={`Orders open for more than 2 hours (${recon.data.staleOrders.length})`}><Table rows={recon.data.staleOrders} empty="None." cols={[{ key: "id", label: "Payment" }, { key: "amount", label: "Amount", render: (r) => rupees(Number(r.amount_paise)) }, { key: "created_at", label: "Created", render: (r) => relative(s(r.created_at)) }]} /></Section>
          <Section title={`Paid, but the booking isn't confirmed and no refund exists (${recon.data.capturedWithoutConfirmedBooking.length})`}><Table rows={recon.data.capturedWithoutConfirmedBooking} empty="None." cols={[{ key: "id", label: "Payment" }, { key: "booking_status", label: "Booking status" }, { key: "amount", label: "Amount", render: (r) => rupees(Number(r.amount_paise)) }]} /></Section>
          <Section title={`Refunds pending over an hour (${recon.data.stuckRefunds.length})`}><Table rows={recon.data.stuckRefunds} empty="None." cols={[{ key: "id", label: "Refund" }, { key: "amount", label: "Amount", render: (r) => rupees(Number(r.amount_paise)) }, { key: "failure_reason", label: "Last error" }]} /></Section>
          <Section title={`Webhook problems (${recon.data.webhookErrors.length})`}><Table rows={recon.data.webhookErrors} empty="None." cols={[{ key: "provider", label: "Provider" }, { key: "event_type", label: "Event" }, { key: "signature_valid", label: "Signature", render: (r) => (r.signature_valid ? "valid" : <Pill tone="bad">invalid</Pill>) }, { key: "processing_error", label: "Error" }, { key: "received_at", label: "Received", render: (r) => relative(s(r.received_at)) }]} /></Section>
        </div>
      ))}
      {refundFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Issue refund">
          <Card className="w-full max-w-md space-y-4 p-5">
            <h2 className="text-lg font-semibold">Issue a refund</h2>
            <p className="text-sm text-muted">Paid {rupees(Number(refundFor.amount_paise))}, already refunded {rupees(Number(refundFor.refunded_paise), { free: "₹0" })}.</p>
            <Field label="Amount (₹)" htmlFor="rf-a"><Input id="rf-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
            <Field label="Reason (audited)" htmlFor="rf-r"><Textarea id="rf-r" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRefundFor(null)}>Close</Button><Button disabled={!Number(amount) || reason.trim().length < 5} loading={doRefund.isPending} onClick={() => doRefund.mutate()}>Refund</Button></div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ---- Configuration -------------------------------------------------------------------------------------------
const CONFIG_HELP: Record<string, string> = {
  fees: "Platform fee added on top of the contribution. 0 means no fee.",
  pricing: "Suggested contribution per km per seat (paise), minimum, and the cap as a multiple of the suggestion.",
  cancellation: "Free-cancellation window and refund percentages.",
  booking: "Default booking cutoff, how long requests wait for drivers, payment hold window, and seats per booking.",
  matching: "Distance limits for pickup and drop-off, the default time window, and ranking weights.",
  service_area: "Centre and radius of the operating area.",
  safety: "Emergency number shown in the app (verify before changing), trip-share link lifetime, location retention.",
  features: "Feature flags.",
};

const ConfigEditor = ({ k, value }: { k: string; value: unknown }) => {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [err, setErr] = useState("");
  const save = useMutation({
    mutationFn: () => api.put(`/admin/config/${k}`, JSON.parse(text)),
    onSuccess: () => { setErr(""); qc.invalidateQueries({ queryKey: ["admin-config"] }); qc.invalidateQueries({ queryKey: ["meta"] }); toast.success(`${k} saved and audited`); },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold">{k.replace(/_/g, " ")}</p><p className="text-sm text-muted">{CONFIG_HELP[k]}</p></div>
        <Button size="sm" onClick={() => { try { JSON.parse(text); save.mutate(); } catch { setErr("That isn't valid JSON."); } }} loading={save.isPending}>Save</Button>
      </div>
      <textarea aria-label={`${k} settings`} className="input mt-3 h-auto font-mono text-xs" rows={Math.min(12, text.split("\n").length + 1)} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <p className="error-text">{err}</p>}
    </Card>
  );
};

export const AdminConfig = () => {
  const q = useQuery({ queryKey: ["admin-config"], queryFn: () => api.get<{ settings: Record<string, unknown>; editable: string[] }>("/admin/config") });
  return (
    <div>
      <PageHeader title="Platform configuration" subtitle="Each section is validated before saving, and every change is written to the audit log with before and after values." />
      <Notice tone="warn" className="mb-5">Pricing, fees and cancellation rules affect what people pay. Changes apply to new bookings immediately and should follow legal review.</Notice>
      {q.isLoading ? <SkeletonList /> : <div className="grid gap-4 lg:grid-cols-2">{q.data?.editable.map((k) => <ConfigEditor key={k} k={k} value={q.data!.settings[k]} />)}</div>}
    </div>
  );
};

// ---- Audit log ------------------------------------------------------------------------------------------------
export const AdminAudit = () => {
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const q = useQuery({ queryKey: ["admin-audit", action, entityId], queryFn: () => api.get<{ items: Row[] }>(`/admin/audit${qs({ action, entityId, limit: 100 })}`) });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Privileged, safety and account actions, newest first." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Action starts with" className="max-w-xs" placeholder="Action starts with, e.g. admin." value={action} onChange={(e) => setAction(e.target.value)} />
        <Input aria-label="Entity id" className="max-w-xs" placeholder="Entity id" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
      </div>
      <Table rows={q.data?.items} cols={[
        { key: "created_at", label: "When", render: (r) => <span className="whitespace-nowrap">{dateTime(s(r.created_at))}</span> },
        { key: "actor", label: "Actor", render: (r) => <>{s(r.actor_name) || s(r.actor_role)}<span className="block text-xs text-muted">{s(r.actor_role)}</span></> },
        { key: "action", label: "Action", render: (r) => <span className="font-mono text-xs">{s(r.action)}</span> },
        { key: "entity", label: "Entity", render: (r) => <span className="text-xs">{s(r.entity_type)}<span className="block font-mono text-muted">{s(r.entity_id).slice(0, 12)}</span></span> },
        { key: "details", label: "Details", render: (r) => <span className="block max-w-xs truncate font-mono text-xs text-muted" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</span> },
        { key: "request_id", label: "Request", render: (r) => <span className="font-mono text-xs text-muted">{s(r.request_id).slice(0, 8)}</span> },
      ]} />
    </div>
  );
};

// ---- Analytics and exports -------------------------------------------------------------------------------------
export const AdminAnalytics = () => {
  const w = useWindow();
  const toast = useToast();
  const download = async (kind: string) => {
    try {
      const res = await fetch(`/api/v1/admin/exports/${kind}${w.params}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json()).error?.message || "Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (res.headers.get("content-disposition") || "").match(/filename="(.+)"/)?.[1] || `${kind}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Export downloaded and recorded in the audit log");
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div>
      <PageHeader title="Analytics and exports" subtitle="CSV exports of operational data for the selected window. Every export is audited." />
      {w.controls}
      <div className="grid gap-3 sm:grid-cols-3">
        {[["bookings", "Bookings", "Status, seats, amounts and key timestamps."], ["rides", "Rides", "Routes, timing, seats, pricing and booking mode."], ["payments", "Payments", "Amounts, fees, refunds, provider and receipts."]].map(([k, t, d]) => (
          <Card key={k} className="p-5">
            <p className="font-semibold">{t}</p>
            <p className="mt-1 text-sm text-muted">{d}</p>
            <Button size="sm" variant="secondary" className="mt-4" onClick={() => download(k)}><Download className="h-4 w-4" /> Download CSV</Button>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">For the headline metrics, see the <Link to="/admin" className="font-semibold text-brand">overview</Link>.</p>
    </div>
  );
};

// ---- Health ---------------------------------------------------------------------------------------------------------
type Health = { status: string; environment: string; database: { ok: boolean; latencyMs: number; migrations: { version: string; applied_at: string }[] }; worker: { tasks: Record<string, { ok: boolean; at: string; ms?: number; error?: string; result?: unknown }> }; failedJobs: Row[]; notificationDeliveries7d: Record<string, number>; webhooks7d: Record<string, number>; providers: Record<string, { name: string; live: boolean }> };

export const AdminHealth = () => {
  const q = useQuery({ queryKey: ["admin-health"], queryFn: () => api.get<Health>("/admin/health"), refetchInterval: 30_000 });
  if (q.isLoading) return <SkeletonList />;
  if (q.error) return <ErrorState error={q.error} />;
  const h = q.data!;
  return (
    <div>
      <PageHeader title="System health" subtitle={`Environment: ${h.environment}. Refreshes every 30 seconds.`} actions={<Pill tone="good" icon={<Activity className="h-3 w-3" />}>API up</Pill>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Database" value={h.database.ok ? "Reachable" : "Down"} hint={`${h.database.latencyMs} ms · ${h.database.migrations.length} migration${h.database.migrations.length === 1 ? "" : "s"} applied`} />
        <Stat label="Failed jobs" value={h.failedJobs.length} hint="Recent worker failures" />
        <Stat label="Notification failures (7d)" value={h.notificationDeliveries7d.failed ?? 0} hint={`${h.notificationDeliveries7d.sent ?? 0} sent · ${h.notificationDeliveries7d.logged_dev ?? 0} logged in dev · ${h.notificationDeliveries7d.pending ?? 0} pending`} />
      </div>
      <Section title="External providers" className="mt-8">
        <div className="card divide-y divide-line">
          {Object.entries(h.providers).map(([k, p]) => (
            <div key={k} className="flex items-center justify-between px-4 py-3"><span className="font-medium capitalize">{k}</span><span className="flex items-center gap-2 text-sm"><span className="text-muted">{p.name}</span><Pill tone={p.live ? "good" : "warn"}>{p.live ? "live" : "development stand-in"}</Pill></span></div>
          ))}
        </div>
      </Section>
      <Section title="Background tasks (this server)">
        <Table rows={Object.entries(h.worker.tasks).map(([name, t]) => ({ id: name, name, ...t }))} empty="No task runs recorded yet on this server." cols={[
          { key: "name", label: "Task" },
          { key: "ok", label: "Last run", render: (r) => (r.ok ? <Pill tone="good">ok</Pill> : <Pill tone="bad">failed</Pill>) },
          { key: "at", label: "When", render: (r) => relative(s(r.at)) },
          { key: "result", label: "Result / error", render: (r) => <span className="font-mono text-xs">{r.error ? s(r.error) : JSON.stringify(r.result)}</span> },
        ]} />
      </Section>
      <Section title="Failed jobs"><Table rows={h.failedJobs} empty="No failed jobs." cols={[{ key: "type", label: "Type" }, { key: "attempts", label: "Attempts" }, { key: "last_error", label: "Error" }, { key: "updated_at", label: "When", render: (r) => relative(s(r.updated_at)) }]} /></Section>
      <Section title="Payment webhooks (7 days)"><p className="text-sm">{h.webhooks7d.invalid ?? 0} rejected for bad signatures · {h.webhooks7d.errors ?? 0} processing errors</p></Section>
    </div>
  );
};

// ---- Support operator queue --------------------------------------------------------------------------------------
export const SupportQueue = () => {
  const { data: me } = useMe();
  const [view, setView] = useState<"mine" | "unassigned" | "escalated" | "all">("mine");
  const q = useQuery({ queryKey: ["queue", view], queryFn: () => api.get<{ items: Row[] }>(`/support/queue?view=${view}`) });
  const options = [{ value: "mine" as const, label: "Assigned to me" }, { value: "unassigned" as const, label: "Unassigned" }, { value: "escalated" as const, label: "Escalated" }, ...(can(me, "support.tickets.read_all") ? [{ value: "all" as const, label: "All open" }] : [])];
  return (
    <div>
      <PageHeader title="Support queue" subtitle="You see booking details only for tickets assigned to you. Escalate safety incidents and payment disputes." />
      <Tabs value={view} onChange={setView} options={options} />
      <Table rows={q.data?.items} empty="Nothing in this view." cols={[
        { key: "priority", label: "Priority", render: (r) => <Pill tone={r.priority === "urgent" ? "bad" : r.priority === "high" ? "warn" : "neutral"}>{s(r.priority)}</Pill> },
        { key: "subject", label: "Subject", render: (r) => <Link to={`/support/tickets/${r.id}`} className="font-semibold hover:underline">{s(r.subject)}</Link> },
        { key: "category", label: "Topic" },
        { key: "status", label: "Status", render: (r) => <>{<TicketStatus s={s(r.status)} />} {Boolean(r.escalated) && <Pill tone="bad">escalated</Pill>}</> },
        { key: "created_at", label: "Opened", render: (r) => relative(s(r.created_at)) },
      ]} />
    </div>
  );
};
