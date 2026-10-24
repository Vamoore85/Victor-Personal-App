import { connection } from "next/server";

// Which build the server is running, so an open tab can tell it's out of date.
export async function GET() {
  await connection(); // answered fresh each time, never prerendered
  return Response.json({ build: process.env.VERCEL_GIT_COMMIT_SHA || "dev" }, { headers: { "Cache-Control": "no-store" } });
}
