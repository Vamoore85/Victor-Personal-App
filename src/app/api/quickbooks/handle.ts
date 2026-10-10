export const STATE_COOKIE = "qbo_state";

import { sameOrigin, signedIn } from "@/lib/plaid-server";
import { QboError } from "@/lib/quickbooks";

/** Signed-in, same-site JSON calls, with plain-English errors. */
export function handle(fn: (body: Record<string, unknown>, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
    try {
      const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
      return Response.json(await fn(body, req));
    } catch (e) {
      if (!(e instanceof QboError)) console.error("quickbooks", e);
      const err = e instanceof QboError ? e : new QboError("Something went wrong talking to QuickBooks.", 500);
      return Response.json({ error: err.message }, { status: err.status });
    }
  };
}
