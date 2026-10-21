import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Logo } from "@/components/Layout";
import { Button, Field, Input, Notice, Select, Spinner, useToast } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import { fetchSession, useMe } from "@/lib/session";

const phoneSchema = z.object({
  value: z.string().trim().transform((v) => v.replace(/[\s-]/g, "")).refine((v) => /^(\+91|91|0)?[6-9]\d{9}$/.test(v), "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9."),
});
const emailSchema = z.object({ value: z.string().trim().email("Enter a valid email address.") });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") });

type Challenge = { challengeId: string; channel: "sms" | "email"; expiresInSeconds: number; devCode?: string; devNotice?: string };

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/app");

export const Login = () => {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const { data: me, isLoading } = useMe();
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [destination, setDestination] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const first = useForm<{ value: string }>({ resolver: zodResolver(channel === "sms" ? phoneSchema : emailSchema) });
  const second = useForm<{ code: string }>({ resolver: zodResolver(codeSchema) });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (isLoading) return <Spinner />;
  if (me) return <Navigate to={next} replace />;

  const request = async (value: string) => {
    try {
      const c = await api.post<Challenge>("/auth/otp/request", channel === "sms" ? { channel, phone: value } : { channel, email: value });
      setChallenge(c);
      setDestination(value);
      setCooldown(30);
      second.reset();
    } catch (err) {
      first.setError("value", { message: errorMessage(err) });
    }
  };

  const verify = async ({ code }: { code: string }) => {
    try {
      const r = await api.post<{ isNew: boolean }>("/auth/otp/verify", { challengeId: challenge!.challengeId, code });
      // staleTime 0: the cached "signed out" answer from page load must not be reused.
      const fresh = await qc.fetchQuery({ queryKey: ["me"], queryFn: fetchSession, staleTime: 0 });
      const complete = fresh?.profileComplete;
      navigate(r.isNew || !complete ? `/app/welcome?next=${encodeURIComponent(next)}` : next, { replace: true });
    } catch (err) {
      second.setError("code", { message: errorMessage(err) });
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {!challenge ? (
            <>
              <h1 className="text-3xl font-semibold">Sign in or create an account</h1>
              <p className="mt-2 text-muted">We'll send you a one-time code. No passwords to remember.</p>
              <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1" role="tablist">
                {(["sms", "email"] as const).map((c) => (
                  <button
                    key={c}
                    role="tab"
                    aria-selected={channel === c}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold ${channel === c ? "bg-surface shadow-card" : "text-muted"}`}
                    onClick={() => {
                      setChannel(c);
                      first.reset();
                    }}
                  >
                    {c === "sms" ? <Smartphone className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    {c === "sms" ? "Mobile number" : "Email"}
                  </button>
                ))}
              </div>
              <form className="mt-5 space-y-4" onSubmit={first.handleSubmit((v) => request(v.value))} noValidate>
                <Field label={channel === "sms" ? "Mobile number" : "Email address"} htmlFor="login-value" error={first.formState.errors.value?.message}>
                  {channel === "sms" ? (
                    <div className="flex">
                      <span className="inline-flex items-center rounded-l-xl border border-r-0 border-line bg-sunken px-3 text-sm font-semibold text-muted">+91</span>
                      <Input id="login-value" className="rounded-l-none" inputMode="tel" autoComplete="tel-national" placeholder="98450 12345" {...first.register("value")} />
                    </div>
                  ) : (
                    <Input id="login-value" type="email" autoComplete="email" placeholder="you@company.com" {...first.register("value")} />
                  )}
                </Field>
                <Button type="submit" className="w-full" loading={first.formState.isSubmitting}>Send code</Button>
              </form>
              <p className="mt-6 text-xs text-muted">
                By continuing you agree to the <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy" className="underline">privacy policy</Link>.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-semibold">Enter your code</h1>
              <p className="mt-2 text-muted">
                Sent to <span className="font-semibold text-ink">{channel === "sms" ? `+91 ${destination.replace(/^(\+?91|0)/, "")}` : destination}</span>.{" "}
                <button className="font-semibold text-brand hover:underline" onClick={() => setChallenge(null)}>Change</button>
              </p>
              {challenge.devCode && (
                <Notice tone="warn" title="Development sign-in code" className="mt-5">
                  Your code is <span className="font-display text-lg font-semibold tracking-[0.2em] text-ink">{challenge.devCode}</span>. Real deployments send it by {channel === "sms" ? "SMS" : "email"} and never show it here.
                </Notice>
              )}
              <form className="mt-5 space-y-4" onSubmit={second.handleSubmit(verify)} noValidate>
                <Field label="6-digit code" htmlFor="otp" error={second.formState.errors.code?.message}>
                  <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-display text-2xl tracking-[0.5em]" autoFocus {...second.register("code")} />
                </Field>
                <Button type="submit" className="w-full" loading={second.formState.isSubmitting}>Verify and continue</Button>
              </form>
              <button className="mt-4 text-sm font-semibold text-brand disabled:text-muted" disabled={cooldown > 0} onClick={() => request(destination)}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand lg:block">
        <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "repeating-linear-gradient(115deg, transparent 0 38px, rgb(var(--brand-ink)) 38px 40px)" }} />
        <div className="relative flex h-full flex-col justify-end p-12 text-brand-ink">
          <p className="font-display text-4xl font-semibold leading-tight">Silk Board at 9 am is better with company.</p>
          <p className="mt-3 max-w-md text-lg opacity-90">Share the drive you're already making, with people from your area going your way.</p>
        </div>
      </div>
    </div>
  );
};

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(80),
  gender: z.string().optional(),
  homeArea: z.string().trim().max(80).optional(),
  workArea: z.string().trim().max(80).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email or leave it blank.")]).optional(),
});

export const Welcome = () => {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { fullName: me?.profile?.fullName || "", gender: me?.profile?.gender || "", homeArea: me?.profile?.homeArea || "", workArea: me?.profile?.workArea || "", email: me?.email || "" },
  });
  const submit = async (v: z.infer<typeof profileSchema>) => {
    try {
      await api.patch("/users/me", { fullName: v.fullName, gender: v.gender || null, homeArea: v.homeArea || null, workArea: v.workArea || null, ...(me?.phone ? { email: v.email || null } : {}) });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Welcome to Green Way");
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      const fe = fieldErrors(err);
      Object.entries(fe).forEach(([k, m]) => form.setError(k as "fullName", { message: m }));
      if (!Object.keys(fe).length) form.setError("fullName", { message: errorMessage(err) });
    }
  };
  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="text-3xl font-semibold">Tell people who you are</h1>
      <p className="mt-2 text-muted">Drivers and passengers see your first name and initials. Your phone number and email stay private.</p>
      <form className="card mt-6 space-y-4 p-5" onSubmit={form.handleSubmit(submit)} noValidate>
        <Field label="Full name" htmlFor="fullName" error={form.formState.errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" {...form.register("fullName")} />
        </Field>
        <Field label="Gender" htmlFor="gender" optional hint="Only used to offer or join women-only rides. Never shown to others.">
          <Select id="gender" {...form.register("gender")}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non_binary">Non-binary</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Home area" htmlFor="homeArea" optional>
            <Input id="homeArea" placeholder="e.g. HSR Layout" {...form.register("homeArea")} />
          </Field>
          <Field label="Work or campus" htmlFor="workArea" optional>
            <Input id="workArea" placeholder="e.g. Manyata Tech Park" {...form.register("workArea")} />
          </Field>
        </div>
        {me?.phone && (
          <Field label="Email for receipts" htmlFor="email" optional error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Continue</Button>
      </form>
    </div>
  );
};
