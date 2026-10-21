# Verification matrix

Status as of this build. **Auto** = covered by an automated test that passed. **Browser** = checked by hand in Chrome against the running app (screenshots and console checks). **Creds** = code is written but needs real provider credentials to be exercised. **Not built** = deliberately not implemented yet.

## Platform

| Item | Implemented | Auto | Browser | Creds / notes |
| --- | --- | --- | --- | --- |
| Frontend starts (Vite) and builds | Yes | typecheck + build | Yes | |
| Backend starts, migrates, seeds | Yes | every test file | Yes | Also booted in production mode with `DEMO_MODE` against PostgreSQL |
| PostgreSQL schema + migrations | Yes | Yes | — | Embedded PostgreSQL locally; any PostgreSQL 15+ in production |
| Docker image + compose | Written | — | — | **Not run here** (Docker isn't installed on this machine) |
| CI workflow | Written | — | — | **Not run here** (runs on GitHub after push) |
| Health and readiness endpoints | Yes | Yes | Yes | |
| Structured logs with request ids | Yes | — | Yes | |
| OpenAPI document | Generated from routes | — | — | Lists all 126 operations; bodies described in `docs/api.md` |

## Features

| Feature | Implemented | Auto | Browser | Creds / notes |
| --- | --- | --- | --- | --- |
| Phone OTP sign-in (+91), email OTP | Yes | Yes | Yes (E2E) | Real SMS needs MSG91; real email needs Resend |
| Development OTP shown on screen, refused in production | Yes | Yes | Yes | CI also checks the refusal |
| Sessions, logout, sign out everywhere | Yes | Yes | Yes | |
| Profile, preferences, saved places, trusted contacts | Yes | Partly | Yes | |
| Account deactivation and deletion | Yes | — | Screen checked | Deletion refuses while trips are open |
| Roles and permissions (passenger, driver, admin, support) | Yes | Yes | Yes | |
| Verification states (all six) for ID, licence, vehicle | Yes | Yes | Yes (E2E) | Manual review; no ID-verification API |
| Private documents with short-lived links | Yes | Yes | Yes | Local disk; use object storage in production |
| Vehicles (add, edit, remove, documents) | Yes | Yes | Yes (E2E) | |
| Ride creation, stops, cutoff, luggage, preferences, drafts | Yes | Yes | Yes (E2E) | |
| Suggested contribution and cost-sharing cap | Yes | Yes | Yes | Rates configurable; needs legal review |
| Route preview and matching (along-route, direction, detour) | Yes | Yes | Yes | Distances are estimates without Mapbox |
| Search filters and transparent ranking | Yes | Yes | Yes (E2E) | Driver reliability is not part of the score (see below) |
| Map and list results | Yes | — | Yes | OpenStreetMap tiles for development |
| Instant and request-to-book | Yes | Yes | Yes (E2E) | |
| Booking state machine with audit trail | Yes | Yes | Yes | |
| Concurrency-safe seats, idempotency keys | Yes | Yes | — | 12-way race test |
| Cancellations with configurable refunds | Yes | Yes | Screen checked | |
| Expiry of unanswered requests and unpaid holds | Yes | Yes | — | Worker every 30 s |
| Simulated payments via signed webhooks | Yes | Yes | Yes (E2E) | Labelled "no real money" everywhere |
| Razorpay orders, signature and webhook verification, refunds | Yes | Signature logic only | — | **Creds**: needs Razorpay keys and onboarding |
| Receipts, payment history, driver contributions | Yes | Yes | Yes | Printable page, not a PDF or tax invoice |
| Reconciliation views | Yes | — | Screen checked | |
| In-app notifications with live push | Yes | Yes | Yes | |
| Email/SMS delivery with retries and honest status | Yes | Yes | — | **Creds** for real delivery |
| WhatsApp | Adapter only | — | — | Records `not_configured`; no provider wired |
| Booking-scoped chat (no phone numbers) | Yes | Yes | Yes | |
| Live trip: start, pickup, no-show, complete | Yes | Yes | Yes | |
| Consent-based live location, staleness, purge | Yes | Yes | Screen checked | Browser geolocation sends fixes while the screen is open |
| Trip-share links with expiry and revocation | Yes | Yes | Yes | |
| SOS, safety reports, blocking, escalation | Yes | Yes | Yes | SOS texts need an SMS provider |
| Reviews and ratings (completed trips only) | Yes | Yes | Yes | |
| Recurring commutes (generation, skip, pause, end) | Yes | Yes | Screen checked | Holidays are skipped by hand; no holiday calendar |
| Passenger regular routes and weekly matches | Yes | — | Yes | |
| Favourite drivers | Yes | — | Yes | |
| Support tickets, internal notes, assignment, escalation | Yes | Yes | Yes | |
| Admin: metrics, users, verification, rides, bookings, disputes, safety, payments, config, audit, exports, health | Yes | Yes (API) | Yes (all screens load) | |
| Metric definitions and demo exclusion | Yes | Yes | Yes | `docs/metrics.md` |
| Fictional seed data, clearly labelled | Yes | — | Yes | |
| Responsive phone layout with bottom navigation | Yes | Yes (E2E) | Yes | |
| Light and dark themes | Yes | — | Yes | |

## Not built (honest gaps)

- **Driver reliability in ranking.** Ratings and ride counts are shown, but cancellation history isn't in the score.
- **"Driver approaching pickup" alerts.** These need live ETAs from a routing provider.
- **Masked phone calls.** Chat replaces calling; there is no telephony bridge.
- **Automatic holiday calendar** for commutes.
- **PostGIS.** Not needed at pilot scale: matching projects points onto each candidate's route in the service.
- **Redis.** Not used; per-instance rate limits and realtime are documented in `docs/security.md`.
- **Next.js / FastAPI.** The brief recommended them, but the existing app was React + Node, and the brief asked to build on existing code. The stack stays JavaScript (React + TypeScript + Tailwind on the frontend, Express 5 on the backend) on PostgreSQL.
- **The old claude.ai-hosted page** still shows the previous version of Green Way and isn't connected to this backend.

## Phase checklist

| Phase | Status |
| --- | --- |
| 1 Foundation: architecture, schema, migrations, config, health, CI, Docker | Done (CI and Docker not executed here) |
| 2 Authentication, profiles, verification states, RBAC | Done |
| 3 Drivers, vehicles, rides, booking, seat safety | Done |
| 4 Maps and matching | Done with the estimate provider; Mapbox adapter needs a key |
| 5 Passenger and driver experiences, recurring commutes | Done |
| 6 Payments and notifications | Done with simulated/log providers; Razorpay, MSG91 and Resend need credentials |
| 7 Safety, support, administration | Done |
| 8 Tests, security review, E2E, documentation | Done |

## External services and credentials needed

| Service | Needed for | Status |
| --- | --- | --- |
| Managed PostgreSQL (Render, Neon, RDS, Cloud SQL) | Production database | Required |
| MSG91 (DLT-registered sender and template) | SMS sign-in codes and SMS alerts | Not configured |
| Resend (or another email API) | Email codes, receipts, notifications | Not configured |
| Razorpay (approved account, webhook secret) | Real payments and refunds | Not configured |
| Mapbox | Geocoding, driving routes and ETAs | Not configured |
| Map tile provider with a production licence | Map display | OpenStreetMap tiles used in development |
| Object storage (S3/GCS) with encryption | Identity and vehicle documents | Local disk in development |
| Log and uptime monitoring | Operations | Not configured |
