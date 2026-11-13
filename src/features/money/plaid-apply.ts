import { isCompany, type Account, type AccountType, type BankLink, type MoneyData, type Transaction } from "./types";
import { isLiability } from "./calc";
import { autoCategory, ruleCategory } from "./books";
import { historyFolder } from "./accounts-fix";

/*
 * Folding a Plaid sync into the money data. Plain functions with no browser
 * parts, so the same code runs in the browser and in the server's refresh.
 */

export type SyncAccount = { id: string; name: string; mask: string | null; type: string; subtype: string | null; current: number | null; available?: number | null };
export type SyncTxn = { id: string; accountId: string; amount: number; date: string; name: string; pending: boolean; category: string };
export type SyncResult = {
  cursor: string;
  hasMore?: boolean;
  updateStatus?: string;
  institution: string;
  accounts: SyncAccount[];
  added: SyncTxn[];
  modified: SyncTxn[];
  removed: string[];
};

function accountType(a: SyncAccount): AccountType {
  if (a.type === "credit") return "credit";
  if (a.type === "loan") return "loan";
  if (a.type === "investment" || a.type === "brokerage") return "investment";
  if (a.subtype === "savings" || a.subtype === "money market" || a.subtype === "cd") return "savings";
  return "checking";
}

/** A bank's own wording for a move between two of your accounts, e.g. "WEB XFER FROM CHK 0000…". */
export const OWN_ACCOUNT_TRANSFER = /\b(XFER|TRANSFER)\b.*\b(FROM|TO)\b.*\b(CHK|CHECKING|SAV|SAVINGS|SHARE|MMA)\b/i;

/** Maps Plaid's spending categories onto the Financial Center's. */
export function categoryFor(plaidCategory: string, income: boolean, description = "") {
  const [primary, detailed = ""] = plaidCategory.split("|");
  // Money moved between your own accounts is neither income nor spending (it used to land in "Other income" / "Other").
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT" || OWN_ACCOUNT_TRANSFER.test(description)) return "Transfer";
  if (income) return detailed === "INCOME_WAGES" ? "Salary" : "Other income";
  switch (primary) {
    case "FOOD_AND_DRINK":
      return detailed === "FOOD_AND_DRINK_GROCERIES" ? "Groceries" : "Dining";
    case "RENT_AND_UTILITIES":
      return detailed === "RENT_AND_UTILITIES_RENT" ? "Housing" : "Utilities";
    case "HOME_IMPROVEMENT":
      return "Housing";
    case "TRANSPORTATION":
    case "TRAVEL":
      return "Transportation";
    case "MEDICAL":
    case "PERSONAL_CARE":
      return "Health";
    case "GENERAL_MERCHANDISE":
      return "Shopping";
    case "ENTERTAINMENT":
      return "Entertainment";
    case "LOAN_PAYMENTS":
      return "Debt payments";
    case "GENERAL_SERVICES":
      return detailed === "GENERAL_SERVICES_INSURANCE" ? "Insurance" : "Other";
    case "GOVERNMENT_AND_NON_PROFIT":
      return detailed === "GOVERNMENT_AND_NON_PROFIT_DONATIONS" ? "Gifts" : "Other";
    default:
      return "Other";
  }
}

/** The same money movement seen twice, for example on an imported statement and in the bank feed. */
export function sameCharge(t: Transaction, date: string, amount: number, kind: Transaction["kind"]) {
  const days = Math.abs(new Date(t.date).getTime() - new Date(date).getTime()) / 86_400_000;
  return t.kind === kind && Math.abs(t.amount - amount) < 0.005 && days <= 3;
}

const signed = (t: Transaction) => (t.kind === "income" ? t.amount : -t.amount);

/** Folds one sync result into the money data. Pending transactions wait until they post. */
export function applySync(d: MoneyData, link: BankLink, r: SyncResult): MoneyData {
  const accounts = [...d.accounts];
  const idFor = new Map<string, string>(); // Plaid account id -> our account id
  const liveLinks = new Set(d.bankLinks.map((l) => l.id));
  const adopted = new Set<string>(); // our accounts that just took over this bank account
  const viaAlias = new Set<string>(); // Plaid accounts that are a second route to an account we already feed
  for (const pa of r.accounts) {
    let acct = accounts.find((a) => a.plaid?.linkId === link.id && a.plaid.accountId === pa.id);
    if (!acct) {
      // Reached through another connection to the same bank: feed the one record.
      acct = accounts.find((a) => a.plaidAliases?.some((p) => p.linkId === link.id && p.accountId === pa.id));
      if (acct) viaAlias.add(pa.id);
    }
    if (!acct && pa.mask) {
      // The same bank account already here: typed in or filled from statements, or
      // from a bank connection that was removed. The bank feed takes it over so
      // nothing is counted twice; its owner stays as you set it.
      const i = accounts.findIndex(
        (a) => a.last4 === pa.mask && (a.type === "credit") === (accountType(pa) === "credit") && (!a.plaid || !liveLinks.has(a.plaid.linkId) || a.plaid.linkId === link.id),
      );
      if (i >= 0) {
        acct = { ...accounts[i], plaid: { linkId: link.id, accountId: pa.id } };
        accounts[i] = acct;
        adopted.add(acct.id);
      }
    }
    if (!acct) {
      acct = {
        id: crypto.randomUUID(),
        name: pa.name,
        type: accountType(pa),
        openingBalance: 0,
        needsEntity: true, // you say which company it belongs to; the bank doesn't
        last4: pa.mask ?? undefined,
        plaid: { linkId: link.id, accountId: pa.id },
      };
      accounts.push(acct);
    }
    idFor.set(pa.id, acct.id);
  }

  const gone = new Set(r.removed);
  const changed = new Map([...r.added, ...r.modified].map((t) => [t.id, t]));
  const existing = d.transactions.filter((t) => !t.plaidId || (!gone.has(t.plaidId) && !changed.has(t.plaidId)));
  const kept = new Map(d.transactions.filter((t) => t.plaidId && changed.has(t.plaidId)).map((t) => [t.plaidId!, t]));
  const incoming: Transaction[] = [];
  const scope = link.scope ?? "personal";
  const claimed = new Set<string>(); // statement rows (or copies from another connection) that turned out to be this same bank transaction
  const covered = new Set<string>(); // records that already stand for a transaction arriving through a second connection
  // A record delivered through a different connection to the same bank account. Older records don't say which
  // connection brought them; on an account reached through more than one connection they count as possibly another.
  const otherRoute = (t: Transaction) => (t.plaidLink ? t.plaidLink !== link.id : true);
  const multiRoute = new Set(accounts.filter((a) => a.plaidAliases?.length).map((a) => a.id));
  const sameDay = (t: Transaction, accountId: string, pt: SyncTxn, kind: Transaction["kind"]) =>
    t.accountId === accountId && t.date === pt.date && t.kind === kind && Math.abs(t.amount - Math.abs(pt.amount)) < 0.005;
  for (const pt of changed.values()) {
    const accountId = idFor.get(pt.accountId);
    if (!accountId || pt.pending) continue;
    const income = pt.amount < 0; // Plaid: positive is money leaving the account
    const kind: Transaction["kind"] = income ? "income" : "expense";
    if (viaAlias.has(pt.accountId) && !kept.has(pt.id)) {
      // The same transaction already came in through the account's main connection (or a statement): one record, not two.
      // Matched one to one, so several real same-day charges of one amount are each kept once.
      const there = existing.find((t) => !covered.has(t.id) && !claimed.has(t.id) && (!t.plaidId || otherRoute(t)) && sameDay(t, accountId, pt, kind));
      if (there) {
        covered.add(there.id);
        continue;
      }
    }
    const acctScope = accounts.find((a) => a.id === accountId)?.scope ?? scope; // you may have moved the account since connecting
    const prev =
      kept.get(pt.id) ??
      existing.find(
        (t) =>
          (!t.plaidId || adopted.has(t.accountId)) && !claimed.has(t.id) && t.accountId === accountId && t.plaidId !== pt.id && sameCharge(t, pt.date, Math.abs(pt.amount), kind),
      ) ??
      // The main connection's copy of a transaction a second connection delivered first: it takes over that record
      // (its id, category and links stay) instead of adding a second one. This was the 11/10 doubling.
      (!viaAlias.has(pt.accountId) && multiRoute.has(accountId)
        ? existing.find((t) => !!t.plaidId && t.plaidId !== pt.id && !claimed.has(t.id) && !covered.has(t.id) && otherRoute(t) && sameDay(t, accountId, pt, kind))
        : undefined);
    if (prev && prev.plaidId !== pt.id) claimed.add(prev.id);
    incoming.push({
      id: prev?.id ?? crypto.randomUUID(),
      date: pt.date,
      description: pt.name,
      amount: Math.abs(pt.amount),
      kind: income ? "income" : "expense",
      // Keep a category already set; otherwise a learned rule, then Plaid's guess.
      category:
        prev?.category ??
        (isCompany(acctScope)
          ? autoCategory(d.rules, pt.name, acctScope, income, pt.category)
          : (ruleCategory(d.rules, pt.name, acctScope) ?? categoryFor(pt.category, income, pt.name))),
      categoryLocked: prev?.categoryLocked,
      accountId,
      transferId: prev?.transferId,
      plaidId: pt.id,
      plaidLink: link.id,
    });
  }
  let transactions = [...existing.filter((t) => !claimed.has(t.id)), ...incoming];
  let merged: MoneyData = { ...d, accounts, transactions };
  merged = mergeTwins(merged, link);
  transactions = merged.transactions;
  accounts.splice(0, accounts.length, ...merged.accounts);

  // Set each account's starting balance so its balance matches the bank's.
  const balanced = accounts.map((a): Account => {
    const pa = a.plaid?.linkId === link.id ? r.accounts.find((x) => x.id === a.plaid!.accountId) : undefined;
    if (!pa || pa.current === null) return a;
    const net = transactions.filter((t) => t.accountId === a.id).reduce((s, t) => s + signed(t), 0);
    const openingBalance = isLiability(a) ? pa.current + net : pa.current - net;
    const bankBalance = { current: pa.current, available: pa.available ?? null, asOf: new Date().toISOString() };
    return { ...a, openingBalance: Math.round(openingBalance * 100) / 100, bankBalance };
  });

  return {
    ...merged,
    accounts: balanced,
    transactions,
    bankLinks: d.bankLinks.map((l) =>
      l.id === link.id
        ? {
            ...l,
            cursor: r.cursor,
            institution: l.institution || r.institution,
            lastSync: new Date().toISOString(),
            historyStatus: r.updateStatus || l.historyStatus,
            error: undefined,
            errorCode: undefined,
          }
        : l,
    ),
  };
}


/**
 * The same bank account kept twice: once fed by this connection and once left
 * over from an earlier connection or from statements, in the same company. Its
 * history moves onto the connected one (exact repeats dropped), anything that
 * pointed at the leftover now points at the connected one, and the leftover goes.
 */
export function mergeTwins(d: MoneyData, link: BankLink): MoneyData {
  const live = new Set(d.bankLinks.map((l) => l.id));
  const debt = (a: Account) => a.type === "credit" || a.type === "loan";
  const into = new Map<string, string>(); // leftover account id -> connected account id
  for (const y of d.accounts) {
    if (y.plaid?.linkId !== link.id || !y.last4) continue;
    for (const x of d.accounts) {
      if (x.id === y.id || into.has(x.id) || x.last4 !== y.last4 || debt(x) !== debt(y) || (x.scope ?? "personal") !== (y.scope ?? "personal")) continue;
      if (x.plaid && live.has(x.plaid.linkId)) continue; // fed by another live connection
      into.set(x.id, y.id);
    }
  }
  if (!into.size) return d;
  const already = historyFolder(d.transactions.filter((t) => !into.has(t.accountId)));
  const transactions: Transaction[] = [];
  for (const t of d.transactions) {
    const to = into.get(t.accountId);
    if (!to) {
      transactions.push(t);
      continue;
    }
    if (already(t, to)) continue; // already on the connected account
    transactions.push({ ...t, accountId: to });
  }
  const re = (id: string | undefined) => (id && into.get(id)) || id;
  return {
    ...d,
    accounts: d.accounts.filter((a) => !into.has(a.id)),
    transactions,
    bills: d.bills.map((b) => (into.has(b.accountId) ? { ...b, accountId: into.get(b.accountId)! } : b)),
    recurring: d.recurring.map((f) => (f.accountIds.some((id) => into.has(id)) ? { ...f, accountIds: [...new Set(f.accountIds.map((id) => re(id)!))], occurrences: f.occurrences.map((o) => (into.has(o.accountId) ? { ...o, accountId: into.get(o.accountId)! } : o)) } : f)),
  };
}
