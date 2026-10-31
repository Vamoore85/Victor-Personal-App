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
