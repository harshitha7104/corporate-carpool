# Security and privacy

## Controls in place

| Area | Control | Where |
| --- | --- | --- |
| Authentication | Phone/email OTP; codes are HMACed, expire in 10 min, 5 wrong attempts per code, 30 s resend gap, 5 codes/destination/hour, 10 requests/IP/15 min | `services/auth.js` |
| Sessions | 256-bit random token in an `HttpOnly; SameSite=Lax; Secure` (production) cookie; only its SHA-256 is stored; revoked on logout, "sign out everywhere", suspension | `services/auth.js`, `http/middleware.js` |
| CSRF | Non-GET requests need an `Origin`/`Referer` matching the site or configured origins; webhooks use signatures instead | `http/middleware.js` |
| Authorization | Explicit permission list per role (no wildcard admin); `requirePermission` on staff routes; object-level checks in every service; unknown or unauthorised objects return 404 | `lib/permissions.js`, `services/*` |
| Support data minimisation | Operators see booking context only for tickets assigned to them, with no phone numbers or emails; each view is audited | `services/support.js` |
| Input validation | Zod schemas on every body and query; parameterised SQL only; mass assignment avoided by mapping fields explicitly | `services/*`, `lib/validate.js` |
| Uploads | 5 MB limit; type decided by file signature (JPEG/PNG/PDF), not by the header; random storage names outside any public folder; downloads only via 5-minute HMAC links bound to the viewer; `Content-Security-Policy: sandbox` and `no-store` on file responses; admin views audited | `services/verification.js`, `providers/storage.js` |
| Payments | Success only from a verified webhook (HMAC) or a server-verified Razorpay signature; events de-duplicated by provider event id; idempotency keys on checkout; refunds capped by a DB constraint; no card or UPI data ever touches Green Way | `services/payments.js`, `providers/payments.js` |
| Seat integrity | Row lock + `CHECK` constraint; consistent lock order to avoid deadlocks | `services/bookingState.js`, `services/bookings.js` |
| Location privacy | Shared only by the driver, only while the ride is in progress, only after they switch it on; rate-limited; visible to confirmed passengers and share-link holders; switched off at completion; purged after 7 days | `services/safety.js` |
| Trip-share links | Random token (hash stored), expiry, revocation, auto-revoked when the ride completes; shows first name, car and status only | `services/safety.js` |
| Rate limits | OTP, booking, search, chat, reports, SOS, uploads, places lookup, share views | `lib/rateLimit.js` |
| Headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS and a strict CSP in production | `http/middleware.js` |
| Secrets | Only from environment variables; production refuses to start without `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_APP_URL`; dev OTP and simulated payments are refused in production unless `DEMO_MODE=true` is set deliberately | `config.js` |
| Audit | Admin, verification, safety, support, payment-refund, export, config and account actions write `audit_logs` with actor, request id and IP | `lib/audit.js` |
| Logging | Structured JSON with request ids; OTP codes are logged only by the development provider | `lib/logger.js` |
| CSV exports | Formula injection neutralised; exports audited | `services/admin.js` |

## Pre-launch checklist

- [ ] `DEMO_MODE` and `SEED_DEMO` removed from the deployment; seed accounts absent from the database.
- [ ] `OTP_PROVIDER=msg91` with an approved DLT template; `SMS_PROVIDER` and `EMAIL_PROVIDER` configured.
- [ ] `PAYMENTS_PROVIDER=razorpay` with live keys after onboarding approval; webhook URL `https://<host>/api/v1/payments/webhooks/razorpay` registered with the webhook secret.
- [ ] `SESSION_SECRET` generated (≥ 32 random chars) and stored only in the host's secret store.
- [ ] Database backups and point-in-time recovery enabled and a restore rehearsed (see deployment guide).
- [ ] Document storage moved to encrypted object storage with private buckets (see risks).
- [ ] Map tiles from a provider with a production usage agreement (`VITE_MAP_TILE_URL`), and `MAPS_PROVIDER=mapbox` for real routing.
- [ ] Emergency number and wording in `platform_config.safety` re-verified for the launch city.
- [ ] Terms and privacy policy reviewed by a lawyer; cost-sharing caps and fees reviewed against motor-vehicle, aggregator, tax and insurance rules.
- [ ] Admin and support accounts granted individually; no shared logins.
- [ ] Dependency audit run on the production dependency set (`npm audit --omit=dev` in `backend/`).

## Known risks and limitations

1. **Single-instance assumptions.** Rate limits and the WebSocket hub are in memory. With more than one server instance, move rate limits to Redis and bridge realtime events through Redis pub/sub or Postgres `LISTEN/NOTIFY`. Background tasks are already safe across instances (advisory locks).
2. **Document storage on local disk.** Fine for development; on hosts with ephemeral disks (Render free tier) uploads are lost on redeploy. Use S3/GCS with server-side encryption behind the same `storage` interface.
3. **No malware scanning** of uploaded files beyond signature checks.
4. **Manual verification only.** Reviewers look at documents; there is no government ID API or background check, and the product says so.
5. **Demo mode.** With `DEMO_MODE=true`, anyone can sign in as any number because codes appear on screen. Only for demos with fictional data.
6. **Development tooling advisories.** `npm audit` in the frontend reports issues in Vite/esbuild's development server and test tooling. They do not ship to users; the dev server is bound to `localhost`.
7. **Gender for women-only rides is self-declared**, not verified.
8. **Account deletion keeps anonymised booking and payment records**; confirm the retention period against legal requirements.
9. **CSP allows inline styles** (`style-src 'unsafe-inline'`), needed by the map library and React style attributes.
