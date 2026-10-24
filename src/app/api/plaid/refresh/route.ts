import { dbConfigured, readDoc } from "@/lib/db";
import { asMoney, MONEY_DOC, updateMoney } from "@/lib/money-doc";
import { credsFrom, handle, PlaidError, unseal } from "@/lib/plaid-server";
import { pullChanges } from "@/lib/plaid-sync";
import { applySync, type SyncResult } from "@/features/money/plaid-apply";
import type { BankLink } from "@/features/money/types";

/*
 * Brings connected banks up to date on the server and saves the result straight
 * into the money data, where Bills, Spending and the briefing read it. The
 * browser only asks for it and then reloads; it doesn't have to carry two years
 * of history back up. The answer holds counts and status, never the data.
 */

export const maxDuration = 60;
const BUDGET_MS = 45_000; // leave time to save before the hosting's 60-second limit

const NEEDS_YOU = new Set(["BAD_SEAL", "ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"]);

export type RefreshLink = {
  id: string;
  ok: boolean;
  added: number;
  modified: number;
  removed: number;
  hasMore: boolean;
  historyStatus?: string;
  code?: string;
  error?: string;
};

export const POST = handle(async (body) => {
  if (!dbConfigured()) throw new PlaidError("No online database is set up, so this browser syncs the banks itself.", "NO_DATABASE", 409);
  const creds = await credsFrom(body);
  const only = Array.isArray(body.only) ? new Set(body.only.map(String)) : null;
  const start = Date.now();
  const doc = asMoney((await readDoc(MONEY_DOC))?.data);
  const links = doc.bankLinks.filter((l) => (only ? only.has(l.id) : !NEEDS_YOU.has(l.errorCode ?? "")));

  const pulled = new Map<string, SyncResult[]>();
  const report: RefreshLink[] = [];
  // Banks are fetched side by side; each one pages until done or the time budget runs out.
  await Promise.all(
    links.map(async (l) => {
      const r: RefreshLink = { id: l.id, ok: false, added: 0, modified: 0, removed: 0, hasMore: false };
      const pages: SyncResult[] = [];
      try {
        const token = unseal(creds, l.link);
        let cursor = l.cursor || "";
        do {
          const res = await pullChanges(creds, token, cursor);
          pages.push(res);
          cursor = res.cursor;
          r.added += res.added.length;
          r.modified += res.modified.length;
          r.removed += res.removed.length;
          r.hasMore = !!res.hasMore;
          r.historyStatus = res.updateStatus || r.historyStatus;
        } while (r.hasMore && Date.now() - start < BUDGET_MS);
        r.ok = true;
      } catch (e) {
        const err = e instanceof PlaidError ? e : new PlaidError("Couldn't reach Plaid.", "UNREACHABLE", 502);
        r.code = err.code;
        r.error = err.message;
      }
      pulled.set(l.id, pages);
      report.push(r);
    }),
  );

  const { rev } = await updateMoney((d) => {
    let next = d;
    for (const r of report) {
      const pages = pulled.get(r.id) ?? [];
      for (const page of pages) {
        const current = next.bankLinks.find((x) => x.id === r.id);
        if (current) next = applySync(next, current, page);
      }
      if (!r.ok) next = { ...next, bankLinks: next.bankLinks.map((x): BankLink => (x.id === r.id ? { ...x, error: r.error, errorCode: r.code } : x)) };
    }
    return next;
  });

  // Counts and codes only, for the hosting's logs.
  console.log(
    `plaid refresh: banks=${report.length} ok=${report.filter((r) => r.ok).length} added=${report.reduce((s, r) => s + r.added, 0)} more=${report.filter((r) => r.hasMore).length} codes=${report.map((r) => r.code).filter(Boolean).join(",") || "none"} ms=${Date.now() - start}`,
  );
  return { rev, links: report };
});
