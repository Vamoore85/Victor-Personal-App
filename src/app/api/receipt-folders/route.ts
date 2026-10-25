import { connection } from "next/server";
import { dbConfigured } from "@/lib/db";
import { signedIn } from "@/lib/plaid-server";
import { allEntries } from "@/lib/receipt-folders";
import { connectedEmail } from "@/lib/gmail";
import { years } from "@/features/receipts/folders";

// Your receipt folders: every receipt and bill by year and company. Read only.
export async function GET(req: Request) {
  await connection();
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "Receipt folders need the online database." }, { status: 503 });
  try {
    const [entries, email] = await Promise.all([allEntries(), connectedEmail()]);
    return Response.json({ years: years(entries), entries, email }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("receipt folders", (e as Error)?.name ?? "error");
    return Response.json({ error: "Couldn't load your receipt folders. Try again." }, { status: 502 });
  }
}
