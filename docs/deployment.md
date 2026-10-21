# Deployment and operations

Green Way deploys as one Node.js service (API, WebSocket, worker and the built React app) plus PostgreSQL 15+.

## Option A: Render (Blueprint in `render.yaml`)

1. Push the repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository. Render creates the `greenway-db` PostgreSQL database and the `green-way` web service and links `DATABASE_URL`.
3. Set `PUBLIC_APP_URL` to the service URL (e.g. `https://green-way.onrender.com`) when prompted. `SESSION_SECRET` is generated for you.
4. Deploy. The service runs migrations on start; `/ready` turns healthy once the database answers.

As committed, the blueprint is a **demo deployment** (`DEMO_MODE=true`, `SEED_DEMO=true`): fictional data, on-screen sign-in codes and simulated payments, with a banner saying so. For a pilot, add the provider secrets (below), delete `DEMO_MODE` and `SEED_DEMO`, and start from an empty database.

Render's free PostgreSQL expires after 30 days and has no backups; use a paid plan for anything real. The free web service has an ephemeral disk, so uploaded documents are lost on redeploy until storage moves to S3/GCS.

## Option B: Docker

```bash
docker compose up --build    # app on http://localhost:4000 with its own PostgreSQL
```
For production, build the image from `Dockerfile` and run it with the environment variables below against a managed PostgreSQL. Mount persistent storage at `/data/uploads` (or switch to object storage).

## Environment variables

See `backend/.env.example` for all of them. Required in production: `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_APP_URL`. Real integrations:

| Purpose | Variables |
| --- | --- |
| SMS sign-in codes and SMS notifications | `OTP_PROVIDER=msg91`, `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` |
| Email | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Payments | `PAYMENTS_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (webhook URL: `/api/v1/payments/webhooks/razorpay`, events `payment.captured`, `payment.failed`, `refund.processed`) |
| Maps | `MAPS_PROVIDER=mapbox`, `MAPBOX_TOKEN`; frontend build-time `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` |

The server refuses to start with a half-configured provider, and refuses development providers in production unless `DEMO_MODE=true`.

## Migrations

Applied automatically at start (advisory-locked, so parallel instances are safe), or manually with `cd backend && npm run migrate`. Add new files as `backend/src/db/migrations/NNN_name.sql`; never edit an applied one.

## Health and monitoring

| Endpoint | Meaning |
| --- | --- |
| `GET /health` | Process is up (liveness) |
| `GET /ready` | Database reachable (readiness; used by Render and the Docker health check) |
| Admin → System health | Database latency, applied migrations, worker task results, failed jobs, notification delivery counts, webhook signature failures, which providers are live |

Logs are JSON lines on stdout/stderr with `requestId`; ship them to your log platform and alert on `level: "error"`, on `Worker task failed`, on `Rejected payment webhook`, and on `/ready` failures. Admin → Payments → Reconciliation lists stale orders, payments without confirmed bookings, stuck refunds and webhook errors; review it daily during the pilot.

## Backups and recovery

- Enable automated daily backups and point-in-time recovery on the managed PostgreSQL.
- Rehearse a restore into a new database before launch: create the database from the backup, point a staging copy of the service at it with `DATABASE_URL`, confirm `/ready`, sign in as an admin and check recent bookings and payments.
- After restoring production, compare payments against the provider dashboard using the reconciliation screen; webhook redelivery from the provider fills gaps (events are de-duplicated).
- Document storage needs its own versioned bucket backups.

## Rolling back

Redeploy the previous image or commit. Migrations are forward-only; write additive migrations so the previous version still runs against the newer schema.
