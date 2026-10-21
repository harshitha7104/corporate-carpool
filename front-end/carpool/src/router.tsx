import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Outlet, ScrollRestoration } from "react-router-dom";
import { Spinner } from "@/components/ui";
import { AppShell, MoreMenu, PublicLayout, RequireAuth, RequirePermission } from "@/components/Layout";
import { Login, Welcome } from "@/pages/auth";
import { Commutes, Messages, MessageThread, Notifications, Payments, ReceiptPage, Reviews, SavedPlaces } from "@/pages/passenger/Account";
import { BookingDetail } from "@/pages/passenger/BookingDetail";
import { Profile, Safety, Support, TicketThread, VerificationCentre } from "@/pages/passenger/Profile";
import { RideDetail } from "@/pages/passenger/RideDetail";
import { Search } from "@/pages/passenger/Search";
import { LiveTrip, PassengerHome, Trips } from "@/pages/passenger/Trips";
import { Benefits, Contact, Faq, HowItWorks, Landing, NotFound, Privacy, SafetyCentre, SharedTrip, Terms } from "@/pages/public";

// Staff and driver screens load on demand so passengers download less.
const lz = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) => {
  const C = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return (props: Record<string, unknown>) => (
    <Suspense fallback={<Spinner />}>
      <C {...props} />
    </Suspense>
  );
};
const admin = () => import("@/pages/admin/Admin");
const driver = () => import("@/pages/driver/Driver");
const AdminLayout = lz(admin, "AdminLayout");
const AdminOverview = lz(admin, "AdminOverview");
const AdminUsers = lz(admin, "AdminUsers");
const AdminUserDetail = lz(admin, "AdminUserDetail");
const AdminVerifications = lz(admin, "AdminVerifications");
const AdminRides = lz(admin, "AdminRides");
const AdminBookings = lz(admin, "AdminBookings");
const AdminSafety = lz(admin, "AdminSafety");
const AdminPayments = lz(admin, "AdminPayments");
const AdminConfig = lz(admin, "AdminConfig");
const AdminAudit = lz(admin, "AdminAudit");
const AdminAnalytics = lz(admin, "AdminAnalytics");
const AdminHealth = lz(admin, "AdminHealth");
const SupportQueue = lz(admin, "SupportQueue");
const DriverHome = lz(driver, "DriverHome");
const CreateRide = lz(driver, "CreateRide");
const ManageRide = lz(driver, "ManageRide");
const DriverRequests = lz(driver, "DriverRequests");
const DriverCommutes = lz(driver, "DriverCommutes");
const Vehicles = lz(driver, "Vehicles");
const Earnings = lz(driver, "Earnings");

const Root = () => (
  <>
    <ScrollRestoration />
    <Outlet />
  </>
);

const Protected = () => (
  <RequireAuth>
    <AppShell />
  </RequireAuth>
);

const perm = (permission: string, element: React.ReactNode) => <RequirePermission permission={permission}>{element}</RequirePermission>;

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: "/", element: <Landing /> },
          { path: "/how-it-works", element: <HowItWorks /> },
          { path: "/benefits", element: <Benefits /> },
          { path: "/safety", element: <SafetyCentre /> },
          { path: "/faq", element: <Faq /> },
          { path: "/terms", element: <Terms /> },
          { path: "/privacy", element: <Privacy /> },
          { path: "/contact", element: <Contact /> },
          { path: "/share/:token", element: <SharedTrip /> },
        ],
      },
      { path: "/login", element: <Login /> },
      {
        element: <Protected />,
        children: [
          { path: "/app", element: <PassengerHome /> },
          { path: "/app/welcome", element: <Welcome /> },
          { path: "/app/search", element: <Search /> },
          { path: "/app/rides/:id", element: <RideDetail /> },
          { path: "/app/bookings/:id", element: <BookingDetail /> },
          { path: "/app/trips", element: <Trips /> },
          { path: "/app/trips/live/:rideId", element: <LiveTrip /> },
          { path: "/app/messages", element: <Messages /> },
          { path: "/app/messages/:id", element: <MessageThread /> },
          { path: "/app/notifications", element: <Notifications /> },
          { path: "/app/payments", element: <Payments /> },
          { path: "/app/payments/:id", element: <ReceiptPage /> },
          { path: "/app/reviews", element: <Reviews /> },
          { path: "/app/places", element: <SavedPlaces /> },
          { path: "/app/commutes", element: <Commutes /> },
          { path: "/app/safety", element: <Safety /> },
          { path: "/app/support", element: <Support /> },
          { path: "/app/support/:id", element: <TicketThread /> },
          { path: "/app/profile", element: <Profile /> },
          { path: "/app/more", element: <MoreMenu /> },
          { path: "/app/drive", element: <DriverHome /> },
          { path: "/app/drive/new", element: <CreateRide /> },
          { path: "/app/drive/rides/:id", element: <ManageRide /> },
          { path: "/app/drive/requests", element: <DriverRequests /> },
          { path: "/app/drive/commutes", element: <DriverCommutes /> },
          { path: "/app/drive/vehicles", element: <Vehicles /> },
          { path: "/app/drive/verification", element: <VerificationCentre /> },
          { path: "/app/drive/earnings", element: <Earnings /> },
          {
            path: "/admin",
            element: perm("admin.metrics.read", <AdminLayout />),
            children: [
              { index: true, element: <AdminOverview /> },
              { path: "users", element: perm("admin.users.read", <AdminUsers />) },
              { path: "users/:id", element: perm("admin.users.read", <AdminUserDetail />) },
              { path: "verifications", element: perm("admin.verifications.review", <AdminVerifications />) },
              { path: "rides", element: perm("admin.rides.read", <AdminRides />) },
              { path: "bookings", element: perm("admin.bookings.read", <AdminBookings />) },
              { path: "safety", element: perm("admin.safety.manage", <AdminSafety />) },
              { path: "payments", element: perm("admin.payments.read", <AdminPayments />) },
              { path: "config", element: perm("admin.config.manage", <AdminConfig />) },
              { path: "audit", element: perm("admin.audit.read", <AdminAudit />) },
              { path: "analytics", element: perm("admin.exports.run", <AdminAnalytics />) },
              { path: "health", element: perm("admin.health.read", <AdminHealth />) },
            ],
          },
          { path: "/support", element: perm("support.tickets.read_queue", <SupportQueue />) },
          { path: "/support/tickets/:id", element: perm("support.tickets.read_queue", <TicketThread staff />) },
        ],
      },
      { path: "*", element: <PublicLayout />, children: [{ path: "*", element: <NotFound /> }] },
    ],
  },
]);
