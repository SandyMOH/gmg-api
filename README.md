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
│   ├── arloClient.js         Arlo API — OAuth + fetching registrations
│   ├── wpClient.js           WordPress REST API — create/update applicator posts
│   ├── geocoder.js           Google geocoding — address to lat/lng
│   ├── processor.js          Core Arlo registration processing
│   ├── registrationHandler.js Webhook registration handler
│   ├── syncRunner.js         Bulk sync runner
│   ├── db.js                 MySQL — applicants, submissions, reviewer tokens
│   ├── auth.js               HMAC-signed session tokens (24h)
│   ├── clients.js            Shared Arlo/WP/geocoder instances
│   ├── emailSender.js        Emails — congrats, fail, rejection, reviewer notify, error alerts
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
API_SECRET=                   # Header secret for /api/applicants routes
REVIEWER_PASSWORD=            # Reviewer login password
SESSION_SECRET=               # Min 32 chars — signs session cookies

# Email (Microsoft 365 SMTP)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=
REVIEWER_EMAIL=               # Who gets notified when an application is submitted
ADMIN_EMAIL=                  # Who gets pipeline error alerts
ERROR_ALERT_EMAIL_ENABLED=false # Set to true to send error alert emails (alerts are always logged)
REVIEWER_TOKEN_EXPIRY_DAYS=7

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
| `POST` | `/webhook` | — | Receives Arlo webhook events |
| `GET` | `/api/webhook/history` | — | Last 20 webhook events (`?limit=N`) |

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

Body: `multipart/form-data` with `file`, `submissionId`, `fileType` (`image` or `video`).

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
`x-api-secret: <API_SECRET>` for machine-to-machine access from the frontend.

**Reviewer tokens** — single-use, time-limited (default 7 days, set by
`REVIEWER_TOKEN_EXPIRY_DAYS`) tokens emailed to the reviewer when an applicant submits.
Stored in the `reviewer_tokens` table.

## Database Schema

Three tables, auto-created on startup:

```
applicants        — one row per Arlo registrant
  id, arlo_registration_id, license_number, certification_date,
  name, email, phone_number, company, address, suburb, city, state, post_code, country

submissions       — one per applicant (reset on rejection, new code issued)
  id, applicant_id, unique_code, image_url, video_url,
  status (pending | submitted | approved | rejected),
  consent_directory_listing, reviewer_notes, submitted_at, reviewed_at

reviewer_tokens   — time-limited tokens sent via email to reviewer
  id, token, submission_id, expires_at
```

License numbers follow the format `GMG-TXR-YYYY-NNNN` (sequential within the year).

## Deploying

The server is designed to run on Hostinger behind a process manager:

```bash
pm2 start index.js --name gmg-api
pm2 save
```

Set `NODE_ENV=production` in `.env` — this disables the `/tests` routes and enables
secure cookies.

Register the Arlo webhook URL: `https://api.thermal-xr.com/webhook`

For local testing, expose via ngrok:
```bash
ngrok http 3000
# Register: https://your-ngrok-url.ngrok-free.dev/webhook
```

## File Storage

Controlled by `STORAGE_MODE` in `.env`:

- `local` — saves to `uploads/<applicantFolder>/` and serves via `/uploads/*`. Use for development.
- `sharepoint` — Microsoft Graph API upload (placeholder — configure `SHAREPOINT_SITE_ID` and `SHAREPOINT_DRIVE_ID` when ready).
