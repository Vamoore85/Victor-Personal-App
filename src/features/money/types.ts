export const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking", liability: false },
  { value: "savings", label: "Savings", liability: false },
  { value: "cash", label: "Cash", liability: false },
  { value: "investment", label: "Investment", liability: false },
  { value: "credit", label: "Credit card", liability: true },
  { value: "loan", label: "Loan", liability: true },
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

export const DEFAULT_CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Dining",
  "Transportation",
  "Insurance",
  "Health",
  "Shopping",
  "Entertainment",
  "Subscriptions",
  "Debt payments",
  "Savings",
  "Gifts",
  "Other",
  "Salary",
  "Other income",
];

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  // Starting balance when the account was added. For credit cards and loans,
  // enter what you owe as a positive number; it counts against net worth.
  openingBalance: number;
};

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // always positive
  kind: "income" | "expense";
  category: string;
  accountId: string;
};

export type Budget = {
  id: string;
  category: string;
  monthlyLimit: number;
};

export const BILL_FREQUENCIES = [
  { value: "monthly", label: "Monthly", perMonth: 1 },
  { value: "weekly", label: "Weekly", perMonth: 52 / 12 },
  { value: "biweekly", label: "Every 2 weeks", perMonth: 26 / 12 },
  { value: "quarterly", label: "Every 3 months", perMonth: 1 / 3 },
  { value: "yearly", label: "Yearly", perMonth: 1 / 12 },
  { value: "once", label: "One time", perMonth: 0 },
] as const;

export type BillFrequency = (typeof BILL_FREQUENCIES)[number]["value"];

export type Bill = {
  id: string;
  name: string;
  amount: number;
  category: string;
  frequency: BillFrequency;
  nextDue: string; // YYYY-MM-DD: the next date this bill comes out
  dueDay: number; // day of month it normally comes out, kept so the 31st survives short months
  accountId: string; // "" when not tied to an account
  autopay: boolean;
  url?: string; // where the bill is paid (the biller's website or payment page)
};

export type MoneyData = {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  bills: Bill[];
};

export const EMPTY_DATA: MoneyData = {
  version: 1,
  accounts: [],
  transactions: [],
  budgets: [],
  bills: [],
};
