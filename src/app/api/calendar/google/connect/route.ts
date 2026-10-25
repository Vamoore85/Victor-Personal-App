import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { googleAuthorizeUrl, googleKeys } from "@/lib/calendar";

const STATE = "gcal_state";
const VERIFIER = "gcal_pkce";

// Sends the browser to Google's consent screen asking only to read calendars.
export async function GET(req: Request) {
  await connection();
  const origin = new URL(req.url).origin;
  if (!signedIn(req)) return Response.redirect(`${origin}/login`, 303);
  const keys = await googleKeys().catch(() => null);
  if (!keys) return Response.redirect(`${origin}/calendar?google=nokeys`, 303);
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const jar = await cookies();
  const opts = { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax" as const, path: "/api/calendar/google", maxAge: 600 };
  jar.set(STATE, state, opts);
  jar.set(VERIFIER, verifier, opts);
  return Response.redirect(googleAuthorizeUrl(keys, origin, state, verifier), 303);
}
