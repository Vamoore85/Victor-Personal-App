import { connection } from "next/server";
import { dbConfigured, readDoc, writeDoc } from "@/lib/db";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

// Cloud copy of the Financial Center. The browser keeps a local copy too and
// sends each change here with the revision it started from.

const KEY = "money";
const MAX_BYTES = 8 * 1024 * 1024;

function guard(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  return null;
}

function failed(e: unknown) {
  console.error("money sync", e);
  return Response.json({ error: "Couldn't reach the database." }, { status: 502 });
}

export async function GET(req: Request) {
  await connection();
  const denied = guard(req);
  if (denied) return denied;
  if (!dbConfigured()) return Response.json({ configured: false });
  try {
    const doc = await readDoc(KEY);
    return Response.json({ configured: true, rev: doc?.rev ?? 0, data: doc?.data ?? null });
  } catch (e) {
    return failed(e);
  }
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!dbConfigured()) return Response.json({ error: "No database yet." }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Too much data to save at once." }, { status: 413 });
  let body: { rev?: unknown; data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (typeof body.rev !== "number" || typeof body.data !== "object" || body.data === null) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    const result = await writeDoc(KEY, body.rev, body.data);
    if (!result.ok) return Response.json({ conflict: true, rev: result.current.rev, data: result.current.data }, { status: 409 });
    return Response.json({ rev: result.rev });
  } catch (e) {
    return failed(e);
  }
}
