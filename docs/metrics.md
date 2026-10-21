# Metric definitions

Served by `GET /api/v1/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&includeDemo=false` and shown on the admin overview. The window is inclusive of both days in **Asia/Kolkata**; default is the last 30 days. Demo rows (`is_demo = true`) are excluded unless `includeDemo=true`. Rates return `null` when the denominator is zero, never 0%.

| Metric | Numerator | Denominator | Window applies to | Notes |
| --- | --- | --- | --- | --- |
| Registered users | Users created | — | `users.created_at` | Deleted accounts excluded |
| Active users | Users with status `active` | — | Not windowed | Snapshot |
| Verified drivers | Users whose government ID **and** driving licence are both `verified` and not expired | — | Not windowed | Snapshot |
| Rides published | Rides with `published_at` in window | — | `rides.published_at` | Includes recurring instances |
| Rides completed | Rides with `completed_at` in window | — | `rides.completed_at` | |
| Booking requests | Bookings created | — | `bookings.requested_at` | Includes instant bookings |
| Acceptance rate | Request-to-book bookings that a **driver** moved to ACCEPTED | Request-to-book bookings that reached a decision: accepted, rejected, or expired by the system | `requested_at` | Instant bookings excluded (no decision). Requests the passenger withdrew before a decision are excluded. |
| Cancellation rate | Bookings now CANCELLED_BY_PASSENGER or CANCELLED_BY_DRIVER | Bookings that reached ACCEPTED (have `accepted_at`) | `requested_at` | Broken down by side. Expired and rejected bookings are not cancellations. |
| Search to booking | Booking requests | Searches logged in `search_events` | `created_at` of each | Searches by signed-in members only (all search requires sign-in) |
| Seat utilisation | Seats on COMPLETED bookings | Seats offered | Rides with `completed_at` in window | Average seats per ride = seats used ÷ completed rides |
| Recurring adoption | Rides published from a recurring rule | All rides published | `published_at` | Plus a snapshot of active rules |
| Contribution volume | Sum of captured payment amounts | — | `payments.captured_at` | Also shows refunds on those payments, net, and platform fees |
| Safety reports | Reports filed | — | `safety_reports.created_at` | "Serious" = high or critical severity; "open" = open or investigating |
| Support tickets | Tickets opened / resolved-or-closed | — | `support_tickets.created_at` | |
| Payment failure rate | Payments with status `failed` | All payment attempts (rows) | `payments.created_at` | A retried checkout creates a new attempt |

Search events and support tickets have no demo flag; in a pilot database with seed data they include demo activity. Use a clean production database for real figures.
