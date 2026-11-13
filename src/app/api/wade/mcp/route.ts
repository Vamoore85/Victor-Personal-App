import { connection } from "next/server";
import { cleanAccounts } from "@/features/money/accounts-fix";
import { dbConfigured, readDoc } from "@/lib/db";
import { answerMcp } from "@/lib/maverick-mcp";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { bearer, findByToken, linkStatus } from "@/lib/wade-link";
import { readLinks, updateLinks } from "@/lib/wade-link-store";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

// Maverick's coordinator for Raven: read-only MCP over the same approved Wade link as /api/wade/money.
// Server-to-server only (no browser origin); the link must be approved in Maverick and not expired or revoked.
export async function POST(req: Request) {
  await connection();
  const token = bearer(req.headers.get("authorization"));
  if (!token || req.headers.get("origin")) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!dbConfigured()) return Response.json({ error: "Maverick's database isn't set up." }, { status: 503, headers });
  let link;
  try { link = findByToken(await readLinks(), token); } catch { return Response.json({ error: "Maverick is unavailable." }, { status: 503, headers }); }
  const state = linkStatus(link, Date.now());
  if (state !== "approved") return Response.json({ error: "Approve Raven in Maverick first.", link_state: state }, { status: 403, headers });
  const text = await req.text().catch(() => null);
  if (text === null || text.length > 65536) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } }, { headers });
  let msg: unknown;
  try { msg = JSON.parse(text); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { headers }); }
  try {
    const reply = await answerMcp(msg, async () => { const doc = await readDoc(MONEY_DOC); return doc ? cleanAccounts(asMoney(doc.data)).data : null; }, new Date());
    if (!link!.lastUsedAt || Date.now() - link!.lastUsedAt > 36e5)
      await updateLinks((s) => ({ state: { links: s.links.map((l) => (l.id === link!.id ? { ...l, lastUsedAt: Date.now() } : l)) }, value: null })).catch(() => {});
    console.log(`raven mcp: ${typeof (msg as { method?: unknown })?.method === "string" ? (msg as { method: string }).method.slice(0, 40) : "invalid"}`);
    return reply.status === 202 ? new Response(null, { status: 202, headers }) : Response.json(reply.body, { headers });
  } catch (e) {
    console.error("raven mcp", e instanceof Error ? e.name : "error");
    return Response.json({ error: "Couldn't read the money data." }, { status: 502, headers });
  }
}

export function GET() {
  return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
}
