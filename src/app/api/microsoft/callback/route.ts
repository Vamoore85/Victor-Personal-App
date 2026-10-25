import { cookies } from "next/headers";
import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";
import { finishConnect, MicrosoftError } from "@/lib/microsoft";
import { STATE_COOKIE, TEAMS_COOKIE, VERIFIER_COOKIE } from "../handle";

// Microsoft redirects here after you approve (or cancel) on its consent screen.
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(`${url.origin}/calendar?microsoft=${encodeURIComponent(result)}`, 303);
  if (!signedIn(req)) return Response.redirect(`${url.origin}/login`, 303);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  const teams = jar.get(TEAMS_COOKIE)?.value === "1";
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, TEAMS_COOKIE]) jar.delete({ name, path: "/api/microsoft" });
  if (!expected || !verifier || url.searchParams.get("state") !== expected) return back("expired");
  const error = url.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : /admin/i.test(url.searchParams.get("error_description") ?? "") ? "needs-admin" : "cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");
  try {
    await finishConnect(url.origin, code, verifier, teams);
    return back(teams ? "teams-connected" : "connected");
  } catch (e) {
    if (!(e instanceof MicrosoftError)) console.error("microsoft callback", (e as Error)?.name ?? "error");
    return back(e instanceof MicrosoftError ? e.message : "failed");
  }
}
