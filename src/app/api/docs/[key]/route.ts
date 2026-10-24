import { connection } from "next/server";
import { dbConfigured, readDoc, writeDoc } from "@/lib/db";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

// Small online documents for screens other than Money (Brain Dump, Integrations
// choices), so they're the same on every device. Only these keys are allowed.
const KEYS = new Set(["braindump", "integrations"]);
const MAX_BYTES = 2 * 1024 * 1024;

type Ctx = { params: Promise<{ key: string }> };

async function guard(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  if (!signedIn(req)) return { error: Response.json({ error: "Sign in first." }, { status: 401 }) };
  const { key } = await ctx.params;
  if (!KEYS.has(key)) return { error: Response.json({ error: "Unknown document." }, { status: 404 }) };
  if (!dbConfigured()) return { error: Response.json({ configured: false }) };
  return { key };
}

export async function GET(req: Request, ctx: Ctx) {
  await connection();
  const g = await guard(req, ctx);
  if ("error" in g) return g.error;
  try {
    const doc = await readDoc(g.key);
    return Response.json({ configured: true, rev: doc?.rev ?? 0, data: doc?.data ?? null });
  } catch (e) {
    console.error(`docs ${g.key} read`, e);
    return Response.json({ error: "Couldn't reach the database." }, { status: 502 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  await connection();
  const g = await guard(req, ctx);
  if ("error" in g) return g.error;
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Too large." }, { status: 413 });
  let body: { rev?: number; data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    const r = await writeDoc(g.key, Number(body.rev ?? 0), body.data ?? null);
    if (!r.ok) return Response.json({ rev: r.current.rev, data: r.current.data }, { status: 409 });
    return Response.json({ rev: r.rev });
  } catch (e) {
    console.error(`docs ${g.key} write`, e);
    return Response.json({ error: "Couldn't save to the database." }, { status: 502 });
  }
}
