import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_DAYS, correctPassword, passwordSet, sessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  if (!passwordSet()) return Response.json({ error: "No password has been set for this site yet." }, { status: 503 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!correctPassword(password)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return Response.json({ error: "That password isn't right." }, { status: 401 });
  }
  (await cookies()).set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return Response.json({ ok: true });
}
