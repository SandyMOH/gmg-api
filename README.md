# GMG API

Integration API for Graphene Manufacturing Group. Connects Arlo (training platform)
to the WordPress certified applicator directory, and manages the full applicant
certification pipeline — from exam pass through photo/video submission to approval.

## What It Does

```
Arlo exam pass
    │
    ├── webhook (real-time) ──┐
    └── bulk sync (on-demand)─┘
                              │
                    Process registration
                    ├── Create applicant record in DB
                    ├── Send congratulations email (with unique submission link)
                    └── On fail → send failure email

Applicant clicks submission link
    └── Uploads photo + video via frontend
    └── Submits application

Reviewer gets notified by email (with time-limited review link)
    ├── Approve → assigns GMG-TXR-YYYY-NNNN license, adds to WordPress directory
    └── Reject  → sends feedback + new submission link to applicant
```

## Project Structure

```
gmg-api/
├── index.js                  Express server entry point
├── sync.js                   Bulk sync (command line)
├── lib/
│   ├── arloClient.js         Arlo API — OAuth, token keep-alive, fetching registrations
│   ├── wpClient.js           WordPress REST API — create/update applicator posts
│   ├── geocoder.js           Google geocoding — address to lat/lng
│   ├── processor.js          Core Arlo registration processing
│   ├── registrationHandler.js Webhook registration handler
│   ├── syncRunner.js         Bulk sync runner
│   ├── db.js                 MySQL — applicants, submissions, reviewer tokens
│   ├── auth.js               HMAC-signed session tokens (24h)
│   ├── clients.js            Shared Arlo/WP/geocoder instances
│   ├── emailSender.js        Emails — congrats, fail, rejection, reviewer notify, error alerts
│   ├── teamsAlert.js         Error alerts to a Microsoft Teams channel
│   ├── logger.js             Dated file logging
│   ├── state.js              In-memory sync/webhook history
│   └── storage.js            File storage (local or SharePoint)
├── routes/
│   ├── system.js             Health, status, logs
│   ├── sync.js               Sync trigger + history
│   ├── arlo.js               Webhook receiver + webhook history
│   ├── applicant.js          Submission management
│   ├── review.js             Approve/reject submissions
│   ├── auth.js               Login, token auth, logout
│   ├── upload.js             Image/video file uploads
│   ├── spraying.js           Direct WP approval (legacy path)
│   └── test.js               Test endpoints (dev only)
├── middleware/
│   ├── apiSecret.js          x-api-secret header guard
│   └── reviewerAuth.js       Cookie session guard
└── logs/                     Dated log files (gmg-api-YYYY-MM-DD.log)
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up MySQL

Create a database and user, then let the app auto-create tables on first start:

```sql
CREATE DATABASE gmg_api;
CREATE USER 'gmg'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON gmg_api.* TO 'gmg'@'localhost';
```

### 3. Configure `.env`

```bash
# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
APP_URL=http://localhost:3000

# Database (MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=gmg
DB_PASSWORD=yourpassword
DB_NAME=gmg_api

# Arlo
ARLO_CLIENT_ID=
ARLO_CLIENT_SECRET=
ARLO_PLATFORM=

# WordPress
WP_URL=https://your-site.com
WP_USERNAME=
WP_APP_PASSWORD=

# Google Maps (Geocoding API enabled)
GOOGLE_MAPS_API_KEY=

# Auth
API_SECRET=                   # Header secret for /api/applicants and /api/arlo/keep-alive
REVIEWER_PASSWORD=            # Reviewer login password
SESSION_SECRET=               # Min 32 chars — signs session cookies

# Email (Microsoft 365 SMTP)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=
REVIEWER_EMAIL=               # Who gets notified when an application is submitted
REVIEWER_TOKEN_EXPIRY_DAYS=7

# Error alerts (always written to the log; see "Error Alerts" below)
TEAMS_WEBHOOK_URL=            # Teams Workflows webhook URL (empty = Teams alerts off)
ERROR_ALERT_EMAIL_ENABLED=false # true = also email alerts to ADMIN_EMAIL
ADMIN_EMAIL=                  # Who gets error alert emails

# Email test mode (sends to EMAIL_TEST_RECIPIENT instead of real applicant)
EMAIL_TEST_MODE=false
EMAIL_TEST_RECIPIENT=

# Email content links
GMG_LOGO_URL=
EMAIL_HEADER_IMAGE_URL=
LINK_PRODUCT=
LINK_DOC_JOBSHEET=
LINK_DOC_CLEANING=

# File storage: "local" (dev) or "sharepoint" (prod)
STORAGE_MODE=local
```

## Running

### Webhook server (primary mode)

```bash
npm start          # production
npm run dev        # dev with nodemon
```

### Bulk sync (one-off CLI)

Preview without changes:
```bash
npm run sync:dry
```

Sync for real:
```bash
npm run sync
```

> The bulk sync writes passed applicants straight to the WordPress directory. It does
> **not** create applicant records or send welcome emails. To re-process a single
> registration through the normal pipeline, replay its webhook instead (see
> [Replaying a registration](#replaying-a-registration)).

## API Endpoints

### System

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Health check + endpoint list |
| `GET` | `/api/status` | — | Uptime, last sync, counters |
| `GET` | `/api/logs` | — | Tail today's log (`?date=YYYY-MM-DD&limit=100`) |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Password login → sets session cookie |
| `POST` | `/api/auth/token` | — | Token auto-login → sets session cookie |
| `POST` | `/api/auth/logout` | — | Clear session cookie |

### Sync

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/syncs` | — | Run full Arlo → WordPress sync |
| `POST` | `/api/syncs/dry` | — | Dry run (no writes) |
| `GET` | `/api/syncs/history` | — | Last 10 sync results (`?limit=N`) |

### Arlo / Webhook

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/arlo/webhook` | — | Receives Arlo webhook events |
| `GET` | `/api/arlo/api/webhook/history` | — | Last 20 webhook events (`?limit=N`) |
| `POST` | `/api/arlo/keep-alive` | API secret | Force an Arlo token refresh (called by the Hostinger cron) |

Webhook history is in memory, so it resets when the server restarts.

### Applicants

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/applicants/code/:code` | — | Lookup submission by unique code (applicant form) |
| `POST` | `/api/applicants/:id/submit` | — | Applicant submits application (requires image + video) |
| `GET` | `/api/applicants` | Reviewer session | List all submissions (`?status=&search=&select=`) |
| `GET` | `/api/applicants/:id` | Reviewer session | Get single submission |

### Uploads

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/uploads` | — | Upload image (10MB max) or video (100MB max) |

Body: `multipart/form-data` with `submissionId`, `fileType` (`image` or `video`), and either
`files` (up to 10 images) or `file` (one video).

### Reviews

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/reviews/:submissionId/approve` | Reviewer session | Approve → assign license, add to WordPress |
| `POST` | `/api/reviews/:submissionId/reject` | Reviewer session | Reject → email applicant with new link |

### Spraying (legacy)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/spraying/approve` | — | Direct WP approval by Arlo registration ID |

## Authentication

**Reviewer session** — log in via `POST /api/auth/login` with `{ password }` or via a
time-limited email token (`POST /api/auth/token`). A signed HMAC cookie is set (24h TTL).

**API secret** — `GET /api/applicants` and related protected routes require the header
`x-api-secret: <API_SECRET>` for machine-to-machine access from the frontend. The
`/api/arlo/keep-alive` endpoint uses the same header.

**Reviewer tokens** — single-use, time-limited (default 7 days, set by
`REVIEWER_TOKEN_EXPIRY_DAYS`) tokens emailed to the reviewer when an applicant submits.
Stored in the `reviewer_tokens` table.

## Database Schema

Five tables, auto-created on startup:

```
applicants        — one row per Arlo registrant
  id, arlo_registration_id, license_number, certification_date,
  name, email, phone_number, company, address, suburb, city, state, post_code, country

submissions       — one per applicant (reset on rejection, new code issued)
  id, applicant_id, unique_code, video_url,
  status (pending | submitted | approved | rejected),
  consent_directory_listing, reviewer_notes, submitted_at, reviewed_at

submission_images — the images uploaded for a submission (multiple per submission)
  id, submission_id, url, filename, created_at

reviewer_tokens   — time-limited tokens sent via email to reviewer
  id, token, submission_id, expires_at

oauth_tokens      — current Arlo refresh token (one row, provider = 'arlo')
  provider, refresh_token, updated_at
```

License numbers follow the format `GMG-TXR-YYYY-NNNN` (sequential within the year).

## Arlo Token

The API talks to Arlo with OAuth. The **refresh token** lives in the `oauth_tokens` table
and expires if it goes unused for about 30 days. Arlo issues a new refresh token on every
refresh, so the old one stops working immediately; the server saves the new one to the
database each time.

### Keep-alive

To keep the token from expiring, the server refreshes it:

- **on startup** (every restart or deploy)
- **daily at 02:00** (in-app cron)
- **daily at 14:00** via a Hostinger cron job, as a backup in case the app was asleep or restarted.
  In hPanel → Advanced → Cron Jobs:
  ```bash
  curl -fsS -X POST -H "x-api-secret: <API_SECRET>" https://api.thermal-xr.com/api/arlo/keep-alive
  ```

Each refresh logs `[ARLO] Keep-alive (startup|cron|external): token refreshed` (or `FAILED`
with Arlo's reason), so `/api/logs` shows whether it's working. `oauth_tokens.updated_at`
should never be more than a day old. If a keep-alive fails, an alert is sent saying how many
days the token has left.

### Re-bootstrapping a dead token

If you get **"Arlo Authentication failed"** (`invalid_grant`), the refresh token is dead
and has to be replaced manually:

1. **Get a new token in Postman.** Authorization → OAuth 2.0, with **Auto-refresh token
   turned off**:
   - Grant type: Authorization Code
   - Auth URL: `https://<ARLO_PLATFORM>.arlo.co/oauth/connect/authorize`
   - Access Token URL: `https://<ARLO_PLATFORM>.arlo.co/oauth/connect/token`
   - Client ID / Secret: the **production** `ARLO_CLIENT_ID` / `ARLO_CLIENT_SECRET`
   - Client Authentication: Send as Basic Auth header

   Click **Get New Access Token**, log in and complete 2FA, then copy the
   **`refresh_token`** (not the `access_token`).

2. **Test it** with the production credentials:
   ```bash
   curl -u "<ARLO_CLIENT_ID>:<ARLO_CLIENT_SECRET>" \
     -d grant_type=refresh_token \
     -d refresh_token=<REFRESH_TOKEN> \
     https://<ARLO_PLATFORM>.arlo.co/oauth/connect/token
   ```
   This uses up the token you pasted. If it returns JSON, use the **new** `refresh_token`
   from the response in the next step. `invalid_grant` means the token is bad;
   `invalid_client` means the credentials are wrong.

3. **Save it** in the production database:
   ```sql
   UPDATE oauth_tokens SET refresh_token = '<NEW_REFRESH_TOKEN>' WHERE provider = 'arlo';
   ```
   No restart is needed; the server reads the token from the database on every refresh.

4. **Replay** any registrations that failed while the token was dead (below).

A refresh token only works with the client ID that issued it. If a token works from your
machine but the server still fails, compare `ARLO_CLIENT_ID` / `ARLO_CLIENT_SECRET` in the
Hostinger environment variables with the ones you used, then restart the app.

### Replaying a registration

To re-run a registration through the webhook pipeline (applicant record + welcome or fail
email), send the same event Arlo sends:

```bash
curl -X POST https://api.thermal-xr.com/api/arlo/webhook \
  -H "Content-Type: application/json" \
  -d '{"events":[{"resourceType":"Registration","type":"Registration.Created","resourceId":"<ARLO_ID>"}]}'
```

Check the result with `GET /api/arlo/api/webhook/history`: the newest entry should show
`"ok": true`. Only replay once. Every successful replay creates a new applicant record
and emails the applicant again. Use curl rather than Postman: Hostinger's CDN blocks
Postman's default User-Agent with a 403.

## Error Alerts

Pipeline errors go through `sendErrorAlert` in `lib/emailSender.js`. Every alert is
written to the log as `[ERROR ALERT] <step>: <reason>`, and then sent to:

| Channel | Enabled when | Format |
|---|---|---|
| Microsoft Teams | `TEAMS_WEBHOOK_URL` is set | Card titled `[Spray Academy] <step> failed` |
| Email | `ERROR_ALERT_EMAIL_ENABLED=true` and `ADMIN_EMAIL` is set | `[ERROR] GMG Pipeline – <step>` |

Each alert contains the **step** that failed, the **reason** (what went wrong and what state
things were left in), and the **affected data** (applicant name, email, Arlo ID, submission
ID, license number, files, etc.).

**Teams setup:** in the channel, open ⋯ → Workflows → *"Post to a channel when a webhook
request is received"*, copy the URL into `TEAMS_WEBHOOK_URL`, and restart the app. To test
locally:

```bash
TEAMS_WEBHOOK_URL="<url>" node -e "require('./lib/emailSender').sendErrorAlert('Test', 'Test alert — please ignore', { arloRegistrationId: '0' })"
```

## Deploying

The server is designed to run on Hostinger behind a process manager:

```bash
pm2 start index.js --name gmg-api
pm2 save
```

Set `NODE_ENV=production` in `.env` — this disables the `/tests` routes and enables
secure cookies.

On Hostinger, environment variables are set in hPanel → Websites → api.thermal-xr.com →
Environment variables. **The app only reads them on startup**, so restart or redeploy after
changing any of them.

Also set up the Hostinger cron job for the Arlo token (see [Keep-alive](#keep-alive)).

Register the Arlo webhook URL: `https://api.thermal-xr.com/api/arlo/webhook`

For local testing, expose via ngrok:
```bash
ngrok http 3000
# Register: https://your-ngrok-url.ngrok-free.dev/api/arlo/webhook
```

Log files are stored in `logs/` on the server and may be cleared by a redeploy.

## File Storage

Controlled by `STORAGE_MODE` in `.env`:

- `local` — saves to `uploads/<applicantFolder>/` and serves via `/uploads/*`. Use for development.
- `sharepoint` — Microsoft Graph API upload (placeholder — configure `SHAREPOINT_SITE_ID` and `SHAREPOINT_DRIVE_ID` when ready).
