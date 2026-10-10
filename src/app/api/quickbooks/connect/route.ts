import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { authorizeUrl, getKeys } from "@/lib/quickbooks";
import { STATE_COOKIE } from "../handle";

// Sends the browser to Intuit's sign-in page. Intuit sends it back to /callback.
export async function GET(req: Request) {
  await connection();
  const origin = new URL(req.url).origin;
  if (!signedIn(req)) return Response.redirect(`${origin}/login`, 303);
  const keys = await getKeys().catch(() => null);
  if (!keys) return Response.redirect(`${origin}/money?quickbooks=nokeys`, 303);
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/quickbooks", maxAge: 600 });
  return Response.redirect(authorizeUrl(keys, origin, state), 303);
}
