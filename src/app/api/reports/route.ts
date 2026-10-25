import { connection } from "next/server";
import { buildReport, reportCsv, reportText, type ReportPeriod } from "@/features/money/reports";
import type { Scope } from "@/features/money/types";
import { dbConfigured, readDoc } from "@/lib/db";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

/** Read-only, authenticated reports from the saved financial document. */
export async function GET(req: Request) {
  await connection();
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const entity = params.get("entity") ?? "personal";
  const period = params.get("period") ?? "ytd";
  const format = params.get("format") ?? "json";
  if (!["personal", "business", "gladiator"].includes(entity) || !["ytd", "12m", "30d"].includes(period) || !["json", "csv", "txt"].includes(format)) {
    return Response.json({ error: "Choose a valid entity, period (ytd, 12m, 30d), and format (json, csv, txt)." }, { status: 400 });
  }
  if (!dbConfigured()) return Response.json({ error: "Online financial data is unavailable." }, { status: 503 });
  try {
    const doc = await readDoc(MONEY_DOC);
    if (!doc) return Response.json({ error: "No saved financial data yet." }, { status: 404 });
    const r = buildReport(asMoney(doc.data), entity as Scope, period as ReportPeriod);
    const body = format === "csv" ? reportCsv(r) : format === "txt" ? reportText(r) : JSON.stringify(r);
    return new Response(body, { headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : format === "txt" ? "text/plain; charset=utf-8" : "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="maverick-${entity}-${r.period.start}-${r.period.end}.${format}"`,
    } });
  } catch {
    return Response.json({ error: "Could not generate the report from saved data. Try again." }, { status: 502 });
  }
}
