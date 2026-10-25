import type { EmailItem } from "./parse";
import type { Receipt, Scope } from "@/features/money/types";

export const RECEIPT_SECTIONS: { scope: Scope; name: string }[] = [
  { scope: "personal", name: "Personal" },
  { scope: "gladiator", name: "Gladiator" },
  { scope: "business", name: "Maverick" },
];

export type FiledReceipt = {
  id: string;
  source: "email" | "upload";
  merchant: string;
  date: string | null;
  scope?: Scope;
  amount: number | null;
  currency: string;
  contentType: string;
  reason: string | null;
};

export function receiptYear(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date.slice(0, 4) : null;
}

/** Filing is separate from bank reconciliation; suggestions never become assignments. */
export function receiptFolders(emails: EmailItem[], uploads: Receipt[]): FiledReceipt[] {
  const rows: FiledReceipt[] = [];
  const seen = new Set<string>();
  for (const item of emails) {
    if (item.kind !== "receipt" || item.status === "ignored" || item.status === "duplicate" || seen.has(`email:${item.id}`)) continue;
    seen.add(`email:${item.id}`);
    const reason = item.status !== "confirmed" ? "Review this receipt" : !item.scope ? "Choose a company" : !receiptYear(item.billDate) ? "Add the receipt date" : null;
    rows.push({ id: item.id, source: "email", merchant: item.merchant, date: item.billDate, scope: item.scope, amount: item.amount, currency: item.currency, contentType: "message/rfc822", reason });
  }
  for (const item of uploads) {
    if (seen.has(`upload:${item.id}`)) continue;
    seen.add(`upload:${item.id}`);
    const reason = !item.scope ? "Choose a company in Money → Receipts" : !receiptYear(item.date) ? "Add the receipt date in Money → Receipts" : null;
    rows.push({ id: item.id, source: "upload", merchant: item.merchant, date: item.date, scope: item.scope, amount: item.amount, currency: "USD", contentType: item.contentType, reason });
  }
  return rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

export const safeReceiptName = (name: string) => name.normalize("NFKC").replace(/[^\p{L}\p{N} _.-]/gu, "_").replace(/\.{2,}/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 70) || "Receipt";

export function receiptCsv(rows: FiledReceipt[]) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [["Receipt date", "Company", "Merchant", "Amount", "Currency", "Source", "Source ID"], ...rows.map(r => [r.date, RECEIPT_SECTIONS.find(s => s.scope === r.scope)?.name, r.merchant, r.amount, r.currency, r.source, r.id])].map(row => row.map(cell).join(",")).join("\r\n");
}
