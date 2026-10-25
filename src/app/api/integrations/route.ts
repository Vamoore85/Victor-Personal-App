import { connection } from "next/server";
import { dbConfigured, readDoc } from "@/lib/db";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { sameOrigin, signedIn } from "@/lib/plaid-server";
import { status as quickbooksStatus } from "@/lib/quickbooks";
import { status as gmailStatus } from "@/lib/gmail";
import { status as calendarStatus } from "@/lib/calendar";
import { status as microsoftStatus } from "@/lib/microsoft";
import { accountLabel, cleanAccounts } from "@/features/money/accounts-fix";

// What the Integrations page shows for each connection: status, what's
// included and when it last synced. Names and last 4 digits only, no amounts.
const ENTITY: Record<string, string> = { personal: "Personal", business: "Maverick", gladiator: "Gladiator" };

export async function GET(req: Request) {
  await connection();
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!dbConfigured()) return Response.json({ database: false });
  try {
    const [doc, qb, gm, cal, ms] = await Promise.all([
      readDoc(MONEY_DOC),
      quickbooksStatus().catch(() => null),
      gmailStatus().catch(() => null),
      calendarStatus().catch(() => null),
      microsoftStatus().catch(() => null),
    ]);
    const d = cleanAccounts(asMoney(doc?.data ?? null)).data; // the same one-copy-per-account view Money shows (read only here)
    const live = d.bankLinks.filter((l) => !l.duplicateOf);
    const liveIds = new Set(live.map((l) => l.id));
    const accounts = d.accounts
      .filter((a) => a.plaid && liveIds.has(a.plaid.linkId))
      .map((a) => ({ name: accountLabel(a), last4: a.last4 ?? "", company: a.needsEntity ? "No company yet" : ENTITY[a.scope ?? "personal"] }));
    const lastSync = live.map((l) => l.lastSync ?? "").sort().pop() || null;
    return Response.json({
      database: true,
      banks: {
        connections: live.length,
        institutions: [...new Set(live.map((l) => l.institution).filter(Boolean))],
        problems: live.filter((l) => l.errorCode).length,
        lastSync,
        accounts,
      },
      gmail: gm ? { keys: gm.keys, connected: gm.connected, connectedAt: gm.connectedAt, lastScan: gm.lastScan?.at ?? null, review: gm.counts.review } : null,
      googleCalendar: cal ? { connected: cal.google.connected, email: cal.google.email, lastRead: cal.google.health?.lastSuccess ?? null } : null,
      microsoft: ms ? { account: ms.account, keys: ms.keys, connected: ms.connected, email: ms.email, connectedAt: ms.connectedAt, teams: ms.teams, lastCalendarRead: cal?.outlook.health?.lastSuccess ?? null } : null,
      quickbooks: qb ? { connected: qb.connected, companyName: qb.companyName, connectedAt: qb.connectedAt } : null,
    });
  } catch (e) {
    console.error("integrations status", e);
    return Response.json({ error: "Couldn't read the connections." }, { status: 502 });
  }
}
