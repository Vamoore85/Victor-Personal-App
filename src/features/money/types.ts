export const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking", liability: false },
  { value: "savings", label: "Savings", liability: false },
  { value: "cash", label: "Cash", liability: false },
  { value: "investment", label: "Investment", liability: false },
  { value: "credit", label: "Credit card", liability: true },
  { value: "loan", label: "Loan", liability: true },
] as const;

// "business" is Maverick LLC (the value predates Gladiator); "gladiator" is Gladiator Solutions Provider LLC.
export type Scope = "personal" | "business" | "gladiator";
export type Company = Exclude<Scope, "personal">;

// How each company files: Maverick is a one-owner LLC on Schedule C; Gladiator is an S-corp (Form 1120-S).
export type TaxForm = "scheduleC" | "1120S";

export const COMPANIES: { value: Company; label: string; legalName: string; taxForm: TaxForm }[] = [
  { value: "business", label: "Maverick", legalName: "Maverick LLC", taxForm: "scheduleC" },
  { value: "gladiator", label: "Gladiator", legalName: "Gladiator Solutions Provider LLC", taxForm: "1120S" },
];

export const taxFormOf = (c: Company): TaxForm => COMPANIES.find((x) => x.value === c)?.taxForm ?? "scheduleC";
export const taxFormLabel = (f: TaxForm) => (f === "1120S" ? "Form 1120-S" : "Schedule C");

export const isCompany = (s: Scope | undefined): s is Company => s === "business" || s === "gladiator";
export const companyLabel = (s: Scope | undefined) => COMPANIES.find((c) => c.value === s)?.label ?? "Personal";

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
  // Set when the account comes from a bank connected through Plaid. Its
  // balance and transactions are then kept up to date by syncing.
  plaid?: { linkId: string; accountId: string };
  // The bank's own balance from the last sync. "available" is what can be
  // spent right now (Plaid leaves it empty for some accounts).
  bankBalance?: { current: number | null; available: number | null; asOf: string };
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
  plaidId?: string; // Plaid's id for transactions that came from a connected bank
  categoryLocked?: boolean; // you picked this category by hand; rules and syncs leave it alone
  docId?: string; // came from an uploaded document (see DocImport)
};

// An uploaded statement or export, and what came of it. The file itself isn't
// kept; only the transactions you chose to import, each pointing back here.
export type DocImport = {
  id: string;
  name: string;
  format: "csv" | "ofx" | "pdf" | "image" | "other";
  size: number;
  addedAt: string;
  status: "imported" | "needs-review" | "unreadable";
  note?: string;
  accountId?: string;
  first?: string; // earliest and latest dates in the file
  last?: string;
  rows: number; // rows read from the file
  imported: number;
  duplicates: number; // already here (bank feed or an earlier import), skipped
  maybe: number; // possible duplicates you chose not to import
  origin?: string; // where it came from, e.g. "Invest: Retirement goal" when added from another part of the app
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
  recurringId?: string; // the RecurringFinding it was confirmed from, when it came from a bank-history scan
  note?: string;
};

/*
 * Bill intelligence: what a scan of recent bank history found repeating.
 * Findings are kept between scans so your decisions (confirm, dismiss, edits)
 * stick; a new scan only refreshes the evidence. A confirmed outgoing finding
 * becomes a Bill, and from then on the Bill is what you edit.
 */
export type RecurringCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular";

export type RecurringOccurrence = {
  txnId: string;
  date: string;
  amount: number;
  accountId: string;
  source: "bank" | "statement"; // bank feed (Plaid) or imported statement / typed in
};

export type RecurringFinding = {
  id: string;
  key: string; // direction | merchant key | owner bucket: matches the same finding across scans
  direction: "out" | "in"; // a bill or money coming in
  merchant: string;
  scope: Scope; // owner of the account it was seen on
  cadence: RecurringCadence;
  typical: number; // median amount
  min: number;
  max: number;
  firstDate: string;
  lastDate: string;
  usualDay: number; // day of the month (monthly, quarterly) or weekday 0-6 (weekly, every 2 weeks)
  nextExpected: string | null;
  confidence: "high" | "medium" | "low";
  reasons: string[]; // the evidence, in plain words
  occurrences: RecurringOccurrence[];
  accountIds: string[];
  category: string;
  status: "detected" | "review" | "confirmed" | "dismissed";
  billId?: string; // the Bill made when an outgoing finding was confirmed
  overrides?: { name?: string; scope?: Scope; cadence?: RecurringCadence; amount?: number; nextDate?: string; category?: string };
  updatedAt: string;
};

export type BillScan = {
  ranAt: string; // ISO time
  windowStart: string; // YYYY-MM-DD, 12 months back (older scans: 120 days)
  windowEnd: string;
  scanned: number; // transactions in the window
  bankFeed: number; // of those, from connected banks
  statement: number; // from imported statements or typed in
  found: number;
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

// A bank connected through Plaid. `link` is the connection key, sealed by the
// server; it can't be used without the site's Plaid secret.
export type BankLink = {
  id: string;
  itemId: string;
  institution: string;
  link: string;
  cursor: string;
  lastSync?: string; // ISO time of the last successful sync
  error?: string; // why the last sync failed, cleared on success
  errorCode?: string; // Plaid's code for that failure, e.g. ITEM_LOGIN_REQUIRED
  // How far Plaid has got loading this bank's history: NOT_READY,
  // INITIAL_UPDATE_COMPLETE (recent days only) or HISTORICAL_UPDATE_COMPLETE.
  historyStatus?: string;
  connectedAt?: string; // ISO time the bank was connected
  scope?: Scope;
};

// "Anything described like this goes in this category", learned when you
// change a transaction's category, and applied to new bank transactions.
export type CategoryRule = {
  id: string;
  match: string; // normalized description (see ruleKey in books.ts)
  category: string;
  scope?: Scope;
};

// A receipt photo or PDF. The file itself is stored on the server under its id.
export type Receipt = {
  id: string;
  date: string; // YYYY-MM-DD, the purchase date
  merchant: string;
  amount: number | null;
  note: string;
  transactionId?: string; // the transaction it backs up
  scope?: Scope;
  contentType: string;
  size: number;
  addedAt: string;
};

export const TAX_DOC_KINDS = [
  "Tax return",
  "W-2",
  "1099",
  "K-1",
  "1098 (mortgage, student loan)",
  "Estimated tax payment",
  "IRS or state letter",
  "Payroll report",
  "Other",
] as const;

// A tax return or form. The file is stored on the server in `parts` pieces.
export type TaxDoc = {
  id: string;
  name: string; // the file's name
  year: number; // the tax year it's for
  kind: string;
  scope?: Scope;
  alsoScopes?: Scope[]; // a combined file, e.g. your 1040 with Maverick's Schedule C, or all three returns in one PDF
  note: string;
  contentType: string;
  size: number;
  parts: number;
  addedAt: string;
};

export type MoneyData = {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  rules: CategoryRule[];
  bills: Bill[];
  institutions: Institution[];
  bankLinks: BankLink[];
  receipts: Receipt[];
  taxDocs: TaxDoc[];
  recurring: RecurringFinding[];
  billScan?: BillScan;
  docImports: DocImport[];
  briefings: BriefingSnapshot[];
};

// A saved copy of the Financial Briefing, made after each bank sync.
export type BriefingSnapshot = {
  id: string;
  at: string; // ISO time it was made
  trigger: "first-sync" | "sync" | "manual";
  freshness: "current" | "partial" | "stale" | "failed" | "no-bank";
  owners: { bucket: "pm" | "gladiator"; available: number | null; ytdSpend: number; billsMonth: number; projected: number | null; flags: number }[];
  text: string;
};

export const EMPTY_DATA: MoneyData = {
  version: 1,
  accounts: [],
  transactions: [],
  budgets: [],
  rules: [],
  bills: [],
  institutions: [],
  bankLinks: [],
  receipts: [],
  taxDocs: [],
  recurring: [],
  docImports: [],
  briefings: [],
};
