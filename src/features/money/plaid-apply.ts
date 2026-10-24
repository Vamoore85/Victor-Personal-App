import { isCompany, type Account, type AccountType, type BankLink, type MoneyData, type Transaction } from "./types";
import { isLiability } from "./calc";
import { autoCategory, ruleCategory } from "./books";

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

/** Maps Plaid's spending categories onto the Financial Center's. */
export function categoryFor(plaidCategory: string, income: boolean) {
  const [primary, detailed = ""] = plaidCategory.split("|");
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
  for (const pa of r.accounts) {
    let acct = accounts.find((a) => a.plaid?.linkId === link.id && a.plaid.accountId === pa.id);
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
        scope: link.scope,
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
  const claimed = new Set<string>(); // statement rows that turned out to be this same bank transaction
  for (const pt of changed.values()) {
    const accountId = idFor.get(pt.accountId);
    if (!accountId || pt.pending) continue;
    const acctScope = accounts.find((a) => a.id === accountId)?.scope ?? scope; // you may have moved the account since connecting
    const income = pt.amount < 0; // Plaid: positive is money leaving the account
    const prev =
      kept.get(pt.id) ??
      existing.find(
        (t) =>
          (!t.plaidId || adopted.has(t.accountId)) && !claimed.has(t.id) && t.accountId === accountId && t.plaidId !== pt.id && sameCharge(t, pt.date, Math.abs(pt.amount), income ? "income" : "expense"),
      );
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
          : (ruleCategory(d.rules, pt.name, acctScope) ?? categoryFor(pt.category, income))),
      categoryLocked: prev?.categoryLocked,
      accountId,
      transferId: prev?.transferId,
      plaidId: pt.id,
    });
  }
  const transactions = [...existing.filter((t) => !claimed.has(t.id)), ...incoming];

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
    ...d,
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

