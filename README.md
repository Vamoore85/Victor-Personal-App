# Maverick Personal

Sandbox for a master personal app that manages everything in one place.

Live at https://maverick-personal.vercel.app (Vercel deploys every push to `main`).

## Run it

```bash
npm install
npm run dev   # http://localhost:3000
```

## Stack

Next.js (App Router) + React + TypeScript + Tailwind CSS.

## Layout

- `src/config/app.ts`: app name and the list of life areas on the home page.
- `src/app/`: pages and layout.

## Remember this device

In Settings, open the sign-in page (`/security`) after completing the normal sign-in, then choose **Remember this Mac for 90 days**. This applies to that browser or installed app only. The signed session has a unique random value and a fixed expiry checked on the server as well as a persistent HttpOnly, Secure, SameSite=Lax cookie. It does not copy a session to another browser, skip the first password/authenticator check, or change MFA configuration. Signing out clears it; changing the app password invalidates all sessions. Existing standard sessions remain unchanged until the owner opts in.

Checks: `npm test`; build, then `node --import tsx scripts/remember-device-check.mjs`. The HTTP fixture uses synthetic credentials and port 3298, refuses to stop an existing service, and does not contact any providers. It verifies protected-route access, exact-origin enrollment, MFA preservation, expiry and cookie clearing.

## Financial reports

`/reports` opens a read-only Personal report, with separate Maverick and Gladiator choices and YTD, trailing 12 months, or 30-day periods. It reads saved financial data; refreshing a report does not trigger bank synchronization. Download text, CSV transactions, or a structured JSON report; Print / Save PDF uses the browser's print dialog. Observed coverage and sync warnings accompany totals. Transfers are excluded from income and spending.

Signed-in programs can retrieve the same report from `GET /api/reports?entity=personal&period=ytd&format=json`. Allowed entities: `personal`, `business` (Maverick), `gladiator`; periods: `ytd`, `12m`, `30d`; formats: `json`, `csv`, `txt`. The endpoint uses the existing owner session and same-origin checks, never caches reports, and does not return bank tokens or vault records. It does not add API-key or unattended-agent authentication.

## AA Meetings

`/aa-meetings` tracks recurring meeting plans, attendance and court reports, saved in the private `aa-meetings` cloud document (supporting files in `app_files`). Plans and calendar imports only ever create planned meetings; a meeting counts as attended only when the owner taps **I attended**, and a future meeting can't be marked attended or missed. Edits keep a dated change history, and changing a confirmed meeting's date, time or name clears the answer so it has to be confirmed again.

- **Calendar import:** upload an exported `.ics` file. Time zones, recurring series, moved and cancelled occurrences are honored; importing again adds no duplicates. Live calendar sync (Google or Microsoft OAuth) is not set up.
- **Supporting records:** PDF, JPG, PNG, WebP or HEIC up to 4 MB, checked by content. Each original is stored once under a new id with its SHA-256, which is checked again on every download. Attaching a file never changes the attendance answer and isn't third-party verification.
- **Court report:** `GET /api/aa-meetings/report?from=YYYY-MM-DD&through=YYYY-MM-DD&format=pdf|csv|json` (plus `kinds=AA,IOP`, `topics=1`, `notes=1`), or `format=backup` for the whole tracker as JSON. Only owner-confirmed attendance is listed, marked self-reported, with records referenced by hash. No stamps, signatures or certifications; meeting links and passcodes are withheld; private notes and topics are left out unless chosen. Name, court and case numbers are entered in the app, never stored in Git. Reports are only downloaded, never sent.

Checks: `npm test` covers sign-in and origin checks, planned versus attended, future dates, DST and recurrence exceptions, re-imports, duplicates, edit history, file access and report rows. Nothing here calls a paid AI service.
