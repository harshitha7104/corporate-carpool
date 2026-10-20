# Corporate Carpool

A carpooling web application built with React, Vite, Express, and MongoDB.

## Features

- Account registration and sign-in
- Passwords hashed before storage
- Authenticated ride offers (drivers can offer multiple rides, with optional departure time)
- Browse and search available rides by starting point and destination
- Book a seat on a ride, or cancel a booking (seat counts update atomically; full rides are hidden)
- "My Rides" page: rides you offer (with passenger list, removable) and seats you've booked

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/Signup` | – | Create account `{ user, pwd, email }` |
| POST | `/api/Login` | – | Sign in `{ email, pwd }` → `{ token, user }` |
| GET | `/api/Rides?from=&to=` | optional | List/search rides with free seats |
| POST | `/api/Rides` | yes | Offer a ride |
| DELETE | `/api/Rides/:id` | driver | Remove your ride |
| POST | `/api/Rides/:id/book` | yes | Book a seat |
| DELETE | `/api/Rides/:id/book` | yes | Cancel your booking |
| GET | `/api/MyRides` | yes | Rides you offer and rides you booked |
| GET | `/health` | – | Server + database health |

Authenticated requests send `Authorization: Bearer <token>`.
- Responsive frontend UI
- Backend API with MongoDB integration

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB
- Styling: CSS modules

## Project Structure

```bash
corporate-carpool/
├── backend/
│   ├── app.js
│   ├── package.json
│   └── models/
├── front-end/
│   └── carpool/
│       ├── package.json
│       ├── vite.config.js
│       └── src/
├── README.md
└── .gitignore
```

## Local Development

### 1) Start the backend

```bash
cd backend
npm install
npm start
```

The backend runs on:

```bash
http://localhost:4000
```

### 2) Start the frontend

```bash
cd front-end/carpool
npm install
npm run dev -- --host 0.0.0.0
```

The frontend runs on:

```bash
http://localhost:5173
```

## Deploy on Render

The repository includes a Render Blueprint at `render.yaml`. Create a MongoDB Atlas database first, then create a new Blueprint deployment from this GitHub repository. Add these environment variables when Render prompts:

- `MONGO_URI`: your MongoDB Atlas connection string, including the database name
- `AUTH_SECRET`: a long random secret used to sign login tokens

In MongoDB Atlas, create a database user and allow network access from Render (Atlas network access can be restricted further after deployment). Do not commit either secret to the repository. Render builds the Vite frontend and serves it from the Express service; `/health` checks both the server and database connection.

The hosted app is available at the Render service URL once the deployment and health check succeed. Signup, login, ride offers, and ride searches all use the same hosted database.

## Local Development

For local backend development, MongoDB must be running at `mongodb://127.0.0.1:27017/user`. Start the backend and Vite frontend in separate terminals using the commands above.

## GitHub

Repository:

https://github.com/harshitha7104/corporate-carpool

## License

This project is for educational/demo use.

## Hosted on claude.ai (no server needed)

`npm --prefix front-end/carpool run build:hosted` builds a version of the same frontend that runs as a claude.ai artifact. Instead of the Express API it uses the artifact's built-in shared database (`src/api/hosted.js`), so it needs no MongoDB or Render account. Each person's login is tied to their claude.ai account, and people need at least Contributor access on the artifact to sign up, offer, or book rides.

## Demo rides

`backend/demoData.js` holds 18 sample rides on Bangalore office-commute routes, with prices per seat, driver ratings and weekday departure times in India time. When the ride board is empty, the backend adds them automatically in development, and on Render because `render.yaml` sets `SEED_DEMO=true` (remove that to start with an empty board). Demo rides show a "Demo" tag and can be booked like real ones.
