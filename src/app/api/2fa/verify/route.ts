import { cookies } from "next/headers";
import { SESSION_COOKIE, cookieOptions, correctCode, sessionToken, setupSession } from "@/lib/auth";
import { sameOrigin } from "@/lib/plaid-server";

// Finishes setting up the authenticator: a correct code upgrades this device to a full session.
export async function POST(req: Request) {
  const jar = await cookies();
  if (!sameOrigin(req) || !setupSession(jar.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  const { code } = (await req.json().catch(() => ({}))) as { code?: unknown };
  if (!correctCode(code)) {
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ error: "That code isn't right. Check that you scanned the code above, then try the newest one." }, { status: 401 });
  }
  jar.set(SESSION_COOKIE, sessionToken("full"), cookieOptions());
  return Response.json({ ok: true });
}
