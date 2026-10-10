import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { finishConnect, QboError } from "@/lib/quickbooks";
import { STATE_COOKIE } from "../handle";

// Intuit redirects here after you sign in to QuickBooks and approve the link.
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(`${url.origin}/money?quickbooks=${encodeURIComponent(result)}`, 303);
  if (!signedIn(req)) return Response.redirect(`${url.origin}/login`, 303);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/quickbooks" });
  const state = url.searchParams.get("state");
  if (!expected || state !== expected) return back("expired");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (!code || !realmId) return back("cancelled");
  try {
    await finishConnect(url.origin, code, realmId);
    return back("connected");
  } catch (e) {
    if (!(e instanceof QboError)) console.error("quickbooks callback", e);
    return back(e instanceof QboError ? e.message : "failed");
  }
}
