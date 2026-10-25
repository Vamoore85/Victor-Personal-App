import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { finishConnect, GmailError } from "@/lib/gmail";
import { STATE_COOKIE, VERIFIER_COOKIE } from "../handle";

// Google redirects here after you approve (or cancel) on its consent screen.
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(`${url.origin}/email-bills?gmail=${encodeURIComponent(result)}`, 303);
  if (!signedIn(req)) return Response.redirect(`${url.origin}/login`, 303);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/gmail" });
  jar.delete({ name: VERIFIER_COOKIE, path: "/api/gmail" });
  if (!expected || !verifier || url.searchParams.get("state") !== expected) return back("expired");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");
  try {
    await finishConnect(url.origin, code, verifier);
    return back("connected");
  } catch (e) {
    if (!(e instanceof GmailError)) console.error("gmail callback", (e as Error)?.name ?? "error");
    return back(e instanceof GmailError ? e.message : "failed");
  }
}
