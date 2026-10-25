import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { authorizeUrl, getKeys } from "@/lib/gmail";
import { STATE_COOKIE, VERIFIER_COOKIE } from "../handle";

// Sends the browser to Google's own consent screen. Google sends it back to /callback.
export async function GET(req: Request) {
  await connection();
  const origin = new URL(req.url).origin;
  if (!signedIn(req)) return Response.redirect(`${origin}/login`, 303);
  const keys = await getKeys().catch(() => null);
  if (!keys) return Response.redirect(`${origin}/email-bills?gmail=nokeys`, 303);
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const jar = await cookies();
  const opts = { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax" as const, path: "/api/gmail", maxAge: 600 };
  jar.set(STATE_COOKIE, state, opts);
  jar.set(VERIFIER_COOKIE, verifier, opts);
  return Response.redirect(authorizeUrl(keys, origin, state, verifier), 303);
}
