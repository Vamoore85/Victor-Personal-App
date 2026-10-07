# Life App (working name)

Sandbox for a master personal app that manages everything in one place.

## Run it

```bash
npm install
npm run dev   # http://localhost:3000
```

## Stack

Next.js (App Router) + React + TypeScript + Tailwind CSS.

## Renaming

The name is a placeholder. To rename:

1. Change `APP_NAME` and `APP_TAGLINE` in `src/config/app.ts`.
2. Change `"name"` in `package.json` (and `package-lock.json`).
3. Rename the folder / repo.

## Layout

- `src/config/app.ts`: app name and the list of life areas on the home page.
- `src/app/`: pages and layout.
