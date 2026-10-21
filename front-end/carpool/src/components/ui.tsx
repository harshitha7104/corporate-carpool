import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { errorMessage } from "@/lib/api";

export { clsx };

// ---- Buttons --------------------------------------------------------------------------
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  loading?: boolean;
};

export const Button = ({ variant = "primary", size = "md", loading, disabled, className, children, ...rest }: ButtonProps) => (
  <button
    className={clsx(`btn-${variant}`, size === "sm" && "btn-sm", className)}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
);

export const ButtonLink = ({ to, variant = "primary", size = "md", className, children }: { to: string; variant?: ButtonProps["variant"]; size?: "md" | "sm"; className?: string; children: ReactNode }) => (
  <Link to={to} className={clsx(`btn-${variant}`, size === "sm" && "btn-sm", className)}>
    {children}
  </Link>
);

// ---- Form fields ---------------------------------------------------------------------
export const Field = ({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string; optional?: boolean }) => (
  <div>
    <label className="label" htmlFor={htmlFor}>
      {label}
      {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
    </label>
    {children}
    {error ? <p className="error-text" role="alert">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
  </div>
);

export const Input = ({ className, ref, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) => (
  <input ref={ref} className={clsx("input", className)} {...rest} />
);

export const Textarea = ({ className, ref, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) => (
  <textarea ref={ref} className={clsx("input", className)} rows={3} {...rest} />
);

export const Select = ({ className, ref, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { ref?: React.Ref<HTMLSelectElement> }) => (
  <select ref={ref} className={clsx("input pr-8", className)} {...rest}>
    {children}
  </select>
);

export const Toggle = ({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; id?: string }) => {
  const auto = useId();
  const fid = id || auto;
  return (
    <label htmlFor={fid} className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={fid} type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-line transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
};

// ---- Surfaces ---------------------------------------------------------------------------
export const Card = ({ className, children, as: As = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" }) => (
  <As className={clsx("card", className)}>{children}</As>
);

export const PageHeader = ({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) => (
  <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      {back && (
        <Link to={back.to} className="mb-2 inline-block text-sm font-medium text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
      {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </header>
);

export const Section = ({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={clsx("mb-8", className)}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {actions}
    </div>
    {children}
  </section>
);

// ---- Status -------------------------------------------------------------------------------
export type Tone = "neutral" | "brand" | "good" | "warn" | "bad" | "info" | "signal";
const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  brand: "bg-brand-soft text-brand",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  signal: "bg-signal-soft text-signal",
};

export const Pill = ({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) => (
  <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[tone], className)}>
    {icon}
    {children}
  </span>
);

export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Requested", tone: "info" },
  ACCEPTED: { label: "Awaiting payment", tone: "warn" },
  CONFIRMED: { label: "Confirmed", tone: "good" },
  IN_PROGRESS: { label: "On the way", tone: "brand" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  REJECTED: { label: "Declined", tone: "bad" },
  CANCELLED_BY_PASSENGER: { label: "Cancelled by you", tone: "neutral" },
  CANCELLED_BY_DRIVER: { label: "Cancelled by driver", tone: "bad" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  NO_SHOW: { label: "No-show", tone: "bad" },
  DISPUTED: { label: "Disputed", tone: "warn" },
};

export const RIDE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "good" },
  in_progress: { label: "In progress", tone: "brand" },
  completed: { label: "Completed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const VERIFICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_submitted: { label: "Not submitted", tone: "neutral" },
  pending_review: { label: "Pending review", tone: "info" },
  verified: { label: "Verified", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  needs_info: { label: "Needs more information", tone: "warn" },
  expired: { label: "Expired", tone: "warn" },
};

export const StatusPill = ({ map, value, override }: { map: Record<string, { label: string; tone: Tone }>; value: string; override?: string }) => {
  const s = map[value] || { label: value, tone: "neutral" as Tone };
  return <Pill tone={s.tone}>{override || s.label}</Pill>;
};

export const DemoTag = ({ show = true }: { show?: boolean }) =>
  show ? (
    <span className="inline-flex items-center rounded-md border border-dashed border-muted/50 px-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted" title="Fictional demo data">
      Demo
    </span>
  ) : null;

export const Avatar = ({ initials, size = 40, tone = "brand" }: { initials: string; size?: number; tone?: "brand" | "neutral" }) => (
  <span
    className={clsx("inline-grid shrink-0 place-items-center rounded-full font-display font-semibold", tone === "brand" ? "bg-brand-soft text-brand" : "bg-sunken text-muted")}
    style={{ width: size, height: size, fontSize: size * 0.38 }}
    aria-hidden
  >
    {initials}
  </span>
);

// ---- Loading, empty, error ------------------------------------------------------------------
export const Skeleton = ({ className }: { className?: string }) => <div className={clsx("animate-pulse rounded-xl bg-sunken", className)} aria-hidden />;

export const SkeletonList = ({ rows = 3, height = "h-24" }: { rows?: number; height?: string }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className={height} />
    ))}
  </div>
);

export const Spinner = ({ label = "Loading" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-muted" role="status">
    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
    <span>{label}…</span>
  </div>
);

export const EmptyState = ({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
    {icon && <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-sunken text-muted">{icon}</div>}
    <h3 className="font-display text-lg font-semibold">{title}</h3>
    {body && <p className="mx-auto mt-1 max-w-md text-muted">{body}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

export const ErrorState = ({ error, retry }: { error: unknown; retry?: () => void }) => (
  <div className="rounded-2xl border border-bad/30 bg-bad-soft px-5 py-4 text-bad" role="alert">
    <p className="font-semibold">That didn't load.</p>
    <p className="text-sm">{errorMessage(error)}</p>
    {retry && (
      <button className="mt-2 text-sm font-semibold underline" onClick={retry}>
        Try again
      </button>
    )}
  </div>
);

export const Notice = ({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "good" | "bad"; title?: string; children: ReactNode; className?: string }) => {
  const Icon = tone === "good" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div className={clsx("flex gap-3 rounded-xl px-4 py-3 text-sm", TONES[tone], className)} role={tone === "bad" ? "alert" : "note"}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="text-ink/90">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
};

export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) => (
  <div className="card p-4">
    <p className="eyebrow">{label}</p>
    <p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
  </div>
);

// ---- Tabs (route-based) -------------------------------------------------------------------
export const TabLinks = ({ tabs }: { tabs: { to: string; label: string; count?: number; end?: boolean }[] }) => (
  <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-sunken p-1" aria-label="Sections">
    {tabs.map((t) => (
      <NavLink
        key={t.to}
        to={t.to}
        end={t.end}
        className={({ isActive }) => clsx("whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold", isActive ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}
      >
        {t.label}
        {t.count ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-[11px] text-brand-ink">{t.count}</span> : null}
      </NavLink>
    ))}
  </nav>
);

export const Tabs = <T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) => (
  <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-sunken p-1" role="tablist">
    {options.map((o) => (
      <button
        key={o.value}
        role="tab"
        aria-selected={value === o.value}
        onClick={() => onChange(o.value)}
        className={clsx("whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold", value === o.value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}
      >
        {o.label}
        {o.count ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-[11px] text-brand-ink">{o.count}</span> : null}
      </button>
    ))}
  </div>
);

// ---- Dialog -----------------------------------------------------------------------------------
export const Dialog = ({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx("w-[calc(100%-32px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-ink/40", wide ? "max-w-2xl" : "max-w-md")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="rounded-lg p-1 text-muted hover:bg-sunken hover:text-ink" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
};

// Confirmation for irreversible actions, with an optional required reason.
export const ConfirmDialog = ({
  open, onClose, onConfirm, title, body, confirmLabel, danger, reasonLabel, reasonRequired, busy,
}: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: string; body: ReactNode;
  confirmLabel: string; danger?: boolean; reasonLabel?: string; reasonRequired?: boolean; busy?: boolean;
}) => {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const blocked = reasonRequired && reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant={danger ? "danger" : "primary"} disabled={blocked} loading={busy} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[15px]">
        <div className="text-muted">{body}</div>
        {reasonLabel && (
          <Field label={reasonLabel} optional={!reasonRequired} htmlFor="confirm-reason">
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
        )}
      </div>
    </Dialog>
  );
};

// ---- Toasts -------------------------------------------------------------------------------------
type Toast = { id: number; tone: "good" | "bad" | "info"; text: string };
const ToastCtx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx("pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lift", t.tone === "bad" ? "bg-bad text-white" : "bg-ink text-canvas")}>
            {t.tone === "good" && <CheckCircle2 className="h-4 w-4" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

export const useToast = () => {
  const push = useContext(ToastCtx);
  return { success: (t: string) => push("good", t), error: (e: unknown) => push("bad", errorMessage(e)), info: (t: string) => push("info", t) };
};
