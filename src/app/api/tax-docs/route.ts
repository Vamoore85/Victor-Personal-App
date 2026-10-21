import { connection } from "next/server";
import { dbConfigured, deleteFile, getFile, putFile } from "@/lib/db";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

// Tax returns and forms. A whole return can be bigger than one request may
// carry, so the browser sends and fetches it in numbered parts of up to 3 MB,
// each stored as its own row: "taxdoc-<id>-<part>".

const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const PART_BYTES = 3 * 1024 * 1024;
const MAX_PARTS = 20; // 60 MB

function target(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id") ?? "";
  const part = Number(q.get("part") ?? "0");
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id) || !Number.isInteger(part) || part < 0 || part >= MAX_PARTS) return null;
  return { id, part, parts: Math.min(MAX_PARTS, Math.max(1, Number(q.get("parts") ?? "1") || 1)) };
}

const key = (id: string, part: number) => `taxdoc-${id}-${part}`;

export async function POST(req: Request) {
  await connection();
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "Tax documents need the online database." }, { status: 503 });
  const t = target(req);
  if (!t) return Response.json({ error: "Bad document id." }, { status: 400 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TYPES.has(type)) return Response.json({ error: "Use a PDF or a photo (JPG, PNG)." }, { status: 415 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0) return Response.json({ error: "The file is empty." }, { status: 400 });
  if (data.length > PART_BYTES) return Response.json({ error: "Part too large." }, { status: 413 });
  try {
    await putFile(key(t.id, t.part), type, data);
    return Response.json({ ok: true, size: data.length });
  } catch (e) {
    console.error("tax doc upload", e);
    return Response.json({ error: "Couldn't save the document. Try again." }, { status: 502 });
  }
}

export async function GET(req: Request) {
  await connection();
  if (!signedIn(req)) return new Response("Sign in first.", { status: 401 });
  const t = target(req);
  if (!t) return new Response("Bad request", { status: 400 });
  const file = await getFile(key(t.id, t.part)).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}

export async function DELETE(req: Request) {
  await connection();
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  const t = target(req);
  if (!t) return Response.json({ error: "Bad document id." }, { status: 400 });
  try {
    for (let i = 0; i < t.parts; i++) await deleteFile(key(t.id, i));
    return Response.json({ ok: true });
  } catch (e) {
    console.error("tax doc delete", e);
    return Response.json({ error: "Couldn't delete the document." }, { status: 502 });
  }
}
