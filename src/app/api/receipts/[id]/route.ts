import { connection } from "next/server";
import { deleteFile, getFile } from "@/lib/db";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  if (!signedIn(req)) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  const file = await getFile(`receipt-${id}`).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  await connection();
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  try {
    await deleteFile(`receipt-${id}`);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("receipt delete", e);
    return Response.json({ error: "Couldn't delete the receipt file." }, { status: 502 });
  }
}
