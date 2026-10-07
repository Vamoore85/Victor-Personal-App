import { ACCOUNT_TYPES, BILL_FREQUENCIES, type Account, type Bill, type MoneyData } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(n: number) {
  return usd.format(n);
}

export function isLiability(account: Account) {
  return ACCOUNT_TYPES.find((t) => t.value === account.type)?.liability ?? false;
}

export function accountTypeLabel(account: Account) {
  return ACCOUNT_TYPES.find((t) => t.value === account.type)?.label ?? account.type;
}

/**
 * Current balance, signed so it can be summed into net worth:
 * assets are positive, debts on credit cards and loans are negative.
 */
export function accountBalance(data: MoneyData, account: Account) {
  const start = isLiability(account) ? -account.openingBalance : account.openingBalance;
  return data.transactions
    .filter((t) => t.accountId === account.id)
    .reduce((sum, t) => sum + (t.kind === "income" ? t.amount : -t.amount), start);
}

export function today() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function currentMonth() {
  return today().slice(0, 7); // YYYY-MM
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function monthTotals(data: MoneyData, month: string) {
  let income = 0;
  let expenses = 0;
  const byCategory = new Map<string, number>();
  for (const t of data.transactions) {
    if (!t.date.startsWith(month) || t.transferId) continue;
    if (t.kind === "income") income += t.amount;
    else {
      expenses += t.amount;
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    }
  }
  return { income, expenses, net: income - expenses, byCategory };
}

export function categoriesInUse(data: MoneyData, defaults: string[]) {
  const set = new Set(defaults);
  data.transactions.forEach((t) => set.add(t.category));
  data.budgets.forEach((b) => set.add(b.category));
  return [...set];
}

function parseDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(date: Date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** Whole days from today until the date (negative when it has passed). */
export function daysUntil(ymd: string) {
  return Math.round((parseDate(ymd).getTime() - parseDate(today()).getTime()) / 86400000);
}

export function dueLabel(ymd: string) {
  const days = daysUntil(ymd);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function shortDate(ymd: string) {
  return parseDate(ymd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function addMonthsClamped(date: Date, months: number, day: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/**
 * The date after `from` for a repeating bill. Monthly, quarterly and yearly
 * bills keep their usual day (a bill due on the 31st comes out on the 30th in
 * shorter months, then back on the 31st). Returns null for one-time bills.
 */
export function nextDueAfter(bill: Bill, from: string): string | null {
  return stepDue(bill, from, 1);
}

function stepDue(bill: Bill, from: string, dir: 1 | -1): string | null {
  const d = parseDate(from);
  const day = bill.dueDay || d.getDate();
  switch (bill.frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7 * dir);
      return formatYmd(d);
    case "biweekly":
      d.setDate(d.getDate() + 14 * dir);
      return formatYmd(d);
    case "monthly":
      return formatYmd(addMonthsClamped(d, 1 * dir, day));
    case "quarterly":
      return formatYmd(addMonthsClamped(d, 3 * dir, day));
    case "yearly":
      return formatYmd(addMonthsClamped(d, 12 * dir, day));
    case "once":
      return null;
  }
}

/**
 * All dates a bill comes out within [start, end], inclusive. Dates before the
 * bill's next due date have already gone by, so they are flagged as paid.
 */
export function billDatesBetween(bill: Bill, start: string, end: string) {
  const dates: { date: string; paid: boolean }[] = [];
  let d: string | null = bill.nextDue;
  while (d && d <= end && dates.length < 60) {
    if (d >= start) dates.push({ date: d, paid: false });
    d = stepDue(bill, d, 1);
  }
  d = stepDue(bill, bill.nextDue, -1);
  while (d && d >= start && dates.length < 120) {
    if (d <= end) dates.push({ date: d, paid: true });
    d = stepDue(bill, d, -1);
  }
  return dates;
}

export function billMonthlyCost(bill: Bill) {
  const perMonth = BILL_FREQUENCIES.find((f) => f.value === bill.frequency)?.perMonth ?? 0;
  return bill.amount * perMonth;
}

export function frequencyLabel(bill: Bill) {
  return BILL_FREQUENCIES.find((f) => f.value === bill.frequency)?.label ?? bill.frequency;
}

export function addDays(ymd: string, days: number) {
  const d = parseDate(ymd);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** Accepts "duke-energy.com" as well as full URLs. */
export function normalizeUrl(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
