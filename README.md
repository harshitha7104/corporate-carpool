# Green Way

Carpooling for Bengaluru. Drivers publish trips they're already making; passengers going the same way book a seat and share the running cost. The app covers passengers, drivers, admins and support operators: OTP sign-in, document verification, route matching, request-to-book and instant booking, payments, live trips, safety tools, recurring commutes and an admin console.

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Hook Form + Zod, Leaflet (`front-end/carpool`)
- **Backend:** Node.js 22+, Express 5, PostgreSQL, Zod, WebSockets, an in-process worker (`backend`)
- **Docs:** `docs/` (requirements, architecture, database, API, metrics, security, testing, deployment, verification matrix)

## Run it locally

You need Node.js 22.12 or newer. You don't need PostgreSQL or Docker: in development the backend starts a real embedded PostgreSQL server (downloaded on first run) and fills it with fictional demo data.

Fastest way (one server, optimised build, http://localhost:4000):

```bash
npm run setup   # once: installs backend and frontend packages
npm start       # builds the web app, then starts the API serving it
```

For working on the code with instant reload, use two terminals instead: `npm run dev:api` (API on :4000) and `npm run dev:web` (web app on http://localhost:5173).

Open the app and sign in with any demo number below. In development the sign-in code appears on screen; nothing is texted.

| Role | Number | Name |
| --- | --- | --- |
| Admin | 99000 00001 | Asha Rao |
| Support operator | 99000 00002 | Ravi Kumar |
| Drivers (verified) | 99000 00101 – 99000 00108 | Arjun, Priya, Rahul, Sneha, Vikram, Ananya, Karthik, Meera |
| Driver awaiting review | 99000 00109 | Rohan Das |
| Passengers | 99000 00201 – 99000 00203 | Divya, Aditya, Kavya |

Any other Indian mobile number creates a new account. All demo people, cars, rides and reviews are fictional and tagged "Demo" in the app. Seed accounts exist only when the database is seeded; never seed production.

Useful commands (in `backend/`):

| Command | What it does |
| --- | --- |
| `npm run db:reset` | Delete the local embedded database and uploads; the next start re-creates and re-seeds them |
| `npm run migrate` | Apply migrations (also runs on every start) |
| `npm run seed` | Seed an empty database with demo data |
| `npm run openapi` | Regenerate `docs/openapi.json` from the routes |

To use your own PostgreSQL, set `DATABASE_URL` in `backend/.env` (see `backend/.env.example`).

## What's real and what's simulated in development

| Area | Development | Production |
| --- | --- | --- |
| Sign-in codes | Shown on screen and in the server log | MSG91 SMS or email (required) |
| Payments | Simulated checkout, labelled "no real money moves", confirmed through signed webhooks | Razorpay |
| Maps and routing | Bengaluru locality list; distances and times labelled as estimates | Mapbox when configured |
| SMS, email | Logged, recorded as "logged (dev)", never as "sent" | MSG91, Resend |
| Documents | Private local folder, 5-minute signed links | Object storage recommended |

## Tests

```bash
cd backend && npm test                      # 66 API and service tests on throwaway PostgreSQL
cd front-end/carpool && npm test            # frontend unit tests
cd front-end/carpool && npm run typecheck   # TypeScript
cd front-end/carpool && npx playwright test # 6 browser journeys in Chrome on a fresh database
```

Details in `docs/testing.md`.

## Deploy

- **Render:** `render.yaml` creates a web service and a PostgreSQL database. As committed it is a clearly labelled demo deployment. See `docs/deployment.md` for switching to real providers.
- **Docker:** `docker compose up --build` runs the app with its own PostgreSQL on http://localhost:4000.

Before a real pilot, work through the checklist in `docs/security.md`. That includes legal review of the cost-sharing caps, terms and privacy policy. Green Way does not claim regulatory compliance, insurance or background checks.

## Contact

harshitha71004@gmail.com · +91 88674 76254
