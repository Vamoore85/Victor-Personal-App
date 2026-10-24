import { bucketOf, merchantKey } from "./bill-intel";
import { buildRows, guessMapping, parseCsv, parseDate, type Row } from "./import";
import { sameCharge } from "./plaid";
import type { DocImport, MoneyData, Scope } from "./types";

/*
 * Financial documents: statements and exports you upload. Only formats that
 * can be read exactly are turned into transactions (CSV and OFX/QFX exports,
 * and statement PDFs that add up to their own balances); anything else is
 * listed as needing review, never guessed at. Everything is read in this
 * browser; the file isn't sent anywhere.
 */

export type DocFormat = DocImport["format"];

export function formatOf(name: string, type: string): DocFormat {
  if (/\.csv$/i.test(name) || type === "text/csv") return "csv";
  if (/\.(ofx|qfx|qbo)$/i.test(name) || /ofx/i.test(type)) return "ofx";
  if (/\.pdf$/i.test(name) || type === "application/pdf") return "pdf";
  if (type.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(name)) return "image";
  return "other";
}

/** Plain OFX / QFX (Quicken, QuickBooks Web Connect) downloads: one STMTTRN per transaction. */
export function parseOfx(text: string): { rows: { date: string; description: string; amount: number; fitid?: string }[]; last4?: string } {
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  const rows = text
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((block) => {
      const d = tag(block, "DTPOSTED");
      const amount = Number(tag(block, "TRNAMT").replace(/,/g, ""));
      const name = tag(block, "NAME");
      const memo = tag(block, "MEMO");
      return {
        date: d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "",
        description: (name && memo && !memo.startsWith(name) ? `${name} ${memo}` : name || memo || "Imported").replace(/&amp;/g, "&"),
        amount,
        fitid: tag(block, "FITID") || undefined,
      };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount) && r.amount !== 0);
  const acct = tag(text, "ACCTID");
  return { rows, last4: acct ? acct.replace(/\D/g, "").slice(-4) || undefined : undefined };
}

/** Rows from an OFX file, sorted into categories the same way a CSV import is. */
export function ofxRows(text: string, data: MoneyData, scope: Scope) {
  const { rows, last4 } = parseOfx(text);
  const asTable = rows.map((r) => [r.date, r.description, String(r.amount)]);
  const built = buildRows(asTable, { date: 0, description: 1, amount: 2, debit: -1, credit: -1, category: -1 }, false, data, scope);
  return { rows: built.rows, skipped: built.skipped, last4 };
}

export function csvRows(text: string, data: MoneyData, scope: Scope, creditCard: boolean) {
  const table = parseCsv(text);
  const headers = table[0] ?? [];
  const map = guessMapping(headers);
  if (map.date < 0 || (map.amount < 0 && map.debit < 0 && map.credit < 0)) return { rows: [] as Row[], skipped: table.length - 1, ok: false };
  const body = table.slice(1).filter((r) => parseDate(r[map.date] ?? ""));
  // Card exports often show purchases as positive numbers.
  const vals = map.amount >= 0 ? body.map((r) => Number((r[map.amount] ?? "").replace(/[^\d.-]/g, ""))).filter(Number.isFinite) : [];
  const positiveIsSpending = creditCard && vals.filter((v) => v > 0).length > vals.length / 2;
  const built = buildRows(body, map, positiveIsSpending, data, scope);
  return { rows: built.rows, skipped: built.skipped, ok: true };
}

/* ---------------- Duplicates ---------------- */

export type Checked = Row & { key: string; status: "new" | "duplicate" | "maybe"; why?: string; include: boolean };

/**
 * Compares document rows with what's already here. The bank feed wins: a row
 * that's clearly the same as a bank-feed or already-imported transaction is
 * skipped; one that only might be the same is held back for you to decide.
 */
export function checkRows(d: MoneyData, accountId: string, rows: Row[]): Checked[] {
  const acct = d.accounts.find((a) => a.id === accountId);
  const bucket = bucketOf(acct?.scope);
  const sameAccount = d.transactions.filter((t) => t.accountId === accountId);
  const sameOwner = d.transactions.filter((t) => t.accountId !== accountId && bucketOf(d.accounts.find((a) => a.id === t.accountId)?.scope) === bucket);
  const used = new Set<string>();
  return rows.map((r, i) => {
    const key = `${i}`;
    const payee = merchantKey(r.description);
    const days = (a: string) => Math.abs(Date.parse(a) - Date.parse(r.date)) / 86_400_000;
    const sure = sameAccount.find((t) => !used.has(t.id) && sameCharge(t, r.date, r.amount, r.kind) && (merchantKey(t.description) === payee || days(t.date) <= 1));
    if (sure) {
      used.add(sure.id);
      return { ...r, key, status: "duplicate" as const, why: `Already here from ${sure.plaidId ? "the bank feed" : sure.docId ? "an earlier upload" : "a statement or typed entry"} (${sure.date})`, include: false };
    }
    const close = sameAccount.find((t) => !used.has(t.id) && sameCharge(t, r.date, r.amount, r.kind));
    if (close) return { ...r, key, status: "maybe" as const, why: `Same amount within 3 days: "${close.description}" on ${close.date}`, include: false };
    const elsewhere = sameOwner.find((t) => sameCharge(t, r.date, r.amount, r.kind) && merchantKey(t.description) === payee && !r.transferId);
    if (elsewhere) return { ...r, key, status: "maybe" as const, why: `Same payee and amount in another ${bucket === "gladiator" ? "Gladiator" : "Personal / Maverick"} account (${elsewhere.date})`, include: false };
    return { ...r, key, status: "new" as const, include: true };
  });
}

/* ---------------- Files elsewhere in the app ---------------- */

export type FoundFile = { id: string; name: string; type: string; size: number; area: string; title: string };

// Parts of the app that keep attachments in this browser (IndexedDB "maverick-files").
const AREAS: [string, string][] = [
  ["maverick.invest.v1", "Invest"],
  ["maverick.research.v1", "Research"],
  ["maverick.events.v1", "Events"],
  ["maverick.travel.v1", "Travel"],
];

/** Statement-like files (CSV, OFX/QFX, PDF) attached elsewhere in the app on this device. Nothing is read or moved. */
export function findOtherFiles(): FoundFile[] {
  const out: FoundFile[] = [];
  for (const [key, area] of AREAS) {
    let raw: unknown;
    try {
      raw = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      continue;
    }
    const walk = (v: unknown, title: string) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, title));
      const o = v as Record<string, unknown>;
      const here = typeof o.title === "string" ? o.title : typeof o.name === "string" ? o.name : title;
      const f = o.file as { id?: unknown; name?: unknown; type?: unknown; size?: unknown } | undefined;
      if (f && typeof f.id === "string" && typeof f.name === "string") {
        const fmt = formatOf(f.name, String(f.type ?? ""));
        if (fmt === "csv" || fmt === "ofx" || fmt === "pdf") out.push({ id: f.id, name: f.name, type: String(f.type ?? ""), size: Number(f.size) || 0, area, title: here });
      }
      for (const x of Object.values(o)) if (x && typeof x === "object") walk(x, here);
    };
    walk(raw, area);
  }
  return out;
}
