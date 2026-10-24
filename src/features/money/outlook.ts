import { accountLabel } from "./accounts-fix";
import { accountBalance, addDays, billDatesBetween, today as todayYmd } from "./calc";
import { effective, FRESH_HOURS, stepCadence } from "./bill-intel";
import type { Account, MoneyData, RecurringCadence, RecurringFinding, Scope, Transaction } from "./types";

/*
 * The Money outlook: everything combined across Personal, Maverick and
 * Gladiator, with each row tagged by entity and account. Upcoming bills come
 * only from your own data: bills you confirmed or added, and recurring
 * withdrawals found in your transactions (always marked as predictions).
 */

export const ENTITIES: { id: Scope; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "business", label: "Maverick" },
  { id: "gladiator", label: "Gladiator" },
];

export const entityLabel = (s: Scope | undefined) => ENTITIES.find((e) => e.id === (s ?? "personal"))!.label;
export const entityOf = (a: Account | undefined): Scope => a?.scope ?? "personal";
/** Accounts with no company yet count toward none of them. */
const counts = (a: Account | undefined) => !!a && !a.needsEntity;

const isCash = (a: Account) => a.type === "checking" || a.type === "savings";

/** Where an account's balance comes from, so "not current" always says why. */
export type BalanceState =
  | "bank" // the bank's balance from the last sync
  | "bank-old" // the bank's balance, but the last sync is over a day old (still shown and counted)
  | "waiting" // connected, but the bank hasn't sent a balance yet
  | "lost" // has bank transactions, but its bank connection is gone, so no live balance
  | "unlinked"; // never connected to a bank (typed in or filled from statements)

export type AccountLine = {
  name: string; // your name for it, else the bank's
  bankName?: string; // the bank's name, when you've named it yourself
  last4?: string;
  amount: number | null; // cash: available (else current); cards: owed
  credit?: number | null; // cards: credit left
  state: BalanceState;
  asOf: string | null; // when the bank gave this balance
  lastSync: string | null; // last successful sync of its bank connection
  twin?: string; // the same account number is connected under another entity
  lastBankTxn?: string; // date of its latest bank transaction, when the connection is gone
};

export type EntityBalance = {
  entity: Scope;
  available: number; // cash in checking and savings, from the banks' balances
  counted: number; // accounts with a bank balance
  stale: number; // checking/savings accounts without a bank balance (not counted)
  old: number; // of the counted ones, how many are over a day old
  accounts: AccountLine[]; // checking and savings, by bank name
  cards: AccountLine[]; // credit cards and loans: money owed, not cash
  owed: number; // total owed on cards and loans with a bank balance
  asOf: string | null; // oldest bank balance counted
};

const isDebt = (a: Account) => a.type === "credit" || a.type === "loan";

/**
 * Each entity's cash from the balances the banks sent on the last sync. A
 * balance the bank sent is always used, however old; it's marked with its
 * time, never swapped for "not current". Card and loan balances are owed, not cash.
 */
export function balances(d: MoneyData, now = Date.now()): EntityBalance[] {
  const links = new Map(d.bankLinks.map((l) => [l.id, l]));
  const line = (a: Account): AccountLine => {
    const link = a.plaid ? links.get(a.plaid.linkId) : undefined;
    const bb = a.bankBalance;
    const lastSync = link?.lastSync ?? null;
    const has = !!bb && (bb.current !== null || bb.available !== null);
    const bankDates = !link ? d.transactions.filter((t) => t.accountId === a.id && t.plaidId).map((t) => t.date) : [];
    const lastBankTxn = bankDates.length ? bankDates.sort().at(-1) : undefined;
    const state: BalanceState = !link ? (has ? "bank-old" : lastBankTxn ? "lost" : "unlinked") : !has ? "waiting" : now - new Date(bb!.asOf).getTime() > FRESH_HOURS * 3600_000 ? "bank-old" : "bank";
    const twin = !link
      ? d.accounts.find((x) => x.id !== a.id && x.last4 && x.last4 === a.last4 && isDebt(x) === isDebt(a) && x.plaid && links.has(x.plaid.linkId))
      : undefined;
    const amount = !has ? null : isDebt(a) ? (bb!.current ?? 0) : (bb!.available ?? bb!.current ?? 0);
    return {
      name: accountLabel(a),
      bankName: a.nickname ? a.name : undefined,
      last4: a.last4,
      amount,
      credit: isDebt(a) && has ? (bb!.available ?? null) : undefined,
      state,
      asOf: has ? bb!.asOf : null,
      lastSync,
      twin: twin ? entityLabel(entityOf(twin)) : undefined,
      lastBankTxn,
    };
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return ENTITIES.map(({ id }) => {
    const mine = d.accounts.filter((x) => counts(x) && entityOf(x) === id && !(x.plaid && d.bankLinks.find((l) => l.id === x.plaid!.linkId)?.duplicateOf));
    const accounts = mine.filter(isCash).map(line);
    const cards = mine.filter(isDebt).map(line);
    const counted = accounts.filter((x) => x.amount !== null);
    const asOf = counted.map((x) => x.asOf!).sort()[0] ?? null;
    return {
      entity: id,
      available: r2(counted.reduce((s, x) => s + x.amount!, 0)),
      counted: counted.length,
      stale: accounts.length - counted.length,
      old: counted.filter((x) => x.state === "bank-old").length,
      accounts,
      cards,
      owed: r2(cards.reduce((s, x) => s + (x.amount ?? 0), 0)),
      asOf,
    };
  });
}

export type Confidence = "confirmed" | "high" | "medium" | "low";
export const CONFIDENCE_LABEL: Record<Confidence, string> = { confirmed: "Confirmed", high: "Likely", medium: "Possible", low: "Unsure" };

export type UpcomingLine = {
  key: string;
  date: string;
  name: string;
  amount: number;
  cadence: RecurringCadence | string;
  confidence: Confidence;
  predicted: boolean; // found in your history, not confirmed by you
  entity: Scope;
  account: string;
  findingId?: string;
  billId?: string;
};

const CADENCE_WORD: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  irregular: "Irregular",
  once: "Once",
};
export const cadenceWord = (c: string) => CADENCE_WORD[c] ?? c;

/** Upcoming withdrawals from today through `days` days ahead, every entity, by date. */
export function upcoming(d: MoneyData, days = 30, t = todayYmd()): UpcomingLine[] {
  const end = addDays(t, days - 1);
  const acct = new Map(d.accounts.map((a) => [a.id, a]));
  const out: UpcomingLine[] = [];
  const billsFromFindings = new Set<string>();

  for (const b of d.bills) {
    if (b.recurringId) billsFromFindings.add(b.recurringId);
    if (b.accountId && acct.get(b.accountId)?.needsEntity) continue;
    for (const { date, paid } of billDatesBetween(b, t, end)) {
      if (paid) continue; // already marked paid
      const a = b.accountId ? acct.get(b.accountId) : undefined;
      out.push({
        key: `b:${b.id}:${date}`,
        date,
        name: b.name,
        amount: b.amount,
        cadence: b.frequency,
        confidence: "confirmed",
        predicted: false,
        entity: b.scope ?? entityOf(a),
        account: a ? accountLabel(a) : "",
        billId: b.id,
      });
    }
  }

  for (const f of d.recurring) {
    if (f.accountIds.length && !f.accountIds.some((id) => counts(acct.get(id)))) continue;
    if (f.direction !== "out" || f.status === "dismissed" || billsFromFindings.has(f.id) || (f.billId && d.bills.some((b) => b.id === f.billId))) continue;
    const e = effective(f);
    let date = e.nextDate;
    const a = acct.get(f.accountIds[0] ?? "");
    for (let n = 0; date && date <= end && n < 60; n++) {
      if (date >= t)
        out.push({
          key: `f:${f.id}:${date}`,
          date,
          name: e.name,
          amount: e.amount,
          cadence: e.cadence,
          confidence: f.status === "confirmed" ? "confirmed" : f.confidence,
          predicted: f.status !== "confirmed",
          entity: e.scope,
          account: a ? accountLabel(a) : "",
          findingId: f.id,
        });
      date = stepCadence(e.cadence, f.usualDay, date);
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || y.amount - x.amount);
}

export const total = (lines: UpcomingLine[], entity?: Scope, days?: number, t = todayYmd()) => {
  const end = days ? addDays(t, days - 1) : "9999";
  return Math.round(lines.filter((l) => (!entity || l.entity === entity) && l.date <= end).reduce((s, l) => s + l.amount, 0) * 100) / 100;
};

/* ---------------- All recurring bills ---------------- */

export type BillStatus = "confirmed" | "autopay" | "review";
export const STATUS_LABEL: Record<BillStatus, string> = { confirmed: "Confirmed", autopay: "Autopay likely", review: "Needs review" };

export type RecurringRow = {
  finding: RecurringFinding;
  name: string;
  entity: Scope;
  accounts: string[];
  cadence: RecurringCadence;
  lastDate: string;
  lastAmount: number;
  nextDate: string | null;
  nextAmount: number;
  confidence: Confidence;
  status: BillStatus;
  seen: number;
  bankSeen: number; // of those, from the bank feed
};

/**
 * Every recurring withdrawal found in your transactions, across all entities.
 * "Autopay likely" needs a steady pattern seen on the bank feed; anything
 * uncertain is "Needs review". Nothing is listed without real transactions behind it.
 */
export function recurringRows(d: MoneyData): RecurringRow[] {
  const acct = new Map(d.accounts.map((a) => [a.id, accountLabel(a)]));
  const assigned = new Set(d.accounts.filter(counts).map((a) => a.id));
  return d.recurring
    .filter((f) => f.direction === "out" && f.status !== "dismissed" && f.occurrences.length > 0 && (!f.accountIds.length || f.accountIds.some((id) => assigned.has(id))))
    .map((f) => {
      const e = effective(f);
      const last = [...f.occurrences].sort((a, b) => b.date.localeCompare(a.date))[0];
      const bankSeen = f.occurrences.filter((o) => o.source === "bank").length;
      const steady = f.max - f.min <= Math.max(1, f.typical * 0.1);
      const status: BillStatus =
        f.status === "confirmed" ? "confirmed" : f.status === "review" || f.confidence === "low" || f.cadence === "irregular" || !bankSeen || !steady ? "review" : "autopay";
      return {
        finding: f,
        name: e.name,
        entity: e.scope,
        accounts: [...new Set(f.accountIds.map((id) => acct.get(id) ?? "Removed account"))],
        cadence: e.cadence,
        lastDate: last.date,
        lastAmount: last.amount,
        nextDate: e.nextDate,
        nextAmount: e.amount,
        confidence: f.status === "confirmed" ? "confirmed" : f.confidence,
        status,
        seen: f.occurrences.length,
        bankSeen,
      };
    });
}

/**
 * Splits a finding seen on several accounts into one per account, for two
 * different bills that were merged because they share a payee name.
 */
export function splitFinding(d: MoneyData, id: string, newId: () => string): MoneyData {
  const f = d.recurring.find((x) => x.id === id);
  if (!f || f.accountIds.length < 2) return d;
  const parts = f.accountIds.map((accountId): RecurringFinding => {
    const occ = f.occurrences.filter((o) => o.accountId === accountId);
    const amounts = occ.map((o) => o.amount).sort((a, b) => a - b);
    const dates = occ.map((o) => o.date).sort();
    return {
      ...f,
      id: newId(),
      key: `${f.key}|${accountId}`,
      occurrences: occ,
      accountIds: [accountId],
      typical: amounts[Math.floor(amounts.length / 2)] ?? f.typical,
      min: amounts[0] ?? f.min,
      max: amounts[amounts.length - 1] ?? f.max,
      firstDate: dates[0] ?? f.firstDate,
      lastDate: dates[dates.length - 1] ?? f.lastDate,
      status: "review",
      billId: undefined,
      reasons: [...f.reasons, "Split by account from a payee seen on several accounts."],
      updatedAt: new Date().toISOString(),
    };
  });
  return { ...d, recurring: [...d.recurring.filter((x) => x.id !== id), ...parts.filter((p) => p.occurrences.length)] };
}

/* ---------------- Transactions ---------------- */

export type TxnRow = { t: Transaction; entity: Scope; account: string; signed: number };

/** Every transaction, newest first, tagged with entity and account; `query` matches description, category or account. */
export function transactionRows(d: MoneyData, query = ""): TxnRow[] {
  const acct = new Map(d.accounts.map((a) => [a.id, a]));
  const q = query.trim().toLowerCase();
  return d.transactions
    .filter((t) => counts(acct.get(t.accountId)))
    .map((t) => {
      const a = acct.get(t.accountId);
      return { t, entity: entityOf(a), account: a ? accountLabel(a) : "Removed account", signed: t.kind === "income" ? t.amount : -t.amount };
    })
    .filter((r) => !q || `${r.t.description} ${r.t.category} ${r.account} ${entityLabel(r.entity)}`.toLowerCase().includes(q))
    .sort((a, b) => b.t.date.localeCompare(a.t.date));
}

/** Balance of an account as the app keeps it, for the Accounts list. */
export const balanceOf = (d: MoneyData, a: Account) => accountBalance(d, a);
