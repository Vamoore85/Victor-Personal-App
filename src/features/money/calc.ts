import { ACCOUNT_TYPES, type Account, type MoneyData } from "./types";

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
    if (!t.date.startsWith(month)) continue;
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
