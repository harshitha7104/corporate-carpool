# API

Base path `/api/v1`. The complete list of operations, with sign-in and permission requirements, is in [`openapi.json`](openapi.json), generated from the route file by `npm run openapi` in `backend/`. Validation rules are the Zod schemas in `backend/src/services/*`.

## Conventions

- **Auth.** `POST /auth/otp/verify` sets an `HttpOnly; SameSite=Lax` cookie `gw_session` (`Secure` in production). Every route after the auth section requires it. `GET /auth/session` always returns 200 with `{ user: Me | null }`.
- **CSRF.** Non-GET requests must send an `Origin` (or `Referer`) matching the site, `PUBLIC_APP_URL` or `ALLOWED_ORIGINS`. Webhooks are exempt and verified by signature instead.
- **Errors.** Always `{ "error": { "code": "…", "message": "human readable", "details"?: … } }`. Codes used: `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, domain codes 409 (`seats_unavailable`, `already_booked`, `invalid_transition`, `booking_closed`, …), `validation_failed` 422 (`details` is `[{ field, message }]`), `rate_limited` 429, `internal` 500 (with `requestId`).
- **Object access.** Records you can't see return **404**, not 403, so IDs can't be probed.
- **Idempotency.** `POST /rides/{id}/bookings` and `POST /payments/checkout` require an `Idempotency-Key` header (8–100 chars). Repeating a request with the same key returns the original result (HTTP 200) instead of creating another.
- **Pagination.** `limit` (1–100, default 20) and `offset`.
- **Money.** Integer paise (`…Paise`). **Times.** ISO 8601 UTC; dates `YYYY-MM-DD` in IST.
- **Correlation.** Every response has `X-Request-Id`; send your own to trace a request through the logs.
- **Realtime.** `GET /ws` upgrades to a WebSocket authenticated by the same cookie. The server pushes `notification`, `booking.updated` and `message` to `user:<id>`. Send `{"type":"subscribe","channel":"ride:<id>"}` to receive `ride.status`, `location` and `location.sharing` for a ride you drive or have a confirmed seat on.

## Key requests

### Sign in
```http
POST /api/v1/auth/otp/request
{ "channel": "sms", "phone": "98450 12345" }      // or { "channel": "email", "email": "…" }
→ 200 { "challengeId": "uuid", "expiresInSeconds": 600, "devCode"?: "123456" }   // devCode only with OTP_PROVIDER=dev

POST /api/v1/auth/otp/verify
{ "challengeId": "uuid", "code": "123456" }
→ 200 { "isNew": true } + Set-Cookie
```
Limits: 30 s between codes to one destination, 5 codes per destination per hour, 10 per IP per 15 minutes, 5 wrong attempts per code.

### Publish a ride (driver)
```http
POST /api/v1/rides
{
  "vehicleId": "uuid",
  "origin": { "label": "HSR Layout", "lat": 12.9116, "lng": 77.6474 },
  "destination": { "label": "Ecoworld", "lat": 12.9259, "lng": 77.6815 },
  "stops": [],
  "departureAt": "2026-10-22T03:00:00Z",
  "seatsTotal": 3,
  "pricePerSeatPaise": 4500,
  "bookingMode": "instant" | "request",
  "bookingCutoffMinutes": 30,
  "womenOnly": false,
  "luggage": "small",
  "notes": "…",
  "preferences": { "ac": true },
  "publish": true
}
```
Rules: departure 15 minutes to 60 days ahead; all points inside the service area; seats ≤ vehicle seats; contribution ≤ the cost-sharing cap returned by `POST /rides/preview`; `publish: true` needs verified ID, licence and vehicle (`403` otherwise; drafts are allowed).

### Search
```http
GET /api/v1/rides/search?fromLat&fromLng&toLat&toLng&date=YYYY-MM-DD&time=HH:MM&flexMinutes&seats&maxPricePaise&verifiedOnly&instantOnly&womenOnly&sort=best|earliest|cheapest
```
Each result has a `match` object: `score` (0–1), its `parts`, pickup/drop-off distance from the route, shared distance, estimated detour and estimated pickup/drop-off times. `ranking.explanation` and `ranking.weights` describe the order; `routesAreEstimates` is true when no live routing provider is configured.

### Book
```http
POST /api/v1/rides/{rideId}/bookings
Idempotency-Key: 6f9d…
{ "seats": 1, "pickup": {label,lat,lng}, "dropoff": {label,lat,lng}, "message"?: "…" }
→ 201 Booking   (200 when replayed)
```
Instant rides return `ACCEPTED` (seat held, pay within the window) or `CONFIRMED` when free; request-to-book rides return `REQUESTED`.

### Booking lifecycle
| Endpoint | Who | Transition |
| --- | --- | --- |
| `POST /bookings/{id}/accept` | driver | REQUESTED → ACCEPTED (holds seats; → CONFIRMED if nothing to pay) |
| `POST /bookings/{id}/reject` | driver | REQUESTED → REJECTED |
| `POST /payments/checkout` + provider | system | ACCEPTED → CONFIRMED, only on a verified webhook or Razorpay signature |
| `POST /bookings/{id}/cancel` | passenger | REQUESTED/ACCEPTED/CONFIRMED → CANCELLED_BY_PASSENGER (policy refund) |
| `POST /bookings/{id}/driver-cancel` | driver | → CANCELLED_BY_DRIVER (full refund) |
| `POST /rides/{id}/start` | driver | ride → in_progress; unpaid/unanswered bookings → EXPIRED |
| `POST /bookings/{id}/pickup` | driver | CONFIRMED → IN_PROGRESS |
| `POST /bookings/{id}/no-show` | driver | CONFIRMED → NO_SHOW (after departure time) |
| `POST /bookings/{id}/complete`, `POST /rides/{id}/complete` | driver | IN_PROGRESS → COMPLETED |
| `POST /bookings/{id}/dispute` | either | IN_PROGRESS/COMPLETED/NO_SHOW → DISPUTED (opens an escalated ticket) |
| `POST /admin/disputes/{id}/resolve` | admin | DISPUTED → COMPLETED/NO_SHOW/CANCELLED_BY_DRIVER, optional refund % |
| worker | system | REQUESTED/ACCEPTED past `expires_at` → EXPIRED |

The full table of legal transitions is `TRANSITIONS` in `backend/src/services/bookingState.js`.

### Payments
```http
POST /api/v1/payments/checkout     Idempotency-Key: …   { "bookingId": "uuid" }
→ 201 { payment, checkout: { type: "simulated" | "razorpay", orderId, keyId?, amountPaise } }
POST /api/v1/payments/{id}/simulate   { "outcome": "success" | "failure" }   // simulated provider only
POST /api/v1/payments/{id}/verify     { "razorpayPaymentId", "razorpaySignature" }   // razorpay only
POST /api/v1/payments/webhooks/{provider}   (raw body, signature header)
```

### Configuration (admin)
`PUT /admin/config/{key}` with the full object for `fees`, `pricing`, `cancellation`, `booking`, `matching`, `service_area`, `safety` or `features`. Each is validated (`SETTING_SCHEMAS` in `backend/src/services/settings.js`) and audited with before/after values.
