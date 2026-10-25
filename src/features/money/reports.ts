import { cleanAccounts } from "./accounts-fix";
import { displayName, merchantKey } from "./bill-intel";
import { addDays, today } from "./calc";
import { balances, entityLabel, transactionRows, upcoming } from "./outlook";
import { spendKind, type SpendKind } from "./spend";
import type { MoneyData, Scope } from "./types";

export type ReportPeriod = "ytd" | "12m" | "30d";

/** A real calendar date written YYYY-MM-DD (rejects 2026-99-99 and 2026-02-30). */
export function isCalendarDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const round = (n: number) => Math.round(n * 100) / 100;
const KIND_LABEL: Record<SpendKind, string> = {
  spending: "Spending",
  refund: "Refund (not netted)",
  income: "Income",
  transfer: "Transfer (excluded)",
  "card-payment": "Card payment (excluded)",
};

/*
 * Read-only report projection. Totals follow the Spending screen's defaults:
 * transfers, owner draws and card payments are left out, and refunds are shown
 * on their own rather than netted against spending. No credentials, connection
 * tokens, or vault data.
 */
export function buildReport(input: MoneyData, entity: Scope, period: ReportPeriod, end = today(), now = Date.now()) {
  const d = cleanAccounts(input).data;
  const start = period === "ytd" ? `${end.slice(0, 4)}-01-01` : period === "30d" ? addDays(end, -29) : (() => {
    const date = new Date(`${end}T12:00:00`);
    const year = date.getFullYear() - 1;
    const month = date.getMonth();
    const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
    return addDays(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, 1);
  })();
  const kindAccount = new Map(d.accounts.map((a) => [a.id, a]));
  const everything = transactionRows(d).filter((r) => r.entity === entity);
  const rows = everything.filter((r) => r.t.date >= start && r.t.date <= end);
  const transactions = rows.map(({ t, account }) => {
    const a = kindAccount.get(t.accountId);
    const kind = spendKind(t, a?.type === "credit" || a?.type === "loan");
    return { date: t.date, merchant: t.description, category: t.category, account, amount: t.amount, direction: t.kind, kind, transfer: kind === "transfer" || kind === "card-payment", source: t.plaidId ? "bank" : t.docId ? "document" : "manual / statement" };
  });
  const sum = (kind: SpendKind) => round(transactions.filter((t) => t.kind === kind).reduce((s, t) => s + t.amount, 0));
  const accounts = d.accounts.filter((a) => !a.needsEntity && (a.scope ?? "personal") === entity && !(a.plaid && d.bankLinks.find((l) => l.id === a.plaid!.linkId)?.duplicateOf));
  // Coverage looks at each account's whole recorded history, so a period that starts before the history does not look complete.
  const coverage = accounts.map((a) => {
    const dates = everything.filter((r) => r.t.accountId === a.id).map((r) => r.t.date).sort();
    const link = d.bankLinks.find((l) => l.id === a.plaid?.linkId);
    return { account: a.nickname || a.name, first: dates[0] ?? null, last: dates.at(-1) ?? null, count: dates.length, lastSync: link?.lastSync ?? null, historyStatus: link?.historyStatus ?? null, syncError: !!link?.error || !!link?.errorCode };
  });
  const group = (keyOf: (t: (typeof transactions)[number]) => string, nameOf: (t: (typeof transactions)[number]) => string) => {
    const groups = new Map<string, { name: string; amount: number }>();
    transactions.filter((t) => t.kind === "spending").forEach((t) => {
      const key = keyOf(t);
      const g = groups.get(key) ?? { name: nameOf(t), amount: 0 };
      g.amount += t.amount;
      groups.set(key, g);
    });
    return [...groups.values()].map(({ name, amount }) => ({ name, amount: round(amount) })).sort((a, b) => b.amount - a.amount);
  };
  const balance = balances(d, now).find((b) => b.entity === entity)!;
  // Past-due bills are listed once, from the overdue list below.
  const bills = upcoming(d, 30, end).filter((b) => b.entity === entity && b.date >= end);
  const overdue = d.bills.filter((b) => (b.scope ?? "personal") === entity && b.nextDue < end);
  const confirmedBills = round(bills.filter((b) => !b.predicted).reduce((s, b) => s + b.amount, 0) + overdue.reduce((s, b) => s + b.amount, 0));
  const predictedBills = round(bills.filter((b) => b.predicted).reduce((s, b) => s + b.amount, 0));
  const warnings: string[] = [];
  if (!transactions.length) warnings.push("No transactions in this period. Zero recorded spending does not establish that nothing was spent.");
  if (coverage.some((c) => !c.first || c.first > start)) warnings.push("Recorded history does not reach back to the start of this period for every account. Totals may be incomplete.");
  if (coverage.some((c) => c.historyStatus && c.historyStatus !== "HISTORICAL_UPDATE_COMPLETE")) warnings.push("A bank is still loading older history.");
  if (coverage.some((c) => c.syncError)) warnings.push("A bank connection has a sync error. Open Money → Accounts to review it.");
  if (balance.old || balance.stale) warnings.push("Some balances are older than a day or unavailable. Check the dates before using the cash total.");
  if (overdue.length) warnings.push(`${overdue.length} bill${overdue.length === 1 ? " is" : "s are"} past due and included in the projection.`);
  if (d.accounts.some((a) => a.needsEntity)) warnings.push("Unassigned accounts are excluded. Assign them in Money → Accounts.");
  return {
    schemaVersion: 2, generatedAt: new Date(now).toISOString(), entity, label: entityLabel(entity), period: { start, end }, currency: "USD",
    available: balance.counted ? balance.available : null, balanceAsOf: balance.asOf,
    spent: sum("spending"), refunds: sum("refund"), income: sum("income"),
    confirmedBills, predictedBills, projected: balance.counted ? round(balance.available - confirmedBills) : null,
    warnings, coverage,
    merchants: group((t) => merchantKey(t.merchant) || t.merchant.toUpperCase(), (t) => displayName(merchantKey(t.merchant), t.merchant)),
    categories: group((t) => t.category || "Uncategorized", (t) => t.category || "Uncategorized"),
    bills: [...overdue.map((b) => ({ key: `past-due-${b.id}`, date: b.nextDue, name: b.name, amount: b.amount, predicted: false, account: "" })), ...bills].sort((a, b) => a.date.localeCompare(b.date)),
    transactions,
  };
}

export type FinancialReport = ReturnType<typeof buildReport>;

// Quote every cell and neutralize spreadsheet formulas in imported merchant names. A byte-order mark keeps non-English names readable in Excel.
export function reportCsv(r: FinancialReport) {
  const cell = (value: string | number | boolean) => {
    const raw = String(value);
    const safe = typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows: (string | number)[][] = [["Entity", "Date", "Merchant", "Category", "Account", "Amount USD", "Direction", "Counted as", "Source"]];
  r.transactions.forEach((t) => rows.push([r.label, t.date, t.merchant, t.category, t.account, t.amount, t.direction, KIND_LABEL[t.kind], t.source]));
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function reportText(r: FinancialReport) {
  const usd = (n: number | null) => n === null ? "Unavailable" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return [
    `${r.label.toUpperCase()} · FINANCIAL REPORT`, `${r.period.start} through ${r.period.end}`, `Generated: ${r.generatedAt}`,
    `Available cash: ${usd(r.available)} (balance as of ${r.balanceAsOf ?? "unavailable"})`,
    `Recorded spending: ${usd(r.spent)}`, `Refunds (not netted): ${usd(r.refunds)}`, `Recorded income: ${usd(r.income)}`,
    "Transfers, owner draws and card payments are excluded from spending and income.",
    `Confirmed bills, including past due, next 30 days: ${usd(r.confirmedBills)}`, `Additional predicted bills: ${usd(r.predictedBills)}`,
    `After confirmed bills only: ${usd(r.projected)}`, "This projection excludes predicted bills, future income, and other spending.",
    "", "ATTENTION", ...r.warnings.map((w) => `• ${w}`),
    "", "SPENDING BY MERCHANT", ...r.merchants.map((m) => `${m.name}: ${usd(m.amount)}`),
    "", "SPENDING BY CATEGORY", ...r.categories.map((c) => `${c.name}: ${usd(c.amount)}`),
    "", "UPCOMING BILLS", ...r.bills.map((b) => `${b.date} · ${b.name} · ${usd(b.amount)} · ${b.predicted ? "Predicted" : "Confirmed"}${b.account ? ` · ${b.account}` : ""}`),
    "", "HISTORY COVERAGE", ...r.coverage.map((c) => `${c.account}: ${c.first ?? "none"} to ${c.last ?? "none"}; ${c.count} rows; last sync ${c.lastSync ?? "none"}`),
    "Coverage dates describe observed transactions, not proof that every transaction has arrived.",
  ].join("\n");
}
