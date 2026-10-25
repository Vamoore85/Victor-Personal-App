import { connection } from "next/server";
import { GmailError, receiptOriginal } from "@/lib/gmail";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  await connection();
  const { id } = await params;
  try {
    const bytes = await receiptOriginal(id);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + 64 * 1024)));
        offset += 64 * 1024;
      },
    });
    return new Response(stream, { headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="receipt-${id}.eml"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (e) {
    return Response.json({ error: e instanceof GmailError ? e.message : "Could not retrieve this receipt. Try again." }, { status: e instanceof GmailError ? e.status : 502 });
  }
}
