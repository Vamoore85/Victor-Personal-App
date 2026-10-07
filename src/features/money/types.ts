export const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking", liability: false },
  { value: "savings", label: "Savings", liability: false },
  { value: "cash", label: "Cash", liability: false },
  { value: "investment", label: "Investment", liability: false },
  { value: "credit", label: "Credit card", liability: true },
  { value: "loan", label: "Loan", liability: true },
] as const;

export type Scope = "personal" | "business";

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
  institutionId?: string;
  scope?: Scope; // missing means personal
  last4?: string; // last 4 digits of the card or account number
  // Credit card details (optional)
  creditLimit?: number;
  apr?: number; // percent, e.g. 24.99
  dueDay?: number; // day of month the payment is due
  minPayment?: number;
};

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // always positive
  kind: "income" | "expense";
  category: string;
  accountId: string;
  // Set on both halves of a card payment or transfer between your own
  // accounts, so they don't count as income or spending.
  transferId?: string;
};

export type Budget = {
  id: string;
  category: string;
  monthlyLimit: number;
  scope?: Scope;
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
  institutionId?: string; // the company that sends the bill
  scope?: Scope;
};

export const INSTITUTION_TYPES = [
  "Bank",
  "Credit union",
  "Credit card",
  "Lender",
  "Investment",
  "Insurance",
  "Utility",
  "Phone & internet",
  "Housing",
  "Health care",
  "Pharmacy",
  "Government",
  "Subscription",
  "Other",
];

// A company or organization you have a relationship with. These fields are
// stored unencrypted; logins and passwords live in the encrypted vault (vault.ts).
export type Institution = {
  id: string;
  name: string;
  type: string;
  website: string;
  loginUrl: string;
  phone: string;
  memberNumber: string; // last 4 of the account/member/policy number, for reference only
  notes: string;
  scope?: Scope;
};

export type MoneyData = {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  bills: Bill[];
  institutions: Institution[];
};

export const EMPTY_DATA: MoneyData = {
  version: 1,
  accounts: [],
  transactions: [],
  budgets: [],
  bills: [],
  institutions: [],
};
