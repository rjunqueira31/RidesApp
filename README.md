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
	- verify `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `MANAGER_EMAILS`, and `LOG_LEVEL`
4. Make sure PostgreSQL is running.
5. Apply the database schema:
	- `npx prisma migrate dev`
6. Start the app:
	- `npm start`
7. Open:
	- `http://localhost:3000`

## Deploy on Railway

This app already fits Railway's Node deployment model:

- the server reads `PORT` from the environment
- Prisma uses `DATABASE_URL`
- logs go to stdout/stderr
- production cookies are enabled when `NODE_ENV=production`

Recommended setup:

1. Keep Neon as the database.
	- Use your existing Neon PostgreSQL database instead of creating a new Railway database.
2. Push the latest code to GitHub.
3. In Railway, create a new project and choose `Deploy from GitHub repo`.
4. Select this repository.
5. In the Railway service variables, set:
	- `NODE_ENV=production`
	- `DATABASE_URL=<your Neon connection string>`
	- `SESSION_SECRET=<a long random secret>`
	- `MANAGER_EMAILS=<comma-separated manager emails>`
	- `LOG_LEVEL=info`
6. Railway should detect the app automatically.
	- Install command: `npm install`
	- Start command: `npm start`
7. Before first production use, run migrations in Railway:
	- `npm run db:migrate:deploy`
8. Open the generated Railway domain and verify:
	- login/signup work
	- session persistence works after refresh
	- profile edits save
	- ride creation/search/chat still work
9. After verification, point your custom domain to Railway if needed.

Notes:

- The `postinstall` script runs `prisma generate`, so the Prisma client is regenerated during deployment.
- This app stores Express sessions in PostgreSQL using `connect-pg-simple`, so `DATABASE_URL` must be valid both for Prisma and the session store.
- Because cookies are marked `secure` in production, always test over the Railway HTTPS URL, not plain HTTP.
- If Render is still live, keep it running until you confirm Railway is healthy, then switch DNS and shut Render down.

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

## Production hardening

- `helmet` is enabled for safer default HTTP headers.
- Login and signup are rate limited, and ride publishing has a separate rate limit.
- In production, Express trusts one proxy hop and session cookies are marked `secure`.
- In production, 500 responses return a generic error message instead of surfacing internal server details.
