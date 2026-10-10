import { connection } from "next/server";
import { dbConfigured, putFile } from "@/lib/db";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

// Saves a receipt photo or PDF. The browser shrinks photos before sending them.

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  await connection();
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "Receipts need the online database." }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return Response.json({ error: "Bad receipt id." }, { status: 400 });
  if (!TYPES.has(type)) return Response.json({ error: "Use a photo (JPG, PNG) or a PDF." }, { status: 415 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0) return Response.json({ error: "The file is empty." }, { status: 400 });
  if (data.length > MAX_BYTES) return Response.json({ error: "That file is over 4 MB. Try a photo instead of a scan." }, { status: 413 });
  try {
    await putFile(`receipt-${id}`, type, data);
    return Response.json({ ok: true, size: data.length });
  } catch (e) {
    console.error("receipt upload", e);
    return Response.json({ error: "Couldn't save the receipt. Try again." }, { status: 502 });
  }
}
