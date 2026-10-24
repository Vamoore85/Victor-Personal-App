import { addDays, today as todayYmd } from "./calc";
import { applyScan, confirmFinding, detectRecurring } from "./bill-intel";
import { EMPTY_DATA, type Account, type Bill, type MoneyData, type Transaction } from "./types";

/*
 * A made-up workspace for trying the bill briefings before real bank data is
 * in. Every name, account and amount here is invented ("Sample …"), and it is
 * built fresh relative to today so Daily, Week and Month all have something
 * to show. It is never mixed into your real money data.
 */

export const SAMPLE_PREFIX = "sample-";

/** Same date in another month, keeping the day (the 31st becomes the 30th in short months). */
function shiftMonths(ymd: string, months: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  return `${target.getFullYear()}-${mm}-${String(target.getDate()).padStart(2, "0")}`;
}

/** Small, repeatable wobble so variable bills vary the same way every time. */
function wobble(seed: string, i: number, spread: number) {
  let h = 2166136261;
  for (const c of `${seed}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

type Pattern = {
  description: string;
  accountId: string;
  category: string;
  amount: number;
  vary?: number; // ± this much
  every: "month" | 14 | 91;
  next: number; // days from today of the next payment
  count?: number; // how many past payments to make (default: all in 120 days)
  income?: boolean;
};

const ACCOUNTS: Account[] = [
  { id: "sample-pchk", name: "Sample Personal Checking", type: "checking", openingBalance: 0, scope: "personal", last4: "0001", plaid: { linkId: "sample-link1", accountId: "a1" } },
  { id: "sample-mchk", name: "Sample Maverick Operating", type: "checking", openingBalance: 0, scope: "business", last4: "0002", plaid: { linkId: "sample-link1", accountId: "a2" } },
  { id: "sample-psav", name: "Sample Savings (not linked)", type: "savings", openingBalance: 2000, scope: "personal" },
  { id: "sample-gchk", name: "Sample Gladiator Operating", type: "checking", openingBalance: 0, scope: "gladiator", last4: "0003", plaid: { linkId: "sample-link2", accountId: "b1" } },
  { id: "sample-gcard", name: "Sample Gladiator Card", type: "credit", openingBalance: 0, scope: "gladiator", last4: "0004", plaid: { linkId: "sample-link2", accountId: "b2" } },
];

const BALANCES: Record<string, { current: number; available: number | null }> = {
  "sample-pchk": { current: 3240.42, available: 3180.42 },
  "sample-mchk": { current: 5410, available: 5410 },
  "sample-gchk": { current: 6912.15, available: 6850.15 },
  "sample-gcard": { current: 1290.5, available: null },
};

const PATTERNS: Pattern[] = [
  // Personal / Maverick
  { description: "NORTHWIND MOBILE AUTOPAY", accountId: "sample-pchk", category: "Utilities", amount: 85, every: "month", next: 0 },
  { description: "BRIGHTLINE POWER CO", accountId: "sample-pchk", category: "Utilities", amount: 118, vary: 22, every: "month", next: 1 },
  { description: "STREAMBOX MEMBERSHIP", accountId: "sample-pchk", category: "Subscriptions", amount: 15.49, every: "month", next: 3 },
  { description: "SUNRISE LAWN CARE", accountId: "sample-pchk", category: "Housing", amount: 65, every: 14, next: 4, count: 2 },
  { description: "SAMPLE CLIENT PAYROLL DEPOSIT", accountId: "sample-pchk", category: "Salary", amount: 2400, every: 14, next: 5, income: true },
  { description: "CEDAR RIDGE APTS RENT", accountId: "sample-pchk", category: "Housing", amount: 1850, every: "month", next: 6 },
  { description: "PIXELWORKS SOFTWARE", accountId: "sample-mchk", category: "Software & subscriptions", amount: 49, every: "month", next: 9 },
  { description: "SUMMIT AUTO LOAN PMT", accountId: "sample-pchk", category: "Debt payments", amount: 412.37, every: "month", next: 12 },
  { description: "HARBOR GYM", accountId: "sample-pchk", category: "Health", amount: 39.99, every: "month", next: 20 },
  // Gladiator
  { description: "PAYROLL SERVICE CO DIRECT DEP", accountId: "sample-gchk", category: "Wages", amount: 3950, vary: 40, every: 14, next: 1 },
  { description: "METRO OFFICE SUITES", accountId: "sample-gchk", category: "Rent", amount: 2200, every: "month", next: 2 },
  { description: "CLOUDDESK SOFTWARE", accountId: "sample-gchk", category: "Software & subscriptions", amount: 129, every: "month", next: 8 },
  { description: "SAMPLE CLIENT RECEIVABLE", accountId: "sample-gchk", category: "Sales & services", amount: 9500, every: "month", next: 17, income: true },
  { description: "SAMPLE FLEET INSURANCE", accountId: "sample-gchk", category: "Business insurance", amount: 640, every: 91, next: 61 },
];

// Recognized as bills in the sample (the rest stay for you to review).
const CONFIRMED = ["NORTHWIND MOBILE", "BRIGHTLINE POWER", "CEDAR RIDGE", "SUMMIT AUTO", "PIXELWORKS SOFTWARE", "PAYROLL SERVICE", "METRO OFFICE", "CLOUDDESK SOFTWARE", "SAMPLE CLIENT|pm"];

export function buildSample(today = todayYmd(), now = Date.now()): MoneyData {
  const start = addDays(today, -119);
  const txns: Transaction[] = [];
  let n = 0;
  const push = (t: Omit<Transaction, "id" | "plaidId">) => {
    n++;
    txns.push({ ...t, id: `sample-t${n}`, plaidId: `sample-p${n}` });
  };
  for (const p of PATTERNS) {
    const first = p.every === "month" ? shiftMonths(addDays(today, p.next), -1) : addDays(today, p.next - p.every);
    let date = first;
    let i = 0;
    while (date >= start && (p.count === undefined || i < p.count)) {
      push({
        date,
        description: p.description,
        amount: Math.round((p.amount + (p.vary ? wobble(p.description, i, p.vary) : 0)) * 100) / 100,
        kind: p.income ? "income" : "expense",
        category: p.category,
        accountId: p.accountId,
      });
      i++;
      date = p.every === "month" ? shiftMonths(first, -i) : addDays(first, -p.every * i);
    }
  }
  // An ambiguous one for the review queue: same amount, no steady timing.
  for (const back of [11, 40, 83]) push({ date: addDays(today, -back), description: "CITY PARKING PERMIT", amount: 30, kind: "expense", category: "Transportation", accountId: "sample-pchk" });
  // One-offs and everyday spending that should never show up as bills.
  push({ date: addDays(today, -6), description: "LAKESIDE GRILL", amount: 64.2, kind: "expense", category: "Dining", accountId: "sample-pchk" });
  push({ date: addDays(today, -15), description: "CORNER HARDWARE", amount: 61.75, kind: "expense", category: "Shopping", accountId: "sample-pchk" });
  push({ date: addDays(today, -52), description: "CORNER HARDWARE", amount: 18.4, kind: "expense", category: "Shopping", accountId: "sample-pchk" });
  push({ date: addDays(today, -33), description: "SAMPLE NOTARY SERVICES", amount: 45, kind: "expense", category: "Legal & professional", accountId: "sample-gchk" });
  // A monthly move to savings between your own accounts: a transfer, not a bill.
  for (const back of [3, 33, 63, 94]) {
    const id = `sample-x${back}`;
    txns.push({ id: `${id}a`, date: addDays(today, -back), description: "TRANSFER TO SAVINGS", amount: 200, kind: "expense", category: "Transfer", accountId: "sample-pchk", transferId: id });
    txns.push({ id: `${id}b`, date: addDays(today, -back), description: "TRANSFER FROM CHECKING", amount: 200, kind: "income", category: "Transfer", accountId: "sample-psav", transferId: id });
  }

  const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
  const accounts = ACCOUNTS.map((a) => (BALANCES[a.id] ? { ...a, bankBalance: { ...BALANCES[a.id], asOf: hoursAgo(a.scope === "gladiator" ? 1 : 2) } } : a));
  const manual: Bill[] = [
    { id: "sample-b-hoa", name: "Sample HOA Dues", amount: 275, category: "Housing", frequency: "quarterly", nextDue: addDays(today, 20), dueDay: Number(addDays(today, 20).slice(8, 10)), accountId: "sample-pchk", autopay: false, scope: "personal", note: "Added by hand (no bank history)." },
    { id: "sample-b-license", name: "Sample Business License", amount: 150, category: "Taxes & licenses", frequency: "yearly", nextDue: addDays(today, 1), dueDay: Number(addDays(today, 1).slice(8, 10)), accountId: "sample-gchk", autopay: false, scope: "gladiator", note: "Added by hand (no bank history)." },
  ];
  let d: MoneyData = {
    ...EMPTY_DATA,
    accounts,
    transactions: txns.sort((a, b) => a.date.localeCompare(b.date)),
    bills: manual,
    bankLinks: [
      { id: "sample-link1", itemId: "sample", institution: "Sample Bank (demo)", link: "", cursor: "", lastSync: hoursAgo(2), scope: "personal" },
      { id: "sample-link2", itemId: "sample", institution: "Sample Business Bank (demo)", link: "", cursor: "", lastSync: hoursAgo(1), scope: "gladiator" },
    ],
  };
  const { found, scan } = detectRecurring(d, today);
  let k = 0;
  d = applyScan(d, found, scan, () => `sample-f${++k}`, today);
  for (const f of d.recurring) {
    const label = `${f.merchant.toUpperCase()}|${f.key.split("|")[2]}`;
    if (CONFIRMED.some((c) => (c.includes("|") ? label.startsWith(c.split("|")[0]) && label.endsWith(c.split("|")[1]) : label.startsWith(c)))) {
      let b = 0;
      d = confirmFinding(d, f.id, () => `sample-b${f.id}-${++b}`);
    }
  }
  return d;
}
