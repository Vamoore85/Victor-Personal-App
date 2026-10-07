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

export type MoneyData = {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
};

export const EMPTY_DATA: MoneyData = {
  version: 1,
  accounts: [],
  transactions: [],
  budgets: [],
};
