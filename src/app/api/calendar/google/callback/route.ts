import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { CalendarError, finishGoogle } from "@/lib/calendar";

const STATE = "gcal_state";
const VERIFIER = "gcal_pkce";

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(`${url.origin}/calendar?google=${encodeURIComponent(result)}`, 303);
  if (!signedIn(req)) return Response.redirect(`${url.origin}/login`, 303);
  const jar = await cookies();
  const expected = jar.get(STATE)?.value;
  const verifier = jar.get(VERIFIER)?.value;
  jar.delete({ name: STATE, path: "/api/calendar/google" });
  jar.delete({ name: VERIFIER, path: "/api/calendar/google" });
  if (!expected || !verifier || url.searchParams.get("state") !== expected) return back("expired");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");
  try {
    await finishGoogle(url.origin, code, verifier);
    return back("connected");
  } catch (e) {
    if (!(e instanceof CalendarError)) console.error("google calendar callback", (e as Error)?.name ?? "error");
    return back(e instanceof CalendarError ? e.message : "failed");
  }
}
