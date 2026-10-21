import { useQuery } from "@tanstack/react-query";
import {
  Bell, Car, CarFront, ClipboardCheck, CreditCard, Gauge, Headphones, Heart, Home, LifeBuoy, LogOut, MapPinned,
  MessageCircle, Repeat, Route, Search, Settings, ShieldAlert, ShieldCheck, Star, User, Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { can, hasRole, useMe, useMeta, useSignOut } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner, clsx, useToast } from "./ui";

export const Logo = ({ to = "/" }: { to?: string }) => (
  <Link to={to} className="flex items-center gap-2.5" aria-label="Green Way home">
    <img src="/images/logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
    <span className="font-display text-xl font-semibold tracking-tight">Green Way</span>
  </Link>
);

export const DevBanner = () => {
  const { data } = useMeta();
  if (!data || (data.environment === "production" && !data.demoMode)) return null;
  return (
    <div className="bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
      {data.demoMode ? "Demo deployment, not for real trips" : "Development environment"} · {data.providers.payments.live ? "live payments" : "simulated payments"} · {data.providers.otpDevMode ? "sign-in codes shown on screen" : "codes sent by SMS/email"} · {data.providers.maps.live ? "live maps" : "estimated routes"} · demo data is fictional
    </div>
  );
};

// ---- Public site -----------------------------------------------------------------------
export const PublicLayout = () => {
  const { data: me } = useMe();
  return (
    <div className="flex min-h-screen flex-col">
      <DevBanner />
      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/90 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted md:flex">
            <NavLink to="/how-it-works" className={({ isActive }) => clsx("hover:text-ink", isActive && "text-ink")}>How it works</NavLink>
            <NavLink to="/benefits" className={({ isActive }) => clsx("hover:text-ink", isActive && "text-ink")}>Drivers & riders</NavLink>
            <NavLink to="/safety" className={({ isActive }) => clsx("hover:text-ink", isActive && "text-ink")}>Safety</NavLink>
            <NavLink to="/faq" className={({ isActive }) => clsx("hover:text-ink", isActive && "text-ink")}>FAQ</NavLink>
          </nav>
          {me ? (
            <Link to="/app" className="btn-primary btn-sm">Open app</Link>
          ) : (
            <div className="flex gap-2">
              <Link to="/login" className="btn-ghost btn-sm">Sign in</Link>
              <Link to="/login" className="btn-primary btn-sm hidden sm:inline-flex">Get started</Link>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-4 sm:px-6">
          <div className="sm:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted">Share the ride you're already taking. Built for Bengaluru commutes between home, campus and tech park.</p>
          </div>
          <div className="text-sm">
            <p className="eyebrow mb-2">Product</p>
            <ul className="space-y-1.5">
              <li><Link to="/how-it-works" className="hover:underline">How it works</Link></li>
              <li><Link to="/benefits" className="hover:underline">For drivers & riders</Link></li>
              <li><Link to="/safety" className="hover:underline">Safety centre</Link></li>
              <li><Link to="/faq" className="hover:underline">FAQ</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="eyebrow mb-2">Company</p>
            <ul className="space-y-1.5">
              <li><Link to="/contact" className="hover:underline">Contact & support</Link></li>
              <li><Link to="/terms" className="hover:underline">Terms of service</Link></li>
              <li><Link to="/privacy" className="hover:underline">Privacy policy</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-line px-4 py-4 text-center text-xs text-muted">© {new Date().getFullYear()} Green Way · Bengaluru, Karnataka</p>
      </footer>
    </div>
  );
};

// ---- Guards ------------------------------------------------------------------------------
export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!me.profileComplete && loc.pathname !== "/app/welcome") return <Navigate to={`/app/welcome?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
};

export const RequirePermission = ({ permission, children }: { permission: string; children: ReactNode }) => {
  const { data: me } = useMe();
  if (!can(me, permission)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold">You don't have access to this page</h1>
        <p className="mt-2 text-muted">It's for Green Way staff. If you think you should have access, ask an administrator.</p>
        <Link to="/app" className="btn-secondary mt-6">Back to the app</Link>
      </div>
    );
  }
  return <>{children}</>;
};

// ---- App shell -------------------------------------------------------------------------------
type Item = { to: string; label: string; icon: ReactNode; end?: boolean; badge?: number };

const RailLink = ({ item }: { item: Item }) => (
  <NavLink
    to={item.to}
    end={item.end}
    className={({ isActive }) =>
      clsx("flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] font-medium", isActive ? "bg-brand-soft text-brand" : "text-muted hover:bg-sunken hover:text-ink")
    }
  >
    <span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
    <span className="flex-1">{item.label}</span>
    {item.badge ? <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-ink">{item.badge}</span> : null}
  </NavLink>
);

const useUnread = () =>
  useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api.get<{ unread: number }>("/notifications?limit=1"), refetchInterval: 60_000, select: (d) => d.unread });

export const AppShell = () => {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const unread = useUnread();

  // Live updates: refresh what changed and surface notifications as toasts.
  useRealtime((event, data) => {
    if (event === "notification") {
      const n = data as { title: string; body: string };
      toast.info(`${n.title}: ${n.body}`);
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (event === "booking.updated") {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["booking"] });
      qc.invalidateQueries({ queryKey: ["ride"] });
      qc.invalidateQueries({ queryKey: ["driver-rides"] });
    }
    if (event === "message") qc.invalidateQueries({ queryKey: ["conversations"] });
  }, Boolean(me));

  if (!me) return null;
  const driverish = hasRole(me, "driver") || me.driver;
  const ride: Item[] = [
    { to: "/app", label: "Home", icon: <Home />, end: true },
    { to: "/app/search", label: "Find a ride", icon: <Search /> },
    { to: "/app/trips", label: "My trips", icon: <Route /> },
    { to: "/app/messages", label: "Messages", icon: <MessageCircle /> },
    { to: "/app/commutes", label: "Regular routes", icon: <Heart /> },
  ];
  const drive: Item[] = [
    { to: "/app/drive", label: "Driver home", icon: <Gauge />, end: true },
    { to: "/app/drive/new", label: "Offer a ride", icon: <CarFront /> },
    { to: "/app/drive/requests", label: "Requests", icon: <ClipboardCheck /> },
    { to: "/app/drive/commutes", label: "Recurring commutes", icon: <Repeat /> },
    { to: "/app/drive/vehicles", label: "Vehicles", icon: <Car /> },
    { to: "/app/drive/earnings", label: "Contributions", icon: <Wallet /> },
  ];
  const account: Item[] = [
    { to: "/app/notifications", label: "Notifications", icon: <Bell />, badge: unread.data },
    { to: "/app/payments", label: "Payments", icon: <CreditCard /> },
    { to: "/app/reviews", label: "Reviews", icon: <Star /> },
    { to: "/app/places", label: "Saved places", icon: <MapPinned /> },
    { to: "/app/safety", label: "Safety", icon: <ShieldAlert /> },
    { to: "/app/support", label: "Help & support", icon: <LifeBuoy /> },
    { to: "/app/profile", label: "Profile & verification", icon: <User /> },
  ];
  const staff: Item[] = [
    ...(can(me, "admin.metrics.read") ? [{ to: "/admin", label: "Admin console", icon: <ShieldCheck /> }] : []),
    ...(can(me, "support.tickets.read_queue") ? [{ to: "/support", label: "Support queue", icon: <Headphones /> }] : []),
  ];
  const mobile: Item[] = [
    { to: "/app", label: "Home", icon: <Home />, end: true },
    { to: "/app/search", label: "Search", icon: <Search /> },
    { to: "/app/trips", label: "Trips", icon: <Route /> },
    { to: "/app/messages", label: "Messages", icon: <MessageCircle /> },
    { to: "/app/profile", label: "Profile", icon: <User /> },
  ];

  return (
    <div className="min-h-screen">
      <DevBanner />
      <div className="lg:flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-5 lg:flex">
          <div className="px-2 pb-5">
            <Logo to="/app" />
          </div>
          <nav className="space-y-6" aria-label="Main">
            <div className="space-y-0.5">
              <p className="eyebrow px-3 pb-1">Ride</p>
              {ride.map((i) => <RailLink key={i.to} item={i} />)}
            </div>
            <div className="space-y-0.5">
              <p className="eyebrow px-3 pb-1">Drive</p>
              {(driverish ? drive : drive.slice(0, 2).concat(drive.slice(4, 5))).map((i) => <RailLink key={i.to} item={i} />)}
            </div>
            <div className="space-y-0.5">
              <p className="eyebrow px-3 pb-1">Account</p>
              {account.map((i) => <RailLink key={i.to} item={i} />)}
            </div>
            {staff.length > 0 && (
              <div className="space-y-0.5">
                <p className="eyebrow px-3 pb-1">Staff</p>
                {staff.map((i) => <RailLink key={i.to} item={i} />)}
              </div>
            )}
          </nav>
          <button
            className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
          >
            <LogOut className="h-5 w-5" /> Sign out
          </button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <Logo to="/app" />
            <div className="flex items-center gap-1">
              <Link to="/app/safety" className="rounded-lg p-2 text-bad" aria-label="Safety and SOS">
                <ShieldAlert className="h-5 w-5" />
              </Link>
              <Link to="/app/notifications" className="relative rounded-lg p-2 text-muted" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {unread.data ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-bad" /> : null}
              </Link>
              <Link to="/app/more" className="rounded-lg p-2 text-muted" aria-label="More">
                <Settings className="h-5 w-5" />
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pt-8">
            <Outlet />
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary"
      >
        {mobile.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => clsx("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold", isActive ? "text-brand" : "text-muted")}>
            <span className="[&>svg]:h-[22px] [&>svg]:w-[22px]">{i.icon}</span>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

// Phone-only index of everything the bottom bar doesn't fit.
export const MoreMenu = () => {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const links: [string, string][] = [
    ["/app/drive", "Driver home"], ["/app/drive/new", "Offer a ride"], ["/app/drive/requests", "Booking requests"], ["/app/drive/commutes", "Recurring commutes"],
    ["/app/drive/vehicles", "Vehicles"], ["/app/drive/earnings", "Contributions"], ["/app/commutes", "Regular routes & favourites"], ["/app/notifications", "Notifications"],
    ["/app/payments", "Payments"], ["/app/reviews", "Reviews"], ["/app/places", "Saved places"], ["/app/safety", "Safety & SOS"], ["/app/support", "Help & support"],
    ...(can(me, "admin.metrics.read") ? [["/admin", "Admin console"] as [string, string]] : []),
    ...(can(me, "support.tickets.read_queue") ? [["/support", "Support queue"] as [string, string]] : []),
  ];
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">More</h1>
      <ul className="card divide-y divide-line">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="flex items-center justify-between px-4 py-3.5 font-medium hover:bg-sunken">
              {label} <span className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <button
        className="btn-secondary mt-4 w-full"
        onClick={async () => {
          await signOut();
          navigate("/");
        }}
      >
        Sign out
      </button>
    </div>
  );
};
