import { addDays, today as todayYmd } from "./calc";
import { bucketOf, displayName, effective, merchantKey, coverage, type Bucket, type Coverage } from "./bill-intel";
import type { MoneyData, RecurringFinding, Transaction } from "./types";

/*
 * Spending intelligence: "what did I spend, and where?" A pure function of
 * the money data, a date range and a few switches. Money moved between your
 * own accounts, card payments and money coming in are left out of spending
 * unless you turn them on, and the report always says what it left out.
 */

export type RangeId = "ytd" | "month" | "30" | "90" | "120" | "12m" | "lastYear" | "custom";
export const RANGES: { id: RangeId; label: string; short: string }[] = [
  { id: "ytd", label: "Year to date", short: "YTD" },
  { id: "month", label: "This month", short: "This month" },
  { id: "30", label: "Last 30 days", short: "30 days" },
  { id: "90", label: "Last 90 days", short: "90 days" },
  { id: "120", label: "Last 120 days", short: "120 days" },
  { id: "12m", label: "Last 12 months", short: "12 months" },
  { id: "lastYear", label: "Last calendar year", short: "Last year" },
  { id: "custom", label: "Custom dates", short: "Custom" },
];

export type Range = { start: string; end: string; label: string };

const dayNum = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000;
export const daysIn = (r: { start: string; end: string }) => Math.max(1, dayNum(r.end) - dayNum(r.start) + 1);
const shiftYear = (ymd: string, by: number) => {
  const y = +ymd.slice(0, 4) + by;
  // 29 Feb becomes 28 Feb in a short year.
  return ymd.slice(5) === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? `${y}-02-28` : `${y}${ymd.slice(4)}`;
};

export function rangeFor(id: RangeId, today = todayYmd(), custom?: { start: string; end: string }): Range {
  const y = today.slice(0, 4);
  const label = RANGES.find((r) => r.id === id)!.label;
  switch (id) {
    case "ytd":
      return { start: `${y}-01-01`, end: today, label };
    case "month":
      return { start: `${today.slice(0, 7)}-01`, end: today, label };
    case "30":
    case "90":
    case "120":
      return { start: addDays(today, -(+id - 1)), end: today, label };
    case "12m":
      return { start: addDays(shiftYear(today, -1), 1), end: today, label };
    case "lastYear":
      return { start: `${+y - 1}-01-01`, end: `${+y - 1}-12-31`, label };
    case "custom": {
      const start = custom?.start || `${y}-01-01`;
      const end = custom?.end && custom.end >= start ? custom.end : today;
      return { start, end, label };
    }
  }
}

/** The comparable period before: the same dates a year earlier for calendar ranges, otherwise the same number of days just before. */
export function priorRange(id: RangeId, r: Range): Range {
  if (id === "ytd" || id === "lastYear" || id === "12m" || id === "month") {
    const start = id === "month" ? monthBack(r.start) : shiftYear(r.start, -1);
    const end = id === "month" ? addDays(start, daysIn(r) - 1) : shiftYear(r.end, -1);
    return { start, end, label: id === "month" ? "same days last month" : "same dates a year earlier" };
  }
  const n = daysIn(r);
  return { start: addDays(r.start, -n), end: addDays(r.start, -1), label: `the ${n} days before` };
}
function monthBack(firstOfMonth: string) {
  const [y, m] = firstOfMonth.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/* ---------------- What counts as spending ---------------- */

export type SpendOptions = {
  includeTransfers: boolean; // money moved between your own accounts, owner draws and contributions
  includeCardPayments: boolean; // paying off a card or loan from checking (the purchases are already counted on the card)
  netRefunds: boolean; // subtract refunds and returns from what they refunded
  accountId: string; // "" = every account
  category: string; // "" = every category
  merchant: string; // "" = every payee
  min: string;
  max: string;
  query: string;
};
export const DEFAULT_SPEND_OPTIONS: SpendOptions = {
  includeTransfers: false,
  includeCardPayments: false,
  netRefunds: false,
  accountId: "",
  category: "",
  merchant: "",
  min: "",
  max: "",
  query: "",
};
export function activeFilterCount(o: SpendOptions) {
  return (Object.keys(DEFAULT_SPEND_OPTIONS) as (keyof SpendOptions)[]).filter((k) => o[k] !== DEFAULT_SPEND_OPTIONS[k]).length;
}

const TRANSFER_CATEGORIES = new Set(["Transfer", "Owner draw", "Owner contribution"]);
const CARD_PAYMENT = /\bPAYMENT THANK YOU\b|\bAUTOPAY PAYMENT\b|\b(CARD|CRD) (PAYMENT|PMT)\b|\b(AMEX|AMERICAN EXPRESS|DISCOVER|CAPITAL ONE|CHASE CARD|CITI CARD|BARCLAYCARD|SYNCHRONY|CARDMEMBER)\b.*\b(PAYMENT|PMT|EPAY|AUTOPAY)\b/i;
const REFUND = /\b(REFUND|RETURN|REVERSAL|CREDIT ADJ|MERCHANDISE CREDIT|CHARGEBACK)\b|^RETURN-/i;
const GENERIC = new Set(["", "Other", "Other business expenses", "Uncategorized", "Miscellaneous"]);

export type SpendKind = "spending" | "refund" | "transfer" | "card-payment" | "income";

export function spendKind(t: Transaction, isCredit: boolean): SpendKind {
  if (t.transferId || TRANSFER_CATEGORIES.has(t.category)) return "transfer";
  if (t.category === "Credit card payment" || CARD_PAYMENT.test(t.description)) return "card-payment";
  // A credit on a card is almost always a refund; on a bank account only when it says so.
  if (t.kind === "income") return REFUND.test(t.description) || isCredit ? "refund" : "income";
  return "spending";
}

/* Plain keyword guesses for transactions still sitting in a catch-all
 * category. Shown as suggestions only; nothing changes until you apply one. */
const SUGGEST: [RegExp, string, string][] = [
  // [pattern, personal category, company category]
  [/grocery|safeway|kroger|giant|wegmans|aldi|trader joe|whole foods|publix|food lion|harris teeter/i, "Groceries", "Supplies"],
  [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|doordash|uber eats|grubhub|pizza|dunkin|grill|diner|taco|burger/i, "Dining", "Business meals"],
  [/shell|exxon|chevron|sunoco|bp\b|wawa|sheetz|citgo|fuel|gas station|parking|toll|e-?zpass|uber|lyft/i, "Transportation", "Vehicle"],
  [/verizon|at&t|t-mobile|comcast|xfinity|spectrum|cox|electric|energy|power|water|bge|pepco/i, "Utilities", "Utilities, phone & internet"],
  [/netflix|spotify|hulu|disney|apple\.com|google|youtube|prime video|membership|subscription|adobe|microsoft/i, "Subscriptions", "Software & subscriptions"],
  [/amazon|amzn|walmart|target|costco|best buy|home depot|lowe|\bmart\b/i, "Shopping", "Supplies"],
  [/courier|shipping|fedex|\bups\b|usps|postal|stamps/i, "Other", "Office expenses"],
  [/pharmacy|cvs|walgreens|rite aid|doctor|dental|clinic|hospital|gym|fitness/i, "Health", "Other business expenses"],
  [/insurance|geico|progressive|state farm|allstate/i, "Insurance", "Business insurance"],
  [/\brent\b|apartment|apts|mortgage|hoa\b/i, "Housing", "Rent"],
];
export function suggestCategory(t: Transaction, company: boolean): string | null {
  if (!GENERIC.has(t.category)) return null;
  const hit = SUGGEST.find(([re]) => re.test(t.description));
  if (!hit) return null;
  const s = company ? hit[2] : hit[1];
  return s === t.category ? null : s;
}

/* ---------------- The report ---------------- */

export type SpendRow = {
  t: Transaction;
  bucket: Bucket;
  merchant: string;
  merchantId: string; // merchantKey, or the description when there's no key
  amount: number; // positive spends; negative for a refund when refunds are netted
  kind: SpendKind;
  obligation: boolean; // a recurring bill rather than everyday spending
  finding?: RecurringFinding;
  categorySource: "you" | "auto"; // you picked it, or it came from the bank, a rule or a statement import
  suggestion: string | null;
};

export type Group = { id: string; name: string; amount: number; count: number; share: number; obligation: number; rows: SpendRow[]; finding?: RecurringFinding; last: string };

export type SpendReport = {
  bucket: Bucket | "all";
  range: Range;
  rows: SpendRow[]; // counted rows, newest first
  total: number;
  count: number;
  obligations: number;
  everyday: number;
  perWeek: number;
  perMonth: number;
  paceDays: number; // days the pace is worked out over (only days you have history for)
  byCategory: Group[];
  byMerchant: Group[];
  left: { kind: SpendKind; amount: number; count: number }[]; // what was left out, and how much
  cover: Coverage;
  compare: { prior: Range; total: number; change: number | null } | null; // null when history doesn't reach back far enough
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function rowsFor(d: MoneyData, bucket: Bucket | "all", range: Range, o: SpendOptions) {
  const accounts = new Map(d.accounts.map((a) => [a.id, a]));
  // Repeating bills: confirmed, detected or under review, but not dismissed; and bills in your list.
  const findings = new Map<string, RecurringFinding>();
  for (const f of d.recurring) if (f.direction === "out" && f.status !== "dismissed") findings.set(`${merchantKey(f.merchant)}|${effective(f).bucket}`, f);
  const findingByKey = new Map<string, RecurringFinding>();
  for (const f of d.recurring) if (f.direction === "out" && f.status !== "dismissed") findingByKey.set(f.key, f);
  const billKeys = new Set(d.bills.map((b) => `${merchantKey(b.name)}|${bucketOf(b.scope)}`));
  const min = o.min ? Number(o.min) : null;
  const max = o.max ? Number(o.max) : null;
  const q = o.query.trim().toLowerCase();

  const counted: SpendRow[] = [];
  const left = new Map<SpendKind, { amount: number; count: number }>();
  for (const t of d.transactions) {
    if (t.date < range.start || t.date > range.end) continue;
    const a = accounts.get(t.accountId);
    const b = bucketOf(a?.scope);
    if (bucket !== "all" && b !== bucket) continue;
    if (o.accountId && t.accountId !== o.accountId) continue;
    const kind = spendKind(t, a?.type === "credit" || a?.type === "loan");
    const keep =
      kind === "spending" || (kind === "transfer" && o.includeTransfers && t.kind === "expense") || (kind === "card-payment" && o.includeCardPayments && t.kind === "expense") || (kind === "refund" && o.netRefunds);
    if (!keep) {
      // A move between your own accounts shows up twice; count the money going out once.
      if ((kind !== "transfer" && kind !== "card-payment") || t.kind === "expense") {
        const l = left.get(kind) ?? { amount: 0, count: 0 };
        l.amount = round2(l.amount + t.amount);
        l.count++;
        left.set(kind, l);
      }
      continue;
    }
    const key = merchantKey(t.description);
    const merchantId = key || t.description.toUpperCase();
    if (o.category && t.category !== o.category) continue;
    if (o.merchant && merchantId !== o.merchant) continue;
    if (min !== null && t.amount < min) continue;
    if (max !== null && t.amount > max) continue;
    if (q && !`${t.description} ${t.category}`.toLowerCase().includes(q)) continue;
    const finding = findingByKey.get(`out|${key}|${b}`) ?? findings.get(`${key}|${b}`);
    counted.push({
      t,
      bucket: b,
      merchant: displayName(key, t.description),
      merchantId,
      amount: kind === "refund" ? -t.amount : t.amount,
      kind,
      obligation: kind === "spending" && (!!finding || billKeys.has(`${key}|${b}`)),
      finding,
      categorySource: t.categoryLocked ? "you" : "auto",
      suggestion: suggestCategory(t, b === "gladiator" || a?.scope === "business"),
    });
  }
  counted.sort((x, y) => y.t.date.localeCompare(x.t.date) || y.amount - x.amount);
  return { counted, left };
}

function group(rows: SpendRow[], keyOf: (r: SpendRow) => string, nameOf: (r: SpendRow) => string, total: number): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const id = keyOf(r);
    const g = m.get(id) ?? { id, name: nameOf(r), amount: 0, count: 0, share: 0, obligation: 0, rows: [], last: "" };
    g.amount = round2(g.amount + r.amount);
    g.count++;
    if (r.obligation) g.obligation = round2(g.obligation + r.amount);
    g.rows.push(r);
    if (r.t.date > g.last) g.last = r.t.date;
    g.finding ??= r.finding;
    m.set(id, g);
  }
  return [...m.values()].map((g) => ({ ...g, share: total > 0 ? g.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
}

export function spendReport(d: MoneyData, bucket: Bucket | "all", rangeId: RangeId, o: SpendOptions, today = todayYmd(), custom?: { start: string; end: string }): SpendReport {
  const range = rangeFor(rangeId, today, custom);
  const { counted, left } = rowsFor(d, bucket, range, o);
  const total = round2(counted.reduce((s, r) => s + r.amount, 0));
  const obligations = round2(counted.filter((r) => r.obligation).reduce((s, r) => s + r.amount, 0));
  const cover = coverage(d, bucket, range.start, range.end);
  // Pace over the days you actually have history for, not days before your data starts.
  const paceStart = cover.first && cover.first > range.start ? cover.first : range.start;
  const paceEnd = range.end > today ? today : range.end;
  const paceDays = paceEnd >= paceStart ? daysIn({ start: paceStart, end: paceEnd }) : 1;

  // Compare only when history reaches back to cover the whole earlier period.
  const prior = priorRange(rangeId, range);
  const before = coverage(d, bucket, addDays(prior.start, -400), prior.end);
  let compare: SpendReport["compare"] = null;
  if (before.first && before.first <= addDays(prior.start, 3) && rangeId !== "custom") {
    const p = rowsFor(d, bucket, prior, o).counted.reduce((s, r) => s + r.amount, 0);
    compare = { prior, total: round2(p), change: p > 0 ? (total - p) / p : null };
  }

  return {
    bucket,
    range,
    rows: counted,
    total,
    count: counted.length,
    obligations,
    everyday: round2(total - obligations),
    perWeek: round2((total / paceDays) * 7),
    perMonth: round2((total / paceDays) * 30.44),
    paceDays,
    byCategory: group(counted, (r) => r.t.category || "Uncategorized", (r) => r.t.category || "Uncategorized", total),
    byMerchant: group(counted, (r) => r.merchantId, (r) => r.merchant, total),
    left: [...left.entries()].map(([kind, v]) => ({ kind, ...v })),
    cover,
    compare,
  };
}

export const LEFT_LABEL: Record<SpendKind, string> = {
  spending: "Spending",
  refund: "Refunds and returns",
  transfer: "Moves between your own accounts",
  "card-payment": "Card and loan payments",
  income: "Money coming in",
};

export function spendCsv(rows: SpendRow[], accountName: (id: string) => string) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["Date,Owner,Account,Payee,Description,Category,Bill or everyday,Amount"];
  for (const r of rows)
    lines.push(
      [r.t.date, r.bucket === "gladiator" ? "Gladiator" : "Personal / Maverick", accountName(r.t.accountId), r.merchant, r.t.description, r.t.category, r.obligation ? "Bill" : "Everyday", r.amount.toFixed(2)]
        .map((x) => esc(String(x)))
        .join(","),
    );
  return lines.join("\n");
}
