import { randomUUID } from "node:crypto";
import { dbConfigured } from "@/lib/db";
import { LinkError, PENDING_MINUTES, startLink, validHash } from "@/lib/wade-link";
import { updateLinks } from "@/lib/wade-link-store";

// Called by Wade on Victor's Mac, which has no Maverick sign-in. It only creates a
// waiting request from a token hash; nothing can be read until Victor approves its code.
export async function POST(req: Request) {
  if (req.headers.get("origin")) return Response.json({ error: "Forbidden" }, { status: 403 }); // never from a web page
  if (!dbConfigured()) return Response.json({ error: "Maverick's database isn't set up." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { token_hash?: unknown } | null;
  if (!body || !validHash(body.token_hash) || Object.keys(body).length !== 1)
    return Response.json({ error: "Send only token_hash." }, { status: 400 });
  try {
    const link = await updateLinks((s) => {
      const r = startLink(s, body.token_hash as string, Date.now(), randomUUID());
      return { state: r.state, value: r.link };
    });
    const approve = new URL("/wade/connect", req.url);
    approve.searchParams.set("code", link.userCode);
    return Response.json({ user_code: link.userCode, approve_url: approve.toString(), expires_in: PENDING_MINUTES * 60 },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof LinkError) return Response.json({ error: e.message }, { status: e.status });
    console.error("wade link start", e);
    return Response.json({ error: "Couldn't start the Wade link." }, { status: 502 });
  }
}
