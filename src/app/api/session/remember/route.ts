import { cookies } from "next/headers";
import { REMEMBER_DAYS, SESSION_COOKIE, cookieOptions, fullSession, rememberedSessionToken } from "@/lib/auth";
import { deviceStatus, mayRememberDevice } from "@/lib/remember-device";

const privateHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!fullSession(cookie)) return Response.json({ error: "Finish signing in first." }, { status: 401, headers: privateHeaders });
  return Response.json(deviceStatus(cookie), { headers: privateHeaders });
}

export async function POST(req: Request) {
  const jar = await cookies();
  if (!mayRememberDevice(req, jar.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Finish signing in on this browser first." }, { status: 403, headers: privateHeaders });
  }
  const body = await req.json().catch(() => null);
  if (body?.remember !== true || Object.keys(body).length !== 1) {
    return Response.json({ error: "Choose Remember this Mac to continue." }, { status: 400, headers: privateHeaders });
  }
  const token = rememberedSessionToken();
  jar.set(SESSION_COOKIE, token, cookieOptions(REMEMBER_DAYS));
  return Response.json(deviceStatus(token), { headers: privateHeaders });
}
