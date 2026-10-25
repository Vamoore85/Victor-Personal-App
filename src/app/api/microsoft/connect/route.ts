import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { authorizeUrl, getKeys } from "@/lib/microsoft";
import { STATE_COOKIE, TEAMS_COOKIE, VERIFIER_COOKIE } from "../handle";

// Sends the browser to Microsoft's own sign-in and consent screen for Gladiator's account.
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  if (!signedIn(req)) return Response.redirect(`${url.origin}/login`, 303);
  const keys = await getKeys().catch(() => null);
  if (!keys) return Response.redirect(`${url.origin}/calendar?microsoft=nokeys`, 303);
  const teams = url.searchParams.get("teams") === "1";
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const jar = await cookies();
  const opts = { httpOnly: true, secure: url.origin.startsWith("https"), sameSite: "lax" as const, path: "/api/microsoft", maxAge: 600 };
  jar.set(STATE_COOKIE, state, opts);
  jar.set(VERIFIER_COOKIE, verifier, opts);
  jar.set(TEAMS_COOKIE, teams ? "1" : "0", opts);
  return Response.redirect(authorizeUrl(keys, url.origin, state, verifier, teams), 303);
}
