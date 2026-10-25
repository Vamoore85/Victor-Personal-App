export const STATE_COOKIE = "ms_state";
export const VERIFIER_COOKIE = "ms_pkce";
export const TEAMS_COOKIE = "ms_teams";

import { sameOrigin, signedIn } from "@/lib/plaid-server";
import { MicrosoftError } from "@/lib/microsoft";
import { CalendarError } from "@/lib/calendar";

/** Signed-in, same-site JSON calls, with plain-English errors. Never logs mail, events or messages. */
export function handle(fn: (body: Record<string, unknown>, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
    try {
      const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
      return Response.json(await fn(body, req), { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const known = e instanceof MicrosoftError || e instanceof CalendarError;
      if (!known) console.error("microsoft", (e as Error)?.name ?? "error");
      const err = known ? (e as MicrosoftError) : new MicrosoftError("Something went wrong talking to Microsoft.", 500);
      return Response.json({ error: err.message }, { status: err.status });
    }
  };
}
