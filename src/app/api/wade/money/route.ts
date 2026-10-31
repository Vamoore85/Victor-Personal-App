import { connection } from "next/server";
import { dbConfigured, readDoc } from "@/lib/db";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { cleanAccounts } from "@/features/money/accounts-fix";
import { bearer, findByToken, linkStatus } from "@/lib/wade-link";
import { readLinks, updateLinks } from "@/lib/wade-link-store";
import { wadeMoneySummary } from "@/lib/wade-money";

// Read only, for the approved local Wade. Nothing is written to the money data.
export async function GET(req: Request) {
  await connection();
  const token = bearer(req.headers.get("authorization"));
  if (!token || req.headers.get("origin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "Maverick's database isn't set up." }, { status: 503 });
  try {
    const link = findByToken(await readLinks(), token);
    if (linkStatus(link, Date.now()) !== "approved") return Response.json({ error: "Approve Wade in Maverick first." }, { status: 403 });
    const doc = await readDoc(MONEY_DOC);
    const summary = wadeMoneySummary(cleanAccounts(asMoney(doc?.data ?? null)).data, new Date());
    // Last use is bookkeeping only; a failed save never blocks the read.
    if (!link!.lastUsedAt || Date.now() - link!.lastUsedAt > 36e5)
      await updateLinks((s) => ({ state: { links: s.links.map((l) => (l.id === link!.id ? { ...l, lastUsedAt: Date.now() } : l)) }, value: null })).catch(() => {});
    console.log(`wade money read: accounts=${summary.accounts.length} bills=${summary.bills.length} txns=${summary.transactions.length}`);
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("wade money", e);
    return Response.json({ error: "Couldn't read the money data." }, { status: 502 });
  }
}
