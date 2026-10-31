import { accountBalance, isLiability } from "@/features/money/calc";
import type { Account, MoneyData, Scope } from "@/features/money/types";

/*
 * The one read-only view Wade gets of the Financial Center. It leaves out
 * everything that isn't money facts: logins and the vault, institution notes,
 * receipts and tax files, email evidence, bank connection ids and payment links.
 */

export const TXN_DAYS = 120;
export const MAX_TXNS = 3000;

const ENTITY: Record<Scope, string> = { personal: "Personal", business: "Maverick", gladiator: "Gladiator" };

function entity(scope: Scope | undefined, needsEntity?: boolean) {
  return needsEntity ? "Unassigned" : ENTITY[scope ?? "personal"] ?? "Personal";
}

const round = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

function accountName(a: Account) {
  return (a.nickname || a.name || "Account").slice(0, 120);
}

export function wadeMoneySummary(data: MoneyData, now: Date) {
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const since = new Date(now.getTime() - TXN_DAYS * 864e5).toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);

  const accounts = data.accounts.map((a) => ({
    name: accountName(a),
    entity: entity(a.scope, a.needsEntity),
    type: a.type,
    last4: typeof a.last4 === "string" ? a.last4.slice(-4) : null,
    liability: isLiability(a),
    bank_current: round(a.bankBalance?.current),
    bank_available: round(a.bankBalance?.available),
    bank_as_of: a.bankBalance?.asOf ?? null,
    ledger_balance: round(accountBalance(data, a)),
    credit_limit: round(a.creditLimit),
  }));

  const transactions = data.transactions
    .filter((t) => typeof t.date === "string" && t.date >= since)
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    .slice(0, MAX_TXNS)
    .map((t) => {
      const a = byId.get(t.accountId);
      return {
        date: t.date,
        description: String(t.description ?? "").slice(0, 200),
        amount: round(t.kind === "income" ? t.amount : -t.amount),
        category: String(t.category ?? "").slice(0, 80),
        account: a ? accountName(a) : null,
        entity: a ? entity(a.scope, a.needsEntity) : "Unassigned",
        transfer: Boolean(t.transferId),
      };
    });

  const bills = data.bills.map((b) => {
    const a = b.accountId ? byId.get(b.accountId) : undefined;
    return {
      name: String(b.name ?? "").slice(0, 120),
      amount: round(b.amount),
      frequency: b.frequency,
      next_due: b.nextDue,
      autopay: Boolean(b.autopay),
      category: String(b.category ?? "").slice(0, 80),
      pays_from: a ? accountName(a) : null,
      entity: entity(b.scope),
    };
  });

  const budgets = data.budgets.map((g) => {
    const spent = data.transactions
      .filter((t) => t.kind === "expense" && !t.transferId && t.category === g.category && t.date?.startsWith(month)
        && entity(byId.get(t.accountId)?.scope) === entity(g.scope))
      .reduce((s, t) => s + t.amount, 0);
    return { category: g.category, entity: entity(g.scope), monthly_limit: round(g.monthlyLimit), spent_this_month: round(spent) };
  });

  return {
    source: "Maverick Financial Center (read only)",
    checked_at: now.toISOString(),
    entities: ["Personal", "Maverick", "Gladiator"],
    transactions_window_days: TXN_DAYS,
    transactions_truncated: transactions.length >= MAX_TXNS,
    accounts,
    bills,
    budgets,
    transactions,
  };
}
