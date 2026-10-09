import { cookies } from "next/headers";
import { SESSION_COOKIE, codeRequired, cookieOptions, correctCode, correctPassword, passwordSet, sessionToken, setupOpen } from "@/lib/auth";

const slow = () => new Promise((r) => setTimeout(r, 800)); // slow down guessing

// Step 1: the password. Step 2: the password again plus the authenticator code.
export async function POST(req: Request) {
  if (!passwordSet()) return Response.json({ error: "No password has been set for this site yet." }, { status: 503 });
  const { password, code } = (await req.json().catch(() => ({}))) as { password?: unknown; code?: unknown };
  if (!correctPassword(password)) {
    await slow();
    return Response.json({ error: "That password isn't right." }, { status: 401 });
  }
  if (!codeRequired()) {
    (await cookies()).set(SESSION_COOKIE, sessionToken("full"), cookieOptions());
    return Response.json({ ok: true });
  }
  if (code === undefined || code === "") {
    if (!setupOpen()) return Response.json({ needCode: true });
    (await cookies()).set(SESSION_COOKIE, sessionToken("password"), cookieOptions());
    return Response.json({ setup: true });
  }
  if (!correctCode(code)) {
    await slow();
    return Response.json({ error: "That code isn't right. Use the newest code in your authenticator app." }, { status: 401 });
  }
  (await cookies()).set(SESSION_COOKIE, sessionToken("full"), cookieOptions());
  return Response.json({ ok: true });
}
