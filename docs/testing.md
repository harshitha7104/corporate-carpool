# Testing

All three suites run without installing PostgreSQL: each starts its own throwaway embedded PostgreSQL server. Nothing touches your development database.

| Suite | Command | What it covers |
| --- | --- | --- |
| Backend API and services | `cd backend && npm test` | 66 tests across auth, bookings, rides, verification, payments, commutes, safety, support, admin, and the full journey |
| Frontend unit | `cd front-end/carpool && npm test` | Formatting (₹ from paise, IST time maths, plates) and the sign-in form's validation and error handling |
| Browser end-to-end | `cd front-end/carpool && npx playwright test` | Six journeys in real Chrome against the built app served by a real backend and database, as in production |
| Type check | `cd front-end/carpool && npm run typecheck` | TypeScript strict mode |
| Backend syntax | `cd backend && npm run lint` | Every module parses |

The browser tests use the installed Google Chrome (`channel: "chrome"`); in CI they install it with `npx playwright install --with-deps chrome`.

## What the backend tests prove

- **Auth and permissions:** OTP issue/verify, wrong-code lockout, expiry, reuse, resend gap and hourly limit, Indian-number validation, logout, suspended accounts, CSRF origin check, passengers and support blocked from admin endpoints, admins blocked from self-review and self-suspension.
- **Verification states:** not submitted → pending → needs info → resubmitted → verified → expired; driver role granted on licence approval; vehicle re-verification after a plate change.
- **Ride creation:** departure window, service area, seats vs vehicle, cost-sharing cap, verification gate for publishing, private drafts, route preview labelled as an estimate.
- **Route matching and search:** along-route acceptance, wrong-direction and off-route rejection, ranking by time, filters (instant, women-only, price, seats), blocked drivers hidden, search logging.
- **Seat allocation under concurrency:** 12 passengers racing for 3 instant seats get exactly 3; concurrent accepts on 2 seats accept exactly 2; the DB constraint rejects overselling directly.
- **Duplicate prevention:** concurrent requests with one idempotency key return one booking; a second active booking is refused.
- **State machine:** the full transition table; a complete request-to-book journey with actors recorded; illegal transitions refused; unresolved passengers block completion; unpaid holds expire and release seats.
- **Cancellations and refunds:** full refund in the free window, partial refund late, driver cancellation refunds everyone, no cancellation after start, refunds capped at what was paid.
- **Payments:** idempotent checkout, forged webhooks rejected and recorded, duplicate webhook deliveries processed once, failed payment then retry, money arriving after expiry is refunded automatically, receipts only after capture.
- **Recurring commutes:** one ride per matching weekday at 08:30 IST, re-running the generator creates nothing, skipping a day cancels and refunds, pausing stops generation.
- **Notifications:** development deliveries recorded as "logged", never "sent"; failing providers retried with backoff and marked failed after five attempts.
- **Safety and privacy:** report escalation and blocking, SOS honesty about texts, trip-share links with expiry and revocation, location only with consent and only in progress, rate-limited, IDOR checks on vehicles, places, contacts, files and bookings, signed file links bound to the viewer.
- **Journey (brief §19):** register passenger → create driver and vehicle → submit verification → admin approves → publish → search → request → accept → seat inventory checked → pay → start, share location, pick up, complete → review → driver's contribution summary.

## Results of the last run

Recorded at the end of the build (see the final report): backend 66/66 passed, frontend unit 7/7 passed, browser end-to-end 6/6 passed, TypeScript 0 errors.
