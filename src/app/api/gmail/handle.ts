export const STATE_COOKIE = "gmail_state";
export const VERIFIER_COOKIE = "gmail_pkce";

import { sameOrigin, signedIn } from "@/lib/plaid-server";
import { GmailError } from "@/lib/gmail";

/** Signed-in, same-site JSON calls, with plain-English errors. Never logs mail contents. */
export function handle(fn: (body: Record<string, unknown>, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
    try {
      const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
      return Response.json(await fn(body, req), { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (!(e instanceof GmailError)) console.error("gmail", (e as Error)?.name ?? "error");
      const err = e instanceof GmailError ? e : new GmailError("Something went wrong talking to Gmail.", 500);
      return Response.json({ error: err.message }, { status: err.status });
    }
  };
}
