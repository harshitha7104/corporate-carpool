import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, LifeBuoy, Phone, ShieldAlert, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Pill, Section, Select, SkeletonList, StatusPill, Textarea, Toggle, VERIFICATION_STATUS, useToast } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fullDate, maskPhone, relative } from "@/lib/format";
import { useMe, useMeta, useSignOut } from "@/lib/session";
import type { VerificationItem } from "@/lib/types";

// ---- Safety -------------------------------------------------------------------------------
type Contact = { id: string; name: string; phone: string; relationship: string | null };
type Report = { id: string; category: string; severity: string; status: string; description: string; resolution: string | null; created_at: string };

export const Safety = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: meta } = useMeta();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api.get<{ items: Contact[] }>("/users/me/trusted-contacts") });
  const reports = useQuery({ queryKey: ["my-reports"], queryFn: () => api.get<{ items: Report[] }>("/safety/reports/me") });
  const blocked = useQuery({ queryKey: ["blocked"], queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/users/me/blocked") });
  const add = useMutation({
    mutationFn: () => api.post("/users/me/trusted-contacts", { name, phone, relationship: relationship || null }),
    onSuccess: () => { setName(""); setPhone(""); setRelationship(""); qc.invalidateQueries({ queryKey: ["contacts"] }); toast.success("Trusted contact added"); },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/users/me/trusted-contacts/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }) });
  const unblock = useMutation({ mutationFn: (id: string) => api.del(`/users/${id}/block`), onSuccess: () => qc.invalidateQueries({ queryKey: ["blocked"] }) });
  const report = useMutation({
    mutationFn: () => api.post("/safety/reports", { category, description, rideId: params.get("report") || undefined }),
    onSuccess: () => { setDescription(""); qc.invalidateQueries({ queryKey: ["my-reports"] }); toast.success("Report sent. Serious reports go straight to the support team."); },
    onError: (e) => toast.error(e),
  });
  const sos = useMutation({
    mutationFn: () => api.post<{ contacts: { name: string; status: string }[] }>("/safety/sos", {}),
    onSuccess: (r) => toast.info(`Support alerted. ${r.contacts.length ? `${r.contacts.filter((c) => c.status === "sent").length} of ${r.contacts.length} contacts texted.` : "No trusted contacts to text."} Call ${meta?.safety.emergencyNumber ?? "112"} if you are in danger.`),
    onError: (e) => toast.error(e),
  });
  const number = meta?.safety.emergencyNumber ?? "112";
  return (
    <div className="max-w-3xl">
      <PageHeader title="Safety" />
      <Card className="mb-8 border-bad/40 p-5">
        <p className="flex items-center gap-2 text-lg font-semibold text-bad"><ShieldAlert className="h-5 w-5" /> In an emergency, call {number}</p>
        <p className="mt-1 text-sm text-muted">{meta?.safety.emergencyLabel}. Green Way support is not an emergency service.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`tel:${number}`} className="btn-danger"><Phone className="h-4 w-4" /> Call {number}</a>
          <Button variant="secondary" onClick={() => sos.mutate()} loading={sos.isPending}>Send SOS alert</Button>
        </div>
        <p className="mt-3 text-xs text-muted">SOS records an urgent report, alerts Green Way staff and texts your trusted contacts. The result tells you whether each text was actually sent.</p>
      </Card>

      <Section title="Trusted contacts">
        <p className="mb-3 text-sm text-muted">They receive a text when you press SOS. You can also send them a live trip link from any confirmed booking.</p>
        {contacts.data?.items.length ? (
          <ul className="card mb-4 divide-y divide-line">
            {contacts.data.items.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <span><span className="font-semibold">{c.name}</span>{c.relationship && <span className="text-muted"> · {c.relationship}</span>}<span className="block text-sm tabular text-muted">{maskPhone(c.phone)}</span></span>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(c.id)} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        ) : <p className="mb-4 text-sm text-muted">No trusted contacts yet.</p>}
        <form className="card grid gap-3 p-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Name" htmlFor="tc-n"><Input id="tc-n" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <Field label="Mobile number" htmlFor="tc-p"><Input id="tc-p" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98450 12345" /></Field>
          <Field label="Relationship" htmlFor="tc-r" optional><Input id="tc-r" value={relationship} onChange={(e) => setRelationship(e.target.value)} maxLength={30} /></Field>
          <div className="sm:col-span-3"><Button type="submit" disabled={!name.trim() || !phone.trim()} loading={add.isPending}>Add contact</Button></div>
        </form>
      </Section>

      <Section title="Report a problem">
        <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); report.mutate(); }}>
          {params.get("report") && <Notice tone="info">This report will be linked to the trip you came from.</Notice>}
          <Field label="What kind of problem?" htmlFor="rp-c">
            <Select id="rp-c" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="unsafe_driving">Unsafe driving</option>
              <option value="harassment">Harassment or inappropriate behaviour</option>
              <option value="vehicle_mismatch">Car or driver didn't match the app</option>
              <option value="no_show">No-show</option>
              <option value="fraud">Fraud or payment outside the app</option>
              <option value="payment_dispute">Payment problem</option>
              <option value="other">Something else</option>
            </Select>
          </Field>
          <Field label="What happened?" htmlFor="rp-d"><Textarea id="rp-d" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></Field>
          <Button type="submit" disabled={description.trim().length < 10} loading={report.isPending}>Send report</Button>
        </form>
        {reports.data?.items.length ? (
          <ul className="mt-4 space-y-2">
            {reports.data.items.map((r) => (
              <li key={r.id} className="card p-4 text-sm">
                <p className="flex flex-wrap items-center gap-2"><span className="font-semibold capitalize">{r.category.replace(/_/g, " ")}</span><Pill tone={r.status === "resolved" ? "good" : r.status === "dismissed" ? "neutral" : "info"}>{r.status}</Pill><span className="text-muted">{relative(r.created_at)}</span></p>
                <p className="mt-1 text-muted">{r.description}</p>
                {r.resolution && <p className="mt-1"><span className="font-semibold">Outcome: </span>{r.resolution}</p>}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Blocked people">
        {blocked.data?.items.length ? (
          <ul className="card divide-y divide-line">{blocked.data.items.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3"><span>{b.name.split(" ")[0]}</span><Button variant="ghost" size="sm" onClick={() => unblock.mutate(b.id)}>Unblock</Button></li>
          ))}</ul>
        ) : <p className="text-sm text-muted">You haven't blocked anyone. Blocked people don't appear in your searches and can't book your rides.</p>}
      </Section>
    </div>
  );
};

// ---- Support (member side) --------------------------------------------------------------------
type Ticket = { id: string; category: string; subject: string; status: string; priority: string; created_at: string; updated_at: string };
type TicketDetail = Ticket & { description: string; messages: { id: string; body: string; internal: boolean; created_at: string; mine: boolean; author_role: string }[]; context: Record<string, unknown> | null; escalated: boolean; assignedToMe: boolean; assigned: boolean; bookingId: string | null; escalationReason: string | null };

const TICKET_TONE: Record<string, "info" | "warn" | "good" | "neutral"> = { open: "info", in_progress: "info", waiting_on_user: "warn", resolved: "good", closed: "neutral" };
export const TicketStatus = ({ s }: { s: string }) => <Pill tone={TICKET_TONE[s] || "neutral"}>{s.replace(/_/g, " ")}</Pill>;

export const Support = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState("booking");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const q = useQuery({ queryKey: ["tickets"], queryFn: () => api.get<{ items: Ticket[] }>("/support/tickets/me") });
  const create = useMutation({
    mutationFn: () => api.post<Ticket>("/support/tickets", { category, subject, description }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ["tickets"] }); toast.success("Ticket opened"); navigate(`/app/support/${t.id}`); },
    onError: (e) => toast.error(e),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Help and support" subtitle="For booking, payment, verification or account questions. For emergencies call 112." />
      <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <Field label="Topic" htmlFor="t-c">
            <Select id="t-c" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="booking">Booking</option><option value="payment">Payment or refund</option><option value="verification">Verification</option>
              <option value="account">Account</option><option value="safety">Safety</option><option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Subject" htmlFor="t-s"><Input id="t-s" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} /></Field>
        </div>
        <Field label="Details" htmlFor="t-d" hint="Include the date and route of the trip if it's about a ride."><Textarea id="t-d" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></Field>
        <Button type="submit" disabled={subject.trim().length < 3 || description.trim().length < 10} loading={create.isPending}>Open ticket</Button>
      </form>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Your tickets</h2>
      {q.isLoading ? <SkeletonList rows={2} height="h-14" /> : q.data?.items.length ? (
        <ul className="card divide-y divide-line">{q.data.items.map((t) => (
          <li key={t.id}><Link to={`/app/support/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sunken"><span><span className="font-semibold">{t.subject}</span><span className="block text-sm text-muted">{t.category} · updated {relative(t.updated_at)}</span></span><TicketStatus s={t.status} /></Link></li>
        ))}</ul>
      ) : <EmptyState icon={<LifeBuoy />} title="No tickets" />}
    </div>
  );
};

export const TicketThread = ({ staff = false }: { staff?: boolean }) => {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [escalation, setEscalation] = useState("");
  const q = useQuery({ queryKey: ["ticket", id], queryFn: () => api.get<TicketDetail>(`/support/tickets/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ticket", id] });
  const reply = useMutation({ mutationFn: () => api.post(`/support/tickets/${id}/messages`, { body, internal }), onSuccess: () => { setBody(""); refresh(); }, onError: (e) => toast.error(e) });
  const status = useMutation({ mutationFn: (s: string) => api.post(`/support/tickets/${id}/status`, { status: s }), onSuccess: refresh, onError: (e) => toast.error(e) });
  const assign = useMutation({ mutationFn: () => api.post(`/support/tickets/${id}/assign`, {}), onSuccess: refresh, onError: (e) => toast.error(e) });
  const escalate = useMutation({ mutationFn: (kind: string) => api.post(`/support/tickets/${id}/escalate`, { reason: escalation, kind }), onSuccess: () => { setEscalation(""); refresh(); toast.success("Escalated to admins"); }, onError: (e) => toast.error(e) });
  if (q.isLoading) return <SkeletonList rows={3} />;
  if (q.error) return <ErrorState error={q.error} />;
  const t = q.data!;
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ to: staff ? "/support" : "/app/support", label: staff ? "Queue" : "Support" }} title={t.subject} subtitle={`${t.category} · opened ${relative(t.created_at)}`} actions={<><TicketStatus s={t.status} />{t.escalated && <Pill tone="bad">Escalated</Pill>}</>} />
      <Card className="mb-4 p-4"><p className="whitespace-pre-wrap">{t.description}</p></Card>
      {staff && (
        <Card className="mb-4 p-4">
          <p className="eyebrow mb-2">Case tools</p>
          {!t.assignedToMe && <Button size="sm" onClick={() => assign.mutate()} loading={assign.isPending}>Assign to me</Button>}
          {t.escalationReason && <p className="mt-2 text-sm"><span className="font-semibold">Escalation: </span>{t.escalationReason}</p>}
          {t.context ? (
            <details className="mt-3 text-sm" open>
              <summary className="cursor-pointer font-semibold">Booking context (minimum needed)</summary>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-sunken p-3 text-xs">{JSON.stringify(t.context, null, 2)}</pre>
            </details>
          ) : t.bookingId ? <p className="mt-2 text-sm text-muted">Assign the ticket to yourself to see the booking details.</p> : null}
          {t.assignedToMe && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Field label="Escalation reason" htmlFor="esc"><Input id="esc" value={escalation} onChange={(e) => setEscalation(e.target.value)} /></Field>
              <Button variant="secondary" size="sm" disabled={escalation.trim().length < 5} onClick={() => escalate.mutate("safety")}>Escalate: safety</Button>
              <Button variant="secondary" size="sm" disabled={escalation.trim().length < 5} onClick={() => escalate.mutate("payment")}>Escalate: payment</Button>
              <Select aria-label="Set status" className="h-9 w-auto text-sm" value={t.status} onChange={(e) => status.mutate(e.target.value)}>
                {["open", "in_progress", "waiting_on_user", "resolved", "closed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </Select>
            </div>
          )}
        </Card>
      )}
      <ul className="space-y-2">
        {t.messages.map((m) => (
          <li key={m.id} className={`rounded-2xl px-4 py-3 ${m.internal ? "border border-dashed border-warn bg-warn-soft" : m.mine ? "bg-brand-soft" : "bg-surface border border-line"}`}>
            <p className="text-xs font-semibold text-muted">{m.internal ? "Internal note" : m.author_role === "member" ? (staff ? "Member" : "You") : "Green Way support"} · {relative(m.created_at)}</p>
            <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {t.status !== "closed" ? (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); reply.mutate(); }}>
          <Textarea aria-label="Reply" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {staff ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (member can't see it)</label> : <span />}
            <div className="flex gap-2">
              {!staff && t.status !== "resolved" && <Button variant="ghost" type="button" onClick={() => status.mutate("resolved")}>Mark resolved</Button>}
              <Button type="submit" disabled={!body.trim()} loading={reply.isPending}>Send</Button>
            </div>
          </div>
        </form>
      ) : <Notice tone="info" className="mt-4">This ticket is closed.</Notice>}
    </div>
  );
};

// ---- Profile and verification -----------------------------------------------------------------
const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(80),
  gender: z.string().optional(),
  bio: z.string().max(300).optional(),
  homeArea: z.string().max(80).optional(),
  workArea: z.string().max(80).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]).optional(),
});

export const UploadField = ({ purpose, label, onUploaded, accept = "image/jpeg,image/png,application/pdf" }: { purpose: string; label: string; onUploaded: (id: string, name: string) => void; accept?: string }) => {
  const [state, setState] = useState<{ busy?: boolean; name?: string; error?: string }>({});
  return (
    <div>
      <p className="label">{label}</p>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-sunken px-4 py-3 text-sm hover:border-brand">
        <FileUp className="h-5 w-5 text-muted" />
        <span className="flex-1">{state.busy ? "Uploading…" : state.name ? <span className="font-medium text-good">Uploaded: {state.name}</span> : "Choose a JPEG, PNG or PDF (max 5 MB)"}</span>
        <input
          type="file"
          className="sr-only"
          accept={accept}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) return setState({ error: "That file is larger than 5 MB." });
            setState({ busy: true });
            try {
              const r = await api.upload<{ id: string }>(`/files?purpose=${purpose}`, file);
              setState({ name: file.name });
              onUploaded(r.id, file.name);
            } catch (err) {
              setState({ error: errorMessage(err) });
            }
          }}
        />
      </label>
      {state.error && <p className="error-text">{state.error}</p>}
    </div>
  );
};

const VerificationCard = ({ kind, item }: { kind: "government_id" | "driving_license"; item: VerificationItem }) => {
  const qc = useQueryClient();
  const toast = useToast();
  const [docType, setDocType] = useState(kind === "driving_license" ? "driving_license" : "aadhaar");
  const [last4, setLast4] = useState("");
  const [expiry, setExpiry] = useState("");
  const [fileId, setFileId] = useState("");
  const submit = useMutation({
    mutationFn: () => api.post("/users/me/verification", { kind, documentType: docType, documentLast4: last4, fileId, expiresAt: expiry || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Submitted for review"); },
    onError: (e) => toast.error(e),
  });
  const canSubmit = ["not_submitted", "rejected", "needs_info", "expired"].includes(item.status);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{kind === "government_id" ? "Government ID" : "Driving licence"}</h3>
          <p className="text-sm text-muted">{kind === "government_id" ? "Aadhaar, PAN, passport or voter ID." : "Needed to publish rides."}</p>
        </div>
        <StatusPill map={VERIFICATION_STATUS} value={item.status} />
      </div>
      {item.status !== "not_submitted" && (
        <p className="mt-2 text-sm text-muted">
          {item.documentType?.replace(/_/g, " ")} ending {item.documentLast4} · submitted {item.submittedAt && fullDate(item.submittedAt)}
          {item.expiresAt && ` · valid until ${fullDate(item.expiresAt)}`}
        </p>
      )}
      {item.reviewerNotes && <Notice tone="warn" className="mt-3">Reviewer: {item.reviewerNotes}</Notice>}
      {canSubmit && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
          {kind === "government_id" && (
            <Field label="Document" htmlFor={`${kind}-type`}>
              <Select id={`${kind}-type`} value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="aadhaar">Aadhaar</option><option value="pan">PAN card</option><option value="passport">Passport</option><option value="voter_id">Voter ID</option>
              </Select>
            </Field>
          )}
          <Field label="Last 4 characters of the number" htmlFor={`${kind}-l4`} hint="We store only these, never the full number.">
            <Input id={`${kind}-l4`} value={last4} onChange={(e) => setLast4(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))} />
          </Field>
          {kind === "driving_license" && (
            <Field label="Valid until" htmlFor={`${kind}-exp`}><Input id={`${kind}-exp`} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          )}
          <div className="sm:col-span-2"><UploadField purpose={kind === "driving_license" ? "driving_license" : "identity_document"} label="Photo or scan" onUploaded={(id) => setFileId(id)} /></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={last4.length !== 4 || !fileId || (kind === "driving_license" && !expiry)} loading={submit.isPending}>Submit for review</Button></div>
        </form>
      )}
    </Card>
  );
};

export const VerificationCentre = () => {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Verification" subtitle="A Green Way reviewer checks each document by hand. This is a document check, not a background check." />
      <div className="space-y-4">
        <VerificationCard kind="government_id" item={me.verification.government_id} />
        <VerificationCard kind="driving_license" item={me.verification.driving_license} />
      </div>
      <p className="mt-4 text-sm text-muted">Vehicle documents are added per car on the <Link to="/app/drive/vehicles" className="font-semibold text-brand">Vehicles</Link> page.</p>
    </div>
  );
};

export const Profile = () => {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [danger, setDanger] = useState<"deactivate" | "delete" | null>(null);
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: me ? { fullName: me.profile?.fullName || "", gender: me.profile?.gender || "", bio: me.profile?.bio || "", homeArea: me.profile?.homeArea || "", workArea: me.profile?.workArea || "", email: me.email || "" } : undefined,
  });
  const save = useMutation({
    mutationFn: (v: z.infer<typeof profileSchema>) => api.patch("/users/me", { fullName: v.fullName, gender: v.gender || null, bio: v.bio || null, homeArea: v.homeArea || null, workArea: v.workArea || null, ...(me?.phone ? { email: v.email || null } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Profile saved"); },
    onError: (e) => toast.error(e),
  });
  const prefs = useMutation({
    mutationFn: (p: { notifyEmail: boolean; notifySms: boolean; notifyWhatsapp: boolean }) => api.put("/users/me/preferences", p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e) => toast.error(e),
  });
  const account = useMutation({
    mutationFn: (kind: "deactivate" | "delete") => (kind === "delete" ? api.del("/users/me") : api.post("/users/me/deactivate")),
    onSuccess: async () => { await signOut(); navigate("/"); },
    onError: (e) => { setDanger(null); toast.error(e); },
  });
  if (!me) return null;
  const p = me.preferences;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Profile" subtitle={`${me.phone ? `+91 ${me.phone.slice(3)}` : me.email} · member since ${fullDate(me.createdAt)}`} />
      {me.isDemo && <Notice tone="warn" className="mb-5">This is a fictional demo account.</Notice>}
      <Section title="About you">
        <form className="card space-y-4 p-5" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="pf-n" error={form.formState.errors.fullName?.message}><Input id="pf-n" {...form.register("fullName")} /></Field>
            <Field label="Gender" htmlFor="pf-g" optional hint="Used only for women-only rides. Never shown to others.">
              <Select id="pf-g" {...form.register("gender")}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option></Select>
            </Field>
            <Field label="Home area" htmlFor="pf-h" optional><Input id="pf-h" {...form.register("homeArea")} /></Field>
            <Field label="Work or campus" htmlFor="pf-w" optional><Input id="pf-w" {...form.register("workArea")} /></Field>
          </div>
          <Field label="About you" htmlFor="pf-b" optional hint="Shown to people you ride with."><Textarea id="pf-b" maxLength={300} {...form.register("bio")} /></Field>
          {me.phone && <Field label="Email" htmlFor="pf-e" optional error={form.formState.errors.email?.message} hint={me.email && !me.emailVerified ? "Not yet confirmed. Sign in with it once to confirm." : undefined}><Input id="pf-e" type="email" {...form.register("email")} /></Field>}
          <Button type="submit" loading={save.isPending}>Save profile</Button>
        </form>
      </Section>

      <Section title="Verification" actions={<Link to="/app/drive/verification" className="text-sm font-semibold text-brand">Manage</Link>}>
        <Card className="divide-y divide-line">
          {([["government_id", "Government ID"], ["driving_license", "Driving licence"]] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between px-5 py-3.5"><span className="font-medium">{label}</span><StatusPill map={VERIFICATION_STATUS} value={me.verification[k].status} /></div>
          ))}
          <div className="flex items-center justify-between px-5 py-3.5"><span className="font-medium">Phone number</span><StatusPill map={VERIFICATION_STATUS} value={me.phoneVerified ? "verified" : "not_submitted"} /></div>
        </Card>
      </Section>

      <Section title="Notifications">
        <Card className="divide-y divide-line px-5">
          <Toggle label="Email" description="Booking updates, receipts and reminders." checked={p.notifyEmail} onChange={(v) => prefs.mutate({ ...p, notifyEmail: v })} />
          <Toggle label="SMS" description="Only time-sensitive updates: requests, confirmations, cancellations, reminders." checked={p.notifySms} onChange={(v) => prefs.mutate({ ...p, notifySms: v })} />
          <Toggle label="WhatsApp" description="Not available yet; no WhatsApp provider is connected." checked={p.notifyWhatsapp} onChange={(v) => prefs.mutate({ ...p, notifyWhatsapp: v })} />
        </Card>
      </Section>

      <Section title="Account">
        <Card className="space-y-3 p-5">
          <Button variant="secondary" onClick={async () => { await api.post("/auth/logout-all").catch(() => {}); await signOut(); navigate("/login"); }}>Sign out on all devices</Button>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button variant="secondary" onClick={() => setDanger("deactivate")}><UserX className="h-4 w-4" /> Deactivate account</Button>
            <Button variant="danger" onClick={() => setDanger("delete")}><Trash2 className="h-4 w-4" /> Delete account</Button>
          </div>
          <p className="text-xs text-muted">Deactivating hides you until you sign in again. Deleting removes your personal details and documents permanently; past trip and payment records are kept without them.</p>
        </Card>
      </Section>
      <ConfirmDialog open={danger !== null} onClose={() => setDanger(null)} onConfirm={() => account.mutate(danger!)} busy={account.isPending} danger title={danger === "delete" ? "Delete your account?" : "Deactivate your account?"} confirmLabel={danger === "delete" ? "Delete permanently" : "Deactivate"} body={danger === "delete" ? "This can't be undone. You must cancel upcoming rides and bookings first." : "You'll be signed out. Signing in again reactivates the account."} />
    </div>
  );
};
