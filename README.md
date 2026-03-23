# RidesApp

Internal ride sharing MVP for Critical TechWorks.

## Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript
- PostgreSQL
- Prisma ORM
- Express sessions stored in PostgreSQL

## MVP features

- Profile creation with email and password support
- Public landing page with separate login and signup pages
- Signed-in dashboard with navigation tiles for create ride, search rides, and my rides
- Profile editing for name, email, phone, default car, office, and home
- Driver ride publishing with route, time window, car, and available seats
- Ride search with filters for driver, start point, end point, and open seats
- Seat requests for passengers
- Passenger approval or rejection by drivers
- Simple ride chat for drivers and passengers with pending or accepted requests

## Run locally

1. Install dependencies:
	- `npm install`
2. Create the PostgreSQL user and database:
	- `sudo -u postgres psql`
	- `CREATE USER ridesapp WITH PASSWORD 'ridesapp';`
	- `ALTER USER ridesapp CREATEDB;`
	- `CREATE DATABASE ridesapp OWNER ridesapp;`
	- `\q`
3. Configure your environment:
	- copy `.env.example` to `.env` if needed
	- verify `DATABASE_URL`, `SESSION_SECRET`, `MANAGER_EMAILS`, and `LOG_LEVEL`
4. Make sure PostgreSQL is running.
5. Apply the database schema:
	- `npx prisma migrate dev`
6. Start the app:
	- `npm start`
7. Open:
	- `http://localhost:3000`

## Main files

- [src/app.js](src/app.js) — Express server and API routes
- [src/store.js](src/store.js) — Prisma-backed data access layer
- [prisma/schema.prisma](prisma/schema.prisma) — Database schema
- [public/index.html](public/index.html) — Public landing page
- [public/dashboard.html](public/dashboard.html) — Signed-in app landing page
- [public/app.js](public/app.js) — Shared multipage frontend logic
- [public/styles.css](public/styles.css) — Styling

## Notes

- Authentication uses server-side sessions.
- Authentication state is checked through `/api/auth/me` and cleared through `/api/auth/logout`.
- Old rides are cleaned up in the database layer instead of mutating a JSON file.
- The default local database setup expects the `ridesapp` PostgreSQL user, password, and database names shown above.

## Logging

- The server writes structured JSON logs to stdout and stderr.
- Set `LOG_LEVEL` in `.env` to `error`, `warn`, `info`, or `debug`.
- Local testing: run `npm start` or `npm run dev` and inspect the terminal output.
- Deployed environments: inspect the runtime logs from your hosting provider or process manager.
- Logged events include request completion, request failures, signup/login outcomes, profile updates, ride creation, seat request changes, and ride chat activity.
