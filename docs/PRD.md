# Green Way — Product Requirements

Green Way is a carpooling platform for Bengaluru. Drivers with empty seats publish trips they are already making; passengers travelling the same way book a seat and share the running cost. The product competes on three things: commuter-grade matching (route overlap, not just nearby endpoints), recurring office commutes, and visible trust and safety controls.

## Users

| Role | Who | Core jobs |
| --- | --- | --- |
| Passenger | Office commuters, students, occasional travellers | Find a compatible ride, book a seat, pay their share, travel safely, review |
| Driver | Car owners commuting anyway | Verify identity and vehicle, publish one-time or recurring rides, approve passengers, run the trip, see contributions |
| Administrator | Green Way operations staff | Verify drivers and vehicles, monitor rides, bookings and payments, handle reports, suspend accounts, configure rules |
| Support operator | Green Way support staff | Work assigned tickets with only the data each case needs, escalate safety and payment issues |

Everyone starts as a passenger. Becoming a driver adds the driver role. Admin and support roles are granted by an administrator and are audited.

## Scope for the pilot

In scope:

- Phone OTP sign-in for Indian mobile numbers (+91, 10 digits starting 6–9); email OTP as an alternative. No passwords.
- Profiles, trusted contacts, saved places, notification preferences, account deactivation and deletion.
- Verification pipeline with explicit states (not submitted, pending review, verified, rejected, needs more information, expired) for government ID, driving licence and vehicles, reviewed manually by admins. Documents stored privately and downloadable only through short-lived signed links.
- Vehicles with capacity and document review.
- Ride creation with pickup, drop-off, intermediate stops, departure time, seats, luggage, preferences, booking cutoff, instant or request-to-book, and a suggested contribution based on distance with a configurable cap.
- Recurring commutes (selected weekdays, date range, skip dates) generating one ride per date, idempotently, in Asia/Kolkata time.
- Search by origin, destination, date and time window, seats, maximum price, verified drivers only, instant booking only, women-only rides. Results ranked by a transparent, configurable match score and shown on a map and list.
- Booking state machine `REQUESTED → ACCEPTED → CONFIRMED → IN_PROGRESS → COMPLETED` plus `REJECTED`, `CANCELLED_BY_PASSENGER`, `CANCELLED_BY_DRIVER`, `EXPIRED`, `NO_SHOW`, `DISPUTED`, enforced server-side with transactional, concurrency-safe seat inventory and idempotency keys.
- Payments in integer paise behind a provider interface: a clearly labelled simulated provider for development and a Razorpay adapter (order creation, signature and webhook verification) that activates when credentials are configured. Refunds follow the configurable cancellation policy.
- In-app notifications for every booking, ride, payment, verification and support event; email and SMS through pluggable providers, with a development log provider that never reports delivery.
- Booking-scoped in-app chat; phone numbers are never shown to the other party.
- Live trip: driver location sharing that requires explicit consent, works only while the ride is in progress, is rate-limited, shows staleness, and is purged after a retention period. Trip-share links with expiry and revocation.
- Safety reports, blocking, no-show handling, emergency guidance (India's 112), support tickets with internal notes and escalation.
- Admin console: metrics, users, verification queues, rides and bookings, safety incidents, disputes, payments and refunds, platform configuration, audit logs, CSV exports, system health.

Out of scope for the pilot (documented, not faked):

- Live turn-by-turn routing and geocoding without a Mapbox or Google key. The development map provider uses a gazetteer of Bengaluru localities and labels every distance and duration as an estimate.
- Real SMS, WhatsApp or email delivery without provider credentials.
- Real money movement without Razorpay onboarding approval.
- Automated background checks or government ID verification APIs. Verification is a manual review of uploaded documents and is described as such.
- Insurance, regulatory approval and commercial-transport licensing. The product talks about cost sharing, caps contributions, and does not claim compliance.

## Success metrics

Defined precisely in `docs/metrics.md`: registered users, verified drivers, rides published, booking requests, acceptance rate, completed rides, cancellation rate, search-to-booking conversion, average seats used, recurring commute adoption, contribution volume, safety and support incidents, payment failures. Demo seed data is excluded by default.

## Assumptions

- One city (Bengaluru) with a configurable service area (centre and radius).
- Contribution is per seat, capped at a configurable multiple of the distance-based suggestion, to keep the service a cost-sharing arrangement rather than a hire service. This needs legal review before launch.
- Single-region modular monolith on Node.js and PostgreSQL; no microservices.
