import { cleanAccounts } from "./accounts-fix";
import { addDays, today } from "./calc";
import { balances, entityLabel, transactionRows, upcoming } from "./outlook";
import type { MoneyData, Scope } from "./types";

export type ReportPeriod = "ytd" | "12m" | "30d";
const round = (n: number) => Math.round(n * 100) / 100;

/** Read-only report projection. No credentials, connection tokens, or vault data. */
export function buildReport(input: MoneyData, entity: Scope, period: ReportPeriod, end = today(), now = Date.now()) {
  const d = cleanAccounts(input).data;
  const start = period === "ytd" ? `${end.slice(0, 4)}-01-01` : period === "30d" ? addDays(end, -29) : (() => {
    const date = new Date(`${end}T12:00:00`);
    const year = date.getFullYear() - 1;
    const month = date.getMonth();
    const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
    return addDays(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, 1);
  })();
  const rows = transactionRows(d).filter((r) => r.entity === entity && r.t.date >= start && r.t.date <= end);
  const transactions = rows.map(({ t, account }) => ({ date: t.date, merchant: t.description, category: t.category, account, amount: t.amount, direction: t.kind, transfer: !!t.transferId, source: t.plaidId ? "bank" : t.docId ? "document" : "manual / statement" }));
  const expense = transactions.filter((t) => t.direction === "expense" && !t.transfer);
  const income = transactions.filter((t) => t.direction === "income" && !t.transfer);
  const accounts = d.accounts.filter((a) => !a.needsEntity && (a.scope ?? "personal") === entity && !(a.plaid && d.bankLinks.find((l) => l.id === a.plaid!.linkId)?.duplicateOf));
  const coverage = accounts.map((a) => {
    const dates = rows.filter((r) => r.t.accountId === a.id).map((r) => r.t.date).sort();
    const link = d.bankLinks.find((l) => l.id === a.plaid?.linkId);
    return { account: a.nickname || a.name, first: dates[0] ?? null, last: dates.at(-1) ?? null, count: dates.length, lastSync: link?.lastSync ?? null, historyStatus: link?.historyStatus ?? null, syncError: !!link?.error || !!link?.errorCode };
  });
  const group = (key: "merchant" | "category") => {
    const groups = new Map<string, number>();
    expense.forEach((t) => groups.set(t[key] || "Uncategorized", (groups.get(t[key] || "Uncategorized") ?? 0) + t.amount));
    return [...groups].map(([name, amount]) => ({ name, amount: round(amount) })).sort((a, b) => b.amount - a.amount);
  };
  const balance = balances(d, now).find((b) => b.entity === entity)!;
  const bills = upcoming(d, 30, end).filter((b) => b.entity === entity);
  const confirmedBills = round(bills.filter((b) => !b.predicted).reduce((s, b) => s + b.amount, 0));
  const predictedBills = round(bills.filter((b) => b.predicted).reduce((s, b) => s + b.amount, 0));
  const warnings: string[] = [];
  if (!transactions.length) warnings.push("No transactions in this period. Zero recorded spending does not establish that nothing was spent.");
  if (coverage.some((c) => !c.first || c.first > start)) warnings.push("Recorded history does not cover the start of this period for every account. Totals may be incomplete.");
  if (coverage.some((c) => c.historyStatus && c.historyStatus !== "HISTORICAL_UPDATE_COMPLETE")) warnings.push("A bank is still loading older history.");
  if (coverage.some((c) => c.syncError)) warnings.push("A bank connection has a sync error. Open Money → Accounts to review it.");
  if (balance.old || balance.stale) warnings.push("Some balances are older than a day or unavailable. Check the dates before using the cash total.");
  if (d.accounts.some((a) => a.needsEntity)) warnings.push("Unassigned accounts are excluded. Assign them in Money → Accounts.");
  return {
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), entity, label: entityLabel(entity), period: { start, end }, currency: "USD",
    available: balance.counted ? balance.available : null, balanceAsOf: balance.asOf,
    spent: round(expense.reduce((s, t) => s + t.amount, 0)), income: round(income.reduce((s, t) => s + t.amount, 0)),
    confirmedBills, predictedBills, projected: balance.counted ? round(balance.available - confirmedBills) : null,
    warnings, coverage, merchants: group("merchant"), categories: group("category"), bills, transactions,
  };
}

export type FinancialReport = ReturnType<typeof buildReport>;

// Quote every cell and neutralize spreadsheet formulas in imported merchant names.
export function reportCsv(r: FinancialReport) {
  const cell = (value: string | number | boolean) => {
    const raw = String(value);
    const safe = typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows: (string | number | boolean)[][] = [["Entity", "Date", "Merchant", "Category", "Account", "Amount USD", "Direction", "Transfer (excluded from totals)", "Source"]];
  r.transactions.forEach((t) => rows.push([r.label, t.date, t.merchant, t.category, t.account, t.amount, t.direction, t.transfer, t.source]));
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function reportText(r: FinancialReport) {
  const usd = (n: number | null) => n === null ? "Unavailable" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return [
    `MAVERICK · ${r.label.toUpperCase()} REPORT`, `${r.period.start} through ${r.period.end}`, `Generated: ${r.generatedAt}`,
    `Available cash: ${usd(r.available)} (balance as of ${r.balanceAsOf ?? "unavailable"})`,
    `Recorded spending: ${usd(r.spent)}`, `Recorded income: ${usd(r.income)}`, "Transfers excluded from spending and income.",
    `Confirmed bills, next 30 days: ${usd(r.confirmedBills)}`, `Additional predicted bills: ${usd(r.predictedBills)}`,
    `After confirmed bills only: ${usd(r.projected)}`, "This projection excludes predicted bills, future income, and other spending.",
    "", "ATTENTION", ...r.warnings.map((w) => `• ${w}`),
    "", "SPENDING BY MERCHANT", ...r.merchants.map((m) => `${m.name}: ${usd(m.amount)}`),
    "", "SPENDING BY CATEGORY", ...r.categories.map((c) => `${c.name}: ${usd(c.amount)}`),
    "", "UPCOMING BILLS", ...r.bills.map((b) => `${b.date} · ${b.name} · ${usd(b.amount)} · ${b.predicted ? "Predicted" : "Confirmed"} · ${b.account}`),
    "", "HISTORY COVERAGE", ...r.coverage.map((c) => `${c.account}: ${c.first ?? "none"} to ${c.last ?? "none"}; ${c.count} rows; last sync ${c.lastSync ?? "none"}`),
    "Coverage dates describe observed transactions, not proof that every transaction has arrived.",
  ].join("\n");
}
