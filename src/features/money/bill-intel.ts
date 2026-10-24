import { addDays, billDatesBetween, nextDueAfter, today as todayYmd } from "./calc";
import type {
  Account,
  Bill,
  BillFrequency,
  BillScan,
  MoneyData,
  RecurringCadence,
  RecurringFinding,
  RecurringOccurrence,
  Scope,
  Transaction,
} from "./types";

/*
 * Bill intelligence: finds repeating payments in recent bank history, keeps
 * them as an editable dataset, and turns bills plus live balances into
 * Daily / Week / Month briefings. Everything here is a pure function of the
 * money data and today's date, so the same data always gives the same answer.
 *
 * Owners: bills and money are kept in two buckets that are never mixed unless
 * you pick "All entities": Personal / Maverick (personal and Maverick LLC)
 * and Gladiator (Gladiator Solutions Provider LLC).
 */

export type Bucket = "pm" | "gladiator";
export const BUCKETS: { id: Bucket; label: string; short: string }[] = [
  { id: "pm", label: "Personal / Maverick", short: "Personal / Maverick" },
  { id: "gladiator", label: "Gladiator", short: "Gladiator" },
];
export const bucketLabel = (b: Bucket | "all") => BUCKETS.find((x) => x.id === b)?.label ?? "All entities";
export const bucketOf = (scope: Scope | undefined): Bucket => (scope === "gladiator" ? "gladiator" : "pm");
/** Moving something into a bucket: Gladiator, or back to Personal / Maverick keeping Maverick if it was Maverick. */
export const scopeForBucket = (b: Bucket, current: Scope | undefined): Scope =>
  b === "gladiator" ? "gladiator" : current === "business" ? "business" : "personal";

/**
 * The scan reads up to two years of history (what a connected bank sends at
 * most), so yearly bills can be seen twice. That always covers the year to date
 * and the last 12 months; how far back your data really goes is shown as coverage.
 */
export const SCAN_DAYS = 730;
/** The "recent" view of what's still coming out. */
export const RECENT_DAYS = 120;
export const yearStart = (today: string) => `${today.slice(0, 4)}-01-01`;

const CADENCE: Record<Exclude<RecurringCadence, "irregular">, { days: number; lo: number; hi: number; label: string }> = {
  weekly: { days: 7, lo: 6, hi: 8, label: "Weekly" },
  biweekly: { days: 14, lo: 12, hi: 16, label: "Every 2 weeks" },
  monthly: { days: 30.4, lo: 24, hi: 38, label: "Monthly" },
  quarterly: { days: 91, lo: 80, hi: 100, label: "Every 3 months" },
  yearly: { days: 365, lo: 350, hi: 380, label: "Yearly" },
};
export const cadenceLabel = (c: RecurringCadence) => (c === "irregular" ? "Irregular" : CADENCE[c].label);
export const CADENCES: RecurringCadence[] = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"];
export const frequencyFor = (c: RecurringCadence): BillFrequency => (c === "irregular" ? "monthly" : c);

/* ---------------- Merchant names ---------------- */

const LEAD = /^(?:PURCHASE|PIN|PINCB|POS|EFT PAYMENT|ACH|WEB|DEBIT CARD|DEBIT|CHECKCARD|RECURRING|PREAUTHORIZED|ONLINE|TRANSFER|XFER)\b(?:\s+(?:PURCHASE|PAYMENT|DEBIT))?(?:\s+ON\s+\d{1,2}\/\d{1,2})?\s*/;
const STOP = new Set(["COM", "WWW", "HTTPS", "HTTP", "INC", "LLC", "CO", "THE", "BILL", "PMT", "PAYMENT", "ONLINE", "AND", "OF", "ON", "SVC", "TO"]);

/** "PURCHASE ON 04/25 NETFLIX.COM 866-579 CA" and "NETFLIX" both become "NETFLIX". */
export function merchantKey(description: string) {
  let s = description.toUpperCase();
  for (let i = 0; i < 3; i++) s = s.replace(LEAD, "");
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ").replace(/#\S*/g, " ").replace(/\*/g, " ");
  const words = s
    .split(/[^A-Z&-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .filter((w, i, all) => w !== all[i - 1]);
  return words.slice(0, 2).join(" ");
}

const NAMES: Record<string, string> = { BGE: "BG&E", "CHILD SUPPORT": "Child support", VERIZON: "Verizon" };
export function displayName(key: string, sample: string) {
  if (NAMES[key]) return NAMES[key];
  const name = key || sample;
  return name
    .toLowerCase()
    .replace(/(^|[\s-])[a-z]/g, (c) => c.toUpperCase())
    .slice(0, 40);
}

/* ---------------- What isn't a bill ---------------- */

const NOT_BILL_CATEGORIES = new Set(["Transfer", "Owner draw", "Owner contribution", "Sales tax collected", "Dining", "Groceries", "Business meals"]);
const SPEND_CATEGORIES = new Set(["Dining", "Groceries", "Business meals"]);
const NOT_INCOME_CATEGORIES = new Set(["Transfer", "Owner draw", "Owner contribution", "Sales tax collected"]);
const MOVEMENT = /\b(XFER|TRANSFER|ZELLE|VENMO|CASH ?APP|ATM|CASH WITHDRAWAL|WITHDRAWAL|DEPOSIT(ED)?|OVERDRAFT|NSF|REFUND|REVERSAL|RETURN|INTEREST PAID|FLASH FUNDS)\b|^RETURN-/i;

/*
 * Payments that are bills even though the bank files them as movement, and
 * kinds of spending that only make sense added up per month. Each gets one
 * name so its payments are looked at together.
 */
const CHECK = /^CHECK\b|\bCHECK ?#|\bCHECK NUMBER\b|^CHK\b/i;
const CHILD_SUPPORT = /CHILD ?SUPPORT|\bCSEA\b|\bCSES\b|\bSDU\b|FAMILY SUPPORT|SUPPORT ENFORCEMENT/i;
const PERSON_PAYMENT = /\b(ZELLE|VENMO|CASH ?APP)\b.*\b(TO|SENT|PAYMENT)\b|\b(TO|SENT|PAYMENT)\b.*\b(ZELLE|VENMO|CASH ?APP)\b/i;
const NOT_OUTGOING = /\b(DEPOSIT(ED)?|REFUND|REVERSAL|RETURN(ED)?|FROM)\b|^RETURN-/i;
/** Spending that's many small charges: one monthly total each, for the budget. */
export const MONTHLY_TOTALS: { key: string; name: string; re: RegExp }[] = [
  { key: "APPLE", name: "Apple (monthly total)", re: /\bAPPLE\b|APPLE ?\.?COM|\bITUNES\b|^APL\b|\bAPL\*/i },
  { key: "GAS STATIONS", name: "Gas (monthly total)", re: /\b(SHELL|EXXON|EXXONMOBIL|MOBIL|SUNOCO|CITGO|WAWA|ROYAL FARMS|SPEEDWAY|SHEETZ|CHEVRON|VALERO|MARATHON|HIGH'?S|GULF|LUKOIL|BP|CIRCLE K|7-ELEVEN FUEL|COSTCO GAS|SAM'?S FUEL|GAS STATION|FUEL)\b/i },
];
const BGE = /\bBGE\b|BG ?& ?E|BALTIMORE GAS/i;

/** The name a payment is grouped under when looking for bills. */
export function groupKey(t: Transaction): string {
  const d = t.description;
  if (CHILD_SUPPORT.test(d)) return "CHILD SUPPORT";
  if (BGE.test(d)) return "BGE";
  if (/VERIZON|\bVZW\b/i.test(d)) return "VERIZON";
  if (CHECK.test(d)) return `CHECK ${Math.round(t.amount)}`; // checks to the same payee are usually the same amount
  for (const m of MONTHLY_TOTALS) if (m.re.test(d)) return m.key;
  return merchantKey(d);
}
const totalFor = (key: string) => MONTHLY_TOTALS.find((m) => m.key === key);

// Paying a credit card or loan is a real recurring withdrawal, even when the bank calls it a transfer.
const CARD_PAYMENT = /\b(CRD PMT|CARD ?PAYMENT|CREDIT CARD|CC PMT|EPAYMENT|E-PAYMENT|AUTOPAY|AUTO PAY|PAYMENT TO|PMT TO|LOAN PMT|LOAN PAYMENT)\b/i;
export const isCardPayment = (t: Transaction) => t.category === "Debt payments" || CARD_PAYMENT.test(t.description);

/** Bump when the rules below change, so saved scans are redone. */
export const SCAN_RULES = 6;

export function isCandidate(t: Transaction, direction: "out" | "in") {
  if (direction === "out" && t.kind === "expense" && t.amount > 0 && t.transferId !== "imported" && isCardPayment(t) && !/\b(REFUND|REVERSAL|RETURN)\b/i.test(t.description)) return true;
  if (direction === "out" && t.kind === "expense" && t.amount > 0 && t.transferId !== "imported" && !NOT_OUTGOING.test(t.description)) {
    // Checks you wrote, child support and regular payments to a person are bills even when filed as transfers.
    if (CHECK.test(t.description) || CHILD_SUPPORT.test(t.description) || PERSON_PAYMENT.test(t.description)) return true;
    // Gas and Apple are added up per month even when filed as food or shopping.
    if (!t.transferId && MONTHLY_TOTALS.some((m) => m.re.test(t.description))) return true;
  }
  if (t.transferId) return false;
  if (direction === "out" ? t.kind !== "expense" : t.kind !== "income") return false;
  if ((direction === "out" ? NOT_BILL_CATEGORIES : NOT_INCOME_CATEGORIES).has(t.category)) return false;
  if (direction === "out" && MOVEMENT.test(t.description)) return false;
  if (direction === "in" && /\b(XFER|TRANSFER|ZELLE|VENMO|REFUND|REVERSAL|RETURN|INTEREST)\b|^RETURN-/i.test(t.description)) return false;
  return t.amount > 0;
}

/* ---------------- Detection ---------------- */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayNum = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000;
const weekday = (ymd: string) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay();

type Detected = Omit<RecurringFinding, "id" | "status" | "billId" | "overrides" | "updatedAt">;

/** The next date after `from` on this cadence, on the usual day. */
export function stepCadence(cadence: RecurringCadence, usualDay: number, from: string): string | null {
  if (cadence === "irregular") return null;
  return nextDueAfter(
    { frequency: cadence, dueDay: cadence === "monthly" || cadence === "quarterly" || cadence === "yearly" ? usualDay : 0, nextDue: from } as Bill,
    from,
  );
}

const RANK = { low: 1, medium: 2, high: 3 } as const;

/**
 * One owner's transactions with one merchant, turned into a finding or
 * nothing. When an odd extra charge spoils the pattern (a late fee, a one-time
 * purchase), the charges of the usual amount are tried on their own.
 */
function analyse(key: string, direction: "out" | "in", scope: Scope, txns: Transaction[], today: string, dataEnd = today): Detected | null {
  if (direction === "out" && totalFor(key)) return analyseMonthly(key, scope, txns, today);
  if (direction === "out" && key.startsWith("CAT ")) return analyseMonthly(key, scope, txns, today, `${key.slice(4)} (monthly total)`, 3);
  const full = analyseOnce(key, direction, scope, txns, today, dataEnd);
  if (full?.confidence === "high") return full;
  const typical = median(txns.map((t) => t.amount));
  const usual = txns.filter((t) => Math.abs(t.amount - typical) <= typical * 0.15);
  const latest = txns.reduce((m, t) => (t.date > m ? t.date : m), "");
  // Not when the odd one out is the latest charge: then the amount has changed.
  if (usual.length === txns.length || new Set(usual.map((t) => t.date)).size < 3 || !usual.some((t) => t.date === latest)) return full;
  const sub = analyseOnce(key, direction, scope, usual, today, dataEnd);
  if (!sub || (full && RANK[sub.confidence] <= RANK[full.confidence])) return full;
  const left = txns.length - usual.length;
  sub.reasons.push(`${left} other charge${left === 1 ? "" : "s"} of a different amount left out`);
  return sub;
}

function analyseOnce(key: string, direction: "out" | "in", scope: Scope, txns: Transaction[], today: string, dataEnd = today): Detected | null {
  // Several charges on the same day count once (summed); the same charge seen
  // twice (bank feed and a statement, or two accounts a day apart) counts once.
  const byDay = new Map<string, { amount: number; txns: Transaction[] }>();
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date) || (a.plaidId ? -1 : 1))) {
    const dup = [...byDay.entries()].some(
      ([d, v]) =>
        Math.abs(dayNum(d) - dayNum(t.date)) <= 1 &&
        v.txns.some((o) => Math.abs(o.amount - t.amount) < 0.01 && (o.accountId !== t.accountId || !!o.plaidId !== !!t.plaidId)),
    );
    if (dup) continue;
    const day = byDay.get(t.date) ?? { amount: 0, txns: [] };
    day.amount = round2(day.amount + t.amount);
    day.txns.push(t);
    byDay.set(t.date, day);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const n = days.length;
  if (n < 2) return n === 1 && direction === "out" && NAMES[key] ? seenOnce(key, scope, days[0][1].txns, today) : null; // a one-off

  const dates = days.map(([d]) => d);
  const amounts = days.map(([, v]) => v.amount);
  const gaps = dates.slice(1).map((d, i) => dayNum(d) - dayNum(dates[i]));
  const gap = median(gaps);
  const span = dayNum(dates[n - 1]) - dayNum(dates[0]);
  // Everyday spending at one place (many charges a month): one monthly total for the budget.
  if (gap < 5 || (span > 0 && (n / span) * 30 > 6)) return direction === "out" ? analyseMonthly(key, scope, txns, today, undefined, 3) : null;

  const typical = round2(median(amounts));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const spread = typical > 0 ? (max - min) / typical : 1;

  const match = (Object.keys(CADENCE) as (keyof typeof CADENCE)[]).find((c) => gap >= CADENCE[c].lo && gap <= CADENCE[c].hi);
  const regular = match ? gaps.filter((g) => g >= CADENCE[match].lo && g <= CADENCE[match].hi).length / gaps.length : 0;

  const reasons: string[] = [];
  let cadence: RecurringCadence;
  let confidence: Detected["confidence"];
  const enough = { weekly: 5, biweekly: 4, monthly: 3, quarterly: 3, yearly: 2 } as const;
  if (match && regular >= 0.6) {
    cadence = match;
    reasons.push(`${n} payments, usually ${Math.round(gap)} days apart (${cadenceLabel(match).toLowerCase()})`);
    if (regular >= 0.8 && n >= enough[match] && spread <= 0.15) confidence = "high";
    else if (spread <= 0.35 || (spread <= 1.5 && regular >= 0.8 && n >= enough[match])) confidence = "medium";
    else confidence = "low";
    if (n < enough[match]) reasons.push(`Only ${n} seen in the history scanned, so the timing is a best guess`);
    if (match === "yearly" && confidence === "high") {
      confidence = "medium";
      reasons.push("Seen once a year, so there are only two payments to go on");
    }
    if (regular < 0.8) reasons.push("Some gaps don't fit the pattern");
  } else if (n >= 3 && spread <= 0.15) {
    cadence = "irregular";
    confidence = "low";
    reasons.push(`${n} payments of about the same amount, but no steady timing`);
  } else {
    return null;
  }
  if (spread <= 0.005) reasons.push("Same amount every time");
  else if (spread <= 0.15) reasons.push("Amount varies a little");
  else reasons.push(`Amount varies from ${min.toFixed(2)} to ${max.toFixed(2)}`);

  const last = dates[n - 1];
  const usualDay =
    cadence === "weekly" || cadence === "biweekly" ? weekday(last) : Math.round(median(dates.map((d) => +d.slice(8, 10))));
  let nextExpected = stepCadence(cadence, usualDay, last);
  // The account's history stops early (an old statement, no live feed yet): the
  // bill hasn't stopped, we just can't see past that date. Keep projecting it.
  const historyEnds = cadence !== "irregular" && dayNum(today) - dayNum(dataEnd) > 7 && dayNum(dataEnd) - dayNum(last) <= CADENCE[cadence].days + 7;
  if (historyEnds && nextExpected) {
    let guard = 0;
    while (nextExpected && nextExpected < today && guard++ < 120) nextExpected = stepCadence(cadence, usualDay, nextExpected);
    reasons.push(`History for this account ends ${dataEnd}, so later dates are projected`);
  } else if (cadence !== "irregular" && dayNum(today) - dayNum(last) > 2 * CADENCE[cadence].days + 3) {
    // Quiet for more than two cycles: it may have stopped. Say so rather than predict.
    reasons.push(`Hasn't come out since ${last}; it may have stopped`);
    confidence = "low";
    nextExpected = null;
  } else if (nextExpected && nextExpected < today) {
    reasons.push(`Expected ${nextExpected} but not seen yet`);
  }

  const occurrences: RecurringOccurrence[] = days.flatMap(([, v]) =>
    v.txns.map((t) => ({ txnId: t.id, date: t.date, amount: t.amount, accountId: t.accountId, source: t.plaidId ? ("bank" as const) : ("statement" as const) })),
  );
  return {
    key: `${direction}|${key}|${bucketOf(scope)}`,
    direction,
    merchant: displayName(key, txns[0].description),
    scope,
    cadence,
    typical,
    min: round2(min),
    max: round2(max),
    firstDate: dates[0],
    lastDate: last,
    usualDay,
    nextExpected,
    confidence,
    reasons,
    occurrences,
    accountIds: [...new Set(occurrences.map((o) => o.accountId))],
    category: mostCommon(txns.map((t) => t.category)),
  };
}

/** A bill you'd always have (power, phone, child support) seen only once so far: assumed monthly. */
function seenOnce(key: string, scope: Scope, txns: Transaction[], today: string): Detected {
  const last = txns[0].date;
  const usualDay = +last.slice(8, 10);
  let next = stepCadence("monthly", usualDay, last);
  let guard = 0;
  while (next && next < today && guard++ < 60) next = stepCadence("monthly", usualDay, next);
  const amount = round2(txns.reduce((s, t) => s + t.amount, 0));
  return {
    key: `out|${key}|${bucketOf(scope)}`, direction: "out", merchant: displayName(key, txns[0].description), scope, cadence: "monthly",
    typical: amount, min: amount, max: amount, firstDate: last, lastDate: last, usualDay, nextExpected: next, confidence: "low",
    reasons: [`Seen once (${last}); assumed monthly until more payments show up`],
    occurrences: txns.map((t) => ({ txnId: t.id, date: t.date, amount: t.amount, accountId: t.accountId, source: t.plaidId ? ("bank" as const) : ("statement" as const) })),
    accountIds: [...new Set(txns.map((t) => t.accountId))], category: mostCommon(txns.map((t) => t.category)),
  };
}

/** Many small charges (Apple, gas) as one monthly amount: the usual month's total, due on the 1st. */
function analyseMonthly(key: string, scope: Scope, txns: Transaction[], today: string, name?: string, minMonths = 2): Detected | null {
  const thisMonth = today.slice(0, 7);
  const byMonth = new Map<string, number>();
  for (const t of txns) if (t.date.slice(0, 7) < thisMonth) byMonth.set(t.date.slice(0, 7), round2((byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount));
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  if (months.length < minMonths) return null;
  const totals = months.map(([, v]) => v);
  const typical = round2(median(totals));
  const dates = txns.map((t) => t.date).sort();
  const nextMonth = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 10);
  const occurrences: RecurringOccurrence[] = txns.map((t) => ({ txnId: t.id, date: t.date, amount: t.amount, accountId: t.accountId, source: t.plaidId ? ("bank" as const) : ("statement" as const) }));
  return {
    key: `out|${key}|${bucketOf(scope)}`,
    direction: "out",
    merchant: name ?? totalFor(key)?.name ?? `${displayName(key, txns[0].description)} (monthly total)`,
    scope,
    cadence: "monthly",
    typical,
    min: round2(Math.min(...totals)),
    max: round2(Math.max(...totals)),
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    usualDay: 1,
    nextExpected: nextMonth,
    confidence: months.length >= 3 ? "medium" : "low",
    reasons: [`${txns.length} charges over ${months.length} months, added up per month`, "Shown on the 1st as one budget line"],
    occurrences,
    accountIds: [...new Set(txns.map((t) => t.accountId))],
    category: mostCommon(txns.map((t) => t.category)),
  };
}

function mostCommon(xs: string[]) {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
}

/** Scans up to two years of posted transactions (the year to date, the last 12 months and before) for repeating bills and income. */
export function detectRecurring(d: MoneyData, today = todayYmd()) {
  const windowStart = addDays(today, -SCAN_DAYS);
  const scopeOf = new Map(d.accounts.map((a) => [a.id, a.scope ?? "personal"]));
  const unassigned = new Set(d.accounts.filter((a) => a.needsEntity).map((a) => a.id)); // no company yet: not looked at
  const inWindow = d.transactions.filter((t) => t.date >= windowStart && t.date <= today);
  const dataEnd = new Map<string, string>(); // newest transaction on each account
  for (const t of inWindow) if ((dataEnd.get(t.accountId) ?? "") < t.date) dataEnd.set(t.accountId, t.date);
  const found: Detected[] = [];
  for (const direction of ["out", "in"] as const) {
    const groups = new Map<string, { scope: Scope; key: string; txns: Transaction[] }>();
    for (const t of inWindow) {
      if (unassigned.has(t.accountId)) continue;
      const scope = scopeOf.get(t.accountId) ?? "personal";
      // Food and groceries aren't bills, but they repeat every month: one budget line per category.
      const spend = direction === "out" && t.kind === "expense" && !t.transferId && t.amount > 0 && SPEND_CATEGORIES.has(t.category) && !NOT_OUTGOING.test(t.description);
      if (!spend && !isCandidate(t, direction)) continue;
      let key = spend && !MONTHLY_TOTALS.some((m) => m.re.test(t.description)) ? `CAT ${t.category}` : groupKey(t);
      if (!key) continue;
      // Your word (2026-10-24): checks from the personal account are child support.
      if (direction === "out" && scope === "personal" && key.startsWith("CHECK ")) key = "CHILD SUPPORT";
      const g = `${bucketOf(scope)}|${key}`;
      const group = groups.get(g) ?? { scope, key, txns: [] };
      group.txns.push(t);
      groups.set(g, group);
    }
    for (const g of groups.values()) {
      // A finding takes the owner of the account most of its payments came from.
      const scope = mostCommon(g.txns.map((t) => scopeOf.get(t.accountId) ?? "personal")) as Scope;
      const ends = [...new Set(g.txns.map((t) => t.accountId))].map((id) => dataEnd.get(id) ?? today).sort();
      const f = analyse(g.key, direction, scope, g.txns, today, ends[ends.length - 1]);
      if (f) found.push(f);
    }
  }
  const scan: BillScan = {
    rules: SCAN_RULES,
    ranAt: new Date().toISOString(),
    windowStart,
    windowEnd: today,
    scanned: inWindow.length,
    bankFeed: inWindow.filter((t) => t.plaidId).length,
    statement: inWindow.filter((t) => !t.plaidId).length,
    found: found.length,
  };
  return { found, scan };
}

/**
 * Folds a new scan into the saved findings. Your decisions and edits are kept;
 * the evidence is refreshed. Confirmed bills that the bank shows were paid
 * move on to their next date.
 */
export function applyScan(d: MoneyData, found: Detected[], scan: BillScan, newId: () => string, today = todayYmd()): MoneyData {
  const now = new Date().toISOString();
  const old = new Map(d.recurring.map((f) => [f.key, f]));
  const seen = new Set<string>();
  const recurring: RecurringFinding[] = found.map((f) => {
    const prev = old.get(f.key);
    seen.add(f.key);
    const status: RecurringFinding["status"] = prev
      ? prev.status === "confirmed" && prev.billId && !d.bills.some((b) => b.id === prev.billId)
        ? "review" // its bill was deleted
        : prev.status
      : f.confidence === "high"
        ? "detected"
        : "review";
    return { ...f, id: prev?.id ?? newId(), status, billId: status === "confirmed" ? prev?.billId : undefined, overrides: prev?.overrides, updatedAt: now };
  });
  // Findings that no longer show up keep your decision but aren't refreshed.
  for (const f of d.recurring) if (!seen.has(f.key) && f.status !== "detected" && f.status !== "review") recurring.push(f);

  const bills = d.bills.map((b) => {
    const f = recurring.find((x) => x.billId === b.id);
    if (!f) return b;
    let next = b.nextDue;
    let guard = 0;
    // Paid at the bank on or after a few days before it was due: move it along.
    while (f.lastDate >= addDays(next, -5) && guard++ < 24) {
      const step = nextDueAfter(b, next);
      if (!step) break;
      next = step;
    }
    return next === b.nextDue ? b : { ...b, nextDue: next };
  });
  void today;
  return { ...d, recurring, bills, billScan: scan };
}

/** The finding as you've edited it: your changes win over what was detected. */
export function effective(f: RecurringFinding) {
  const o = f.overrides ?? {};
  const cadence = o.cadence ?? f.cadence;
  const nextDate = o.nextDate ?? (o.cadence && o.cadence !== f.cadence ? stepCadence(cadence, f.usualDay, f.lastDate) : f.nextExpected);
  return {
    name: o.name ?? f.merchant,
    scope: o.scope ?? f.scope,
    bucket: bucketOf(o.scope ?? f.scope),
    cadence,
    amount: o.amount ?? f.typical,
    nextDate,
    category: o.category ?? f.category,
    edited: Object.keys(o).length > 0,
  };
}

/** Turns an outgoing finding into a bill in your ledger. */
export function confirmFinding(d: MoneyData, id: string, newId: () => string): MoneyData {
  const f = d.recurring.find((x) => x.id === id);
  if (!f) return d;
  if (f.direction === "in") return { ...d, recurring: d.recurring.map((x) => (x.id === id ? { ...x, status: "confirmed" } : x)) };
  const e = effective(f);
  const nextDue = e.nextDate ?? stepCadence(e.cadence === "irregular" ? "monthly" : e.cadence, f.usualDay, f.lastDate) ?? todayYmd();
  const bill: Bill = {
    id: newId(),
    name: e.name,
    amount: e.amount,
    category: e.category,
    frequency: frequencyFor(e.cadence),
    nextDue,
    dueDay: e.cadence === "monthly" || e.cadence === "quarterly" || e.cadence === "yearly" || e.cadence === "irregular" ? f.usualDay : Number(nextDue.slice(8, 10)),
    accountId: f.accountIds[0] ?? "",
    autopay: true,
    scope: e.scope,
    recurringId: f.id,
    note: f.cadence === "irregular" && !f.overrides?.cadence ? "Detected with no steady timing; check how often it comes out." : undefined,
  };
  return {
    ...d,
    bills: [...d.bills, bill],
    recurring: d.recurring.map((x) => (x.id === id ? { ...x, status: "confirmed", billId: bill.id } : x)),
  };
}

export function setFindingStatus(d: MoneyData, id: string, status: RecurringFinding["status"]): MoneyData {
  return { ...d, recurring: d.recurring.map((x) => (x.id === id ? { ...x, status } : x)) };
}

export function editFinding(d: MoneyData, id: string, patch: NonNullable<RecurringFinding["overrides"]>): MoneyData {
  return {
    ...d,
    recurring: d.recurring.map((x) => {
      if (x.id !== id) return x;
      const overrides = { ...(x.overrides ?? {}), ...patch };
      for (const k of Object.keys(overrides) as (keyof typeof overrides)[]) if (overrides[k] === undefined || overrides[k] === "") delete overrides[k];
      return { ...x, overrides };
    }),
  };
}

/* ---------------- What history is actually here ---------------- */

export type Coverage = {
  first: string | null; // earliest transaction in the range, across the owner's accounts
  last: string | null;
  count: number;
  accounts: { account: Account; first: string | null; last: string | null; count: number; bank: number; statement: number }[];
  full: boolean; // history reaches back to the start of the range (within a week)
};

/** Which dates the owner's transactions really cover inside [start, end], account by account. */
export function coverage(d: MoneyData, bucket: Bucket | "all", start: string, end: string): Coverage {
  const accts = d.accounts.filter((a) => bucket === "all" || bucketOf(a.scope) === bucket);
  const rows = accts.map((account) => {
    const ts = d.transactions.filter((t) => t.accountId === account.id && t.date >= start && t.date <= end);
    const dates = ts.map((t) => t.date).sort();
    return { account, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null, count: ts.length, bank: ts.filter((t) => t.plaidId).length, statement: ts.filter((t) => !t.plaidId).length };
  });
  const firsts = rows.map((r) => r.first).filter((x): x is string => !!x).sort();
  const lasts = rows.map((r) => r.last).filter((x): x is string => !!x).sort();
  const first = firsts[0] ?? null;
  return { first, last: lasts[lasts.length - 1] ?? null, count: rows.reduce((s, r) => s + r.count, 0), accounts: rows, full: !!first && first <= addDays(start, 7) };
}

/* ---------------- Money on hand ---------------- */

export const FRESH_HOURS = 24;
const CASH_TYPES = new Set(["checking", "savings", "cash"]);

export type CashAccount = {
  account: Account;
  balance: number | null;
  kind: "available" | "current" | null;
  asOf: string | null;
  status: "live" | "stale" | "reconnect" | "unlinked";
};

/** Each spending account of a bucket and whether its balance is fresh from the bank. */
export function cashAccounts(d: MoneyData, bucket: Bucket, now = Date.now()): CashAccount[] {
  return d.accounts
    .filter((a) => CASH_TYPES.has(a.type) && bucketOf(a.scope) === bucket)
    .map((a) => {
      if (!a.plaid) return { account: a, balance: null, kind: null, asOf: null, status: "unlinked" as const };
      const link = d.bankLinks.find((l) => l.id === a.plaid!.linkId);
      if (!link || link.error) return { account: a, balance: null, kind: null, asOf: link?.lastSync ?? null, status: "reconnect" as const };
      const bb = a.bankBalance;
      const balance = bb ? (bb.available ?? bb.current) : null;
      const kind = bb ? (bb.available !== null ? ("available" as const) : ("current" as const)) : null;
      const asOf = bb?.asOf ?? link.lastSync ?? null;
      const fresh = !!asOf && now - new Date(asOf).getTime() <= FRESH_HOURS * 3600 * 1000;
      if (balance === null) return { account: a, balance: null, kind: null, asOf, status: "stale" as const };
      return { account: a, balance, kind, asOf, status: fresh ? ("live" as const) : ("stale" as const) };
    });
}

/* ---------------- Briefings ---------------- */

export type ReportKind = "day" | "week" | "month";

export type ReportLine = {
  date: string;
  name: string;
  amount: number;
  bucket: Bucket;
  status: "scheduled" | "possible" | "incoming" | "incoming-unconfirmed";
  billId?: string;
  findingId?: string;
  accountId?: string;
  overdue?: boolean;
};

export type BucketReport = {
  bucket: Bucket;
  cash: CashAccount[];
  available: number | null; // sum of fresh balances; null when none are fresh
  staleOrMissing: number; // spending accounts without a fresh balance
  lines: ReportLine[];
  outgoing: number; // confirmed bills in the window
  possible: number; // detected, not yet confirmed (not counted)
  incoming: number; // confirmed income (counted)
  projected: number | null; // available + incoming - outgoing
  alert: "short" | "tight" | null;
  overdue: number;
};

export function reportWindow(kind: ReportKind, today = todayYmd()) {
  const days = kind === "day" ? 2 : kind === "week" ? 7 : 30;
  return { start: today, end: addDays(today, days - 1) };
}

export function bucketReport(d: MoneyData, bucket: Bucket, start: string, end: string, today = todayYmd(), now = Date.now()): BucketReport {
  const lines: ReportLine[] = [];
  for (const b of d.bills) {
    if (bucketOf(b.scope) !== bucket) continue;
    // Past due and still unpaid counts today, so it isn't forgotten.
    if (b.nextDue < start && start === today) lines.push({ date: b.nextDue, name: b.name, amount: b.amount, bucket, status: "scheduled", billId: b.id, accountId: b.accountId, overdue: true });
    for (const x of billDatesBetween(b, start, end)) if (!x.paid) lines.push({ date: x.date, name: b.name, amount: b.amount, bucket, status: "scheduled", billId: b.id, accountId: b.accountId });
  }
  for (const f of d.recurring) {
    const e = effective(f);
    if (e.bucket !== bucket || f.status === "dismissed" || (f.status === "confirmed" && f.direction === "out")) continue;
    let date = e.nextDate;
    let guard = 0;
    while (date && date <= end && guard++ < 10) {
      if (date >= start) {
        const status = f.direction === "out" ? "possible" : f.status === "confirmed" ? "incoming" : "incoming-unconfirmed";
        lines.push({ date, name: e.name, amount: e.amount, bucket, status, findingId: f.id, accountId: f.accountIds[0] });
      }
      date = stepCadence(e.cadence, f.usualDay, date);
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const sum = (s: ReportLine["status"]) => round2(lines.filter((l) => l.status === s).reduce((t, l) => t + l.amount, 0));
  const cash = cashAccounts(d, bucket, now);
  const live = cash.filter((c) => c.status === "live");
  const available = live.length ? round2(live.reduce((t, c) => t + (c.balance ?? 0), 0)) : null;
  const outgoing = sum("scheduled");
  const incoming = sum("incoming");
  const projected = available === null ? null : round2(available + incoming - outgoing);
  const alert =
    projected === null ? null : projected < 0 ? "short" : available !== null && outgoing > 0 && projected < Math.max(250, available * 0.15) ? "tight" : null;
  return {
    bucket,
    cash,
    available,
    staleOrMissing: cash.length - live.length,
    lines,
    outgoing,
    possible: sum("possible"),
    incoming,
    projected,
    alert,
    overdue: lines.filter((l) => l.overdue).length,
  };
}

/** Bills due in the calendar month after this one, for the monthly look-ahead's rollup. */
export function nextMonthRollup(d: MoneyData, bucket: Bucket, today = todayYmd()) {
  const [y, m] = today.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const start = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const end = addDays(nm === 12 ? `${ny + 1}-01-01` : `${ny}-${String(nm + 1).padStart(2, "0")}-01`, -1);
  const r = bucketReport(d, bucket, start, end, today);
  return { label: new Date(ny, nm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }), start, end, outgoing: r.outgoing, count: r.lines.filter((l) => l.status === "scheduled").length, incoming: r.incoming };
}

/** Plain-text briefing, the same every time for the same data. */
export function briefingText(kind: ReportKind, reports: BucketReport[], fmt: (n: number) => string) {
  const title = kind === "day" ? "Daily briefing (today and tomorrow)" : kind === "week" ? "Weekly briefing (next 7 days)" : "Monthly look-ahead (next 30 days)";
  const out = [title];
  for (const r of reports) {
    out.push("", bucketLabel(r.bucket).toUpperCase());
    out.push(r.available === null ? "Money available: no fresh bank balance (sync or reconnect)" : `Money available: ${fmt(r.available)}`);
    out.push(`Bills due: ${fmt(r.outgoing)} (${r.lines.filter((l) => l.status === "scheduled").length})`);
    if (r.incoming) out.push(`Confirmed money coming in: ${fmt(r.incoming)}`);
    if (r.projected !== null) out.push(`After bills: ${fmt(r.projected)}`);
    if (r.alert === "short") out.push("WARNING: bills are more than the money available.");
    if (r.alert === "tight") out.push("Heads up: bills leave little room.");
    for (const l of r.lines.filter((x) => x.status === "scheduled")) out.push(`  ${l.date}  ${l.name}  ${fmt(l.amount)}${l.overdue ? "  (past due)" : ""}`);
  }
  return out.join("\n");
}
