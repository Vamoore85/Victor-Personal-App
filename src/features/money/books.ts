import type { CategoryRule, MoneyData, Scope, Transaction } from "./types";

/*
 * Bookkeeping for Maverick, a one-owner LLC that files on Schedule C.
 * Each business category maps to a Schedule C line; "equity" and "transfer"
 * categories move money without being profit or loss.
 */

export type BookKind = "income" | "cogs" | "expense" | "equity" | "transfer" | "asset";

export type BusinessCategory = {
  name: string;
  kind: BookKind;
  line: string; // Schedule C line, e.g. "8"
  lineLabel: string;
  deductible?: number; // share that's deductible, when not all of it (meals: 0.5)
};

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { name: "Sales & services", kind: "income", line: "1", lineLabel: "Gross receipts or sales" },
  { name: "Refunds given", kind: "income", line: "2", lineLabel: "Returns and allowances" },
  { name: "Other business income", kind: "income", line: "6", lineLabel: "Other income" },
  { name: "Cost of goods & materials", kind: "cogs", line: "4", lineLabel: "Cost of goods sold" },
  { name: "Advertising & marketing", kind: "expense", line: "8", lineLabel: "Advertising" },
  { name: "Vehicle", kind: "expense", line: "9", lineLabel: "Car and truck expenses" },
  { name: "Commissions & fees", kind: "expense", line: "10", lineLabel: "Commissions and fees" },
  { name: "Contractors", kind: "expense", line: "11", lineLabel: "Contract labor" },
  { name: "Business insurance", kind: "expense", line: "15", lineLabel: "Insurance (other than health)" },
  { name: "Business interest", kind: "expense", line: "16b", lineLabel: "Interest (other)" },
  { name: "Legal & professional", kind: "expense", line: "17", lineLabel: "Legal and professional services" },
  { name: "Office expenses", kind: "expense", line: "18", lineLabel: "Office expense" },
  { name: "Equipment rental", kind: "expense", line: "20a", lineLabel: "Rent: vehicles, machinery, equipment" },
  { name: "Rent", kind: "expense", line: "20b", lineLabel: "Rent: other business property" },
  { name: "Repairs & maintenance", kind: "expense", line: "21", lineLabel: "Repairs and maintenance" },
  { name: "Supplies", kind: "expense", line: "22", lineLabel: "Supplies" },
  { name: "Taxes & licenses", kind: "expense", line: "23", lineLabel: "Taxes and licenses" },
  { name: "Travel", kind: "expense", line: "24a", lineLabel: "Travel" },
  { name: "Business meals", kind: "expense", line: "24b", lineLabel: "Deductible meals", deductible: 0.5 },
  { name: "Utilities, phone & internet", kind: "expense", line: "25", lineLabel: "Utilities" },
  { name: "Wages", kind: "expense", line: "26", lineLabel: "Wages" },
  { name: "Software & subscriptions", kind: "expense", line: "27a", lineLabel: "Other expenses" },
  { name: "Bank & payment fees", kind: "expense", line: "27a", lineLabel: "Other expenses" },
  { name: "Education & training", kind: "expense", line: "27a", lineLabel: "Other expenses" },
  { name: "Other business expenses", kind: "expense", line: "27a", lineLabel: "Other expenses" },
  { name: "Home office", kind: "expense", line: "30", lineLabel: "Business use of home" },
  { name: "Equipment purchase", kind: "asset", line: "—", lineLabel: "Depreciation: ask your CPA (Form 4562)" },
  { name: "Owner contribution", kind: "equity", line: "—", lineLabel: "Not on Schedule C" },
  { name: "Owner draw", kind: "equity", line: "—", lineLabel: "Not on Schedule C" },
  { name: "Loan principal", kind: "transfer", line: "—", lineLabel: "Not on Schedule C" },
  { name: "Sales tax collected", kind: "transfer", line: "—", lineLabel: "Not on Schedule C" },
  { name: "Transfer", kind: "transfer", line: "—", lineLabel: "Not on Schedule C" },
];

export const BUSINESS_CATEGORY_NAMES = BUSINESS_CATEGORIES.map((c) => c.name);
const byName = new Map(BUSINESS_CATEGORIES.map((c) => [c.name, c]));

export const businessCategory = (name: string) => byName.get(name);

/** Maps Plaid's categories onto the business ones. */
export function businessCategoryFor(plaidCategory: string, income: boolean) {
  const [primary, detailed = ""] = plaidCategory.split("|");
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return "Transfer";
  if (income) return detailed.includes("REFUND") ? "Refunds given" : "Sales & services";
  if (primary === "LOAN_PAYMENTS") return detailed.includes("CREDIT_CARD") ? "Transfer" : "Loan principal";
  if (primary === "BANK_FEES") return "Bank & payment fees";
  if (primary === "FOOD_AND_DRINK") return "Business meals";
  if (primary === "TRAVEL") return "Travel";
  if (primary === "TRANSPORTATION") return "Vehicle";
  if (primary === "RENT_AND_UTILITIES") return detailed.endsWith("_RENT") ? "Rent" : "Utilities, phone & internet";
  if (primary === "HOME_IMPROVEMENT") return "Repairs & maintenance";
  if (primary === "GENERAL_MERCHANDISE") return detailed.includes("OFFICE") ? "Office expenses" : "Supplies";
  if (primary === "GOVERNMENT_AND_NON_PROFIT") return detailed.includes("TAX") ? "Taxes & licenses" : "Other business expenses";
  if (primary === "GENERAL_SERVICES") {
    if (detailed.includes("INSURANCE")) return "Business insurance";
    if (detailed.includes("ACCOUNTING") || detailed.includes("CONSULTING") || detailed.includes("LEGAL")) return "Legal & professional";
    if (detailed.includes("EDUCATION")) return "Education & training";
    if (detailed.includes("ADVERTISING") || detailed.includes("MARKETING")) return "Advertising & marketing";
    return "Other business expenses";
  }
  if (primary === "ENTERTAINMENT" && detailed.includes("TV_AND_MOVIES")) return "Software & subscriptions";
  return "Other business expenses";
}

/** Best guess from a statement description, for imports that carry no category. */
const BUSINESS_RULES: [RegExp, string][] = [
  [/google\s*\*?\s*ads|googleads|facebk|facebook|meta ads|instagram|linkedin ads|tiktok ads|yelp|mailchimp|canva/i, "Advertising & marketing"],
  [/upwork|fiverr|contractor|freelance/i, "Contractors"],
  [/adobe|microsoft|msft|google \*?workspace|gsuite|notion|slack|zoom|dropbox|github|openai|anthropic|claude|chatgpt|vercel|supabase|godaddy|squarespace|wix|quickbooks|intuit|docusign|calendly|apple\.com/i, "Software & subscriptions"],
  [/\bfees?\b|service charge|overdraft|\bwire\b/i, "Bank & payment fees"],
  [/attorney|law office|legal|cpa|accounting|bookkeep|tax prep|legalzoom/i, "Legal & professional"],
  [/irs|comptroller|dept of revenue|department of revenue|secretary of state|license|permit/i, "Taxes & licenses"],
  [/insurance|geico|state farm|progressive|allstate|hiscox|next insurance/i, "Business insurance"],
  [/staples|office depot|officemax|fedex office|ups store|usps|postage/i, "Office expenses"],
  [/airline|delta|united|american air|southwest|jetblue|hotel|marriott|hilton|hyatt|airbnb|expedia|amtrak/i, "Travel"],
  [/shell|exxon|bp |sunoco|chevron|wawa|sheetz|parking|toll|ezpass|e-zpass|jiffy|auto/i, "Vehicle"],
  [/uber|lyft/i, "Travel"],
  [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|doordash|uber eats|grubhub|pizza|dunkin|grill|bar /i, "Business meals"],
  [/verizon|at&t|t-mobile|comcast|xfinity|spectrum|cox|electric|energy|water|bge|pepco/i, "Utilities, phone & internet"],
  [/home depot|lowe|repair|maintenance/i, "Repairs & maintenance"],
  [/amazon|amzn|walmart|target|costco|best buy/i, "Supplies"],
  [/\brent\b|\blease\b|wework|regus/i, "Rent"],
];

export function businessGuess(description: string, income: boolean) {
  if (income) return /refund|return/i.test(description) ? "Other business income" : "Sales & services";
  return BUSINESS_RULES.find(([re]) => re.test(description))?.[1] ?? "Other business expenses";
}

/* ---------------- Learned rules ---------------- */

/** Description reduced to its stable part: "SQ *BLUE BOTTLE 1234 SF" -> "sq blue bottle sf". */
export function ruleKey(description: string) {
  return description
    .toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ruleCategory(rules: CategoryRule[], description: string, scope: Scope) {
  const key = ruleKey(description);
  if (!key) return undefined;
  return rules.find((r) => (r.scope ?? "personal") === scope && r.match === key)?.category;
}

/** Remembers a category you picked, and applies it to the other transactions described the same way. */
export function learnCategory(d: MoneyData, t: Transaction, category: string, scope: Scope, newId: () => string): MoneyData {
  const key = ruleKey(t.description);
  const rules = key
    ? [...d.rules.filter((r) => !((r.scope ?? "personal") === scope && r.match === key)), { id: newId(), match: key, category, scope }]
    : d.rules;
  const sameScope = new Set(d.accounts.filter((a) => (a.scope ?? "personal") === scope).map((a) => a.id));
  return {
    ...d,
    rules,
    transactions: d.transactions.map((x) =>
      x.id === t.id || (key && !x.transferId && sameScope.has(x.accountId) && x.kind === t.kind && ruleKey(x.description) === key && !x.categoryLocked)
        ? { ...x, category, categoryLocked: x.id === t.id ? true : x.categoryLocked }
        : x,
    ),
  };
}

/* ---------------- Reports ---------------- */

export type Period = { start: string; end: string; label: string }; // inclusive YYYY-MM-DD

export function periodsFor(year: number): Period[] {
  const q = (n: number, sm: string, em: string, ed: string) => ({ start: `${year}-${sm}-01`, end: `${year}-${em}-${ed}`, label: `Q${n} ${year}` });
  return [
    { start: `${year}-01-01`, end: `${year}-12-31`, label: `${year}` },
    q(1, "01", "03", "31"),
    q(2, "04", "06", "30"),
    q(3, "07", "09", "30"),
    q(4, "10", "12", "31"),
  ];
}

export type LineTotal = { line: string; lineLabel: string; amount: number; categories: Map<string, number> };

/** Profit and loss for the business transactions in the period. */
export function profitAndLoss(data: MoneyData, period: Period) {
  const businessAccounts = new Set(data.accounts.filter((a) => a.scope === "business").map((a) => a.id));
  let income = 0;
  let cogs = 0;
  let expenses = 0;
  let deductible = 0;
  let draws = 0;
  let contributions = 0;
  let assets = 0;
  const uncategorized: Transaction[] = [];
  const incomeLines = new Map<string, LineTotal>();
  const expenseLines = new Map<string, LineTotal>();
  const add = (map: Map<string, LineTotal>, c: BusinessCategory, amount: number) => {
    const key = `${c.line} ${c.lineLabel}`;
    const row = map.get(key) ?? { line: c.line, lineLabel: c.lineLabel, amount: 0, categories: new Map() };
    row.amount += amount;
    row.categories.set(c.name, (row.categories.get(c.name) ?? 0) + amount);
    map.set(key, row);
  };

  for (const t of data.transactions) {
    if (!businessAccounts.has(t.accountId) || t.date < period.start || t.date > period.end || t.transferId) continue;
    const c = byName.get(t.category);
    // Money in is positive; a refund on an expense category reduces that expense.
    const signed = t.kind === "income" ? t.amount : -t.amount;
    if (!c) {
      uncategorized.push(t);
      continue;
    }
    switch (c.kind) {
      case "income": {
        income += signed;
        add(incomeLines, c, signed);
        break;
      }
      case "cogs":
      case "expense": {
        const cost = -signed;
        if (c.kind === "cogs") cogs += cost;
        else expenses += cost;
        deductible += cost * (c.deductible ?? 1);
        add(expenseLines, c, cost);
        break;
      }
      case "equity":
        if (c.name === "Owner draw") draws += -signed;
        else contributions += signed;
        break;
      case "asset":
        assets += -signed;
        break;
      default:
        break;
    }
  }
  const sortLines = (m: Map<string, LineTotal>) =>
    [...m.values()].sort((a, b) => parseFloat(a.line) - parseFloat(b.line) || a.line.localeCompare(b.line));
  const grossProfit = income - cogs;
  const netProfit = grossProfit - expenses;
  const taxableProfit = income - cogs - deductible;
  return {
    income,
    cogs,
    grossProfit,
    expenses,
    netProfit,
    taxableProfit,
    draws,
    contributions,
    assets,
    uncategorized,
    incomeLines: sortLines(incomeLines),
    expenseLines: sortLines(expenseLines),
  };
}

/**
 * A rough amount to set aside for taxes on business profit: self-employment
 * tax (15.3% on 92.35% of profit, Social Security part capped) plus income tax
 * at the rate you choose. An estimate only, not tax advice.
 */
export function taxSetAside(profit: number, incomeTaxRate: number) {
  if (profit <= 0) return { seTax: 0, incomeTax: 0, total: 0 };
  const seBase = profit * 0.9235;
  const SS_WAGE_BASE = 176_100; // 2025 Social Security wage base
  const seTax = Math.min(seBase, SS_WAGE_BASE) * 0.124 + seBase * 0.029;
  // Half of SE tax is deductible from income.
  const incomeTax = Math.max(0, profit - seTax / 2) * (incomeTaxRate / 100);
  return { seTax, incomeTax, total: seTax + incomeTax };
}

export function estimatedTaxDueDates(year: number) {
  return [
    { label: "Q1", due: `${year}-04-15` },
    { label: "Q2", due: `${year}-06-15` },
    { label: "Q3", due: `${year}-09-15` },
    { label: "Q4", due: `${year + 1}-01-15` },
  ];
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every business transaction in the period with its Schedule C line, for your CPA. */
export function booksCsv(data: MoneyData, period: Period) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const rows = data.transactions
    .filter((t) => accounts.get(t.accountId)?.scope === "business" && t.date >= period.start && t.date <= period.end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const header = ["Date", "Description", "Amount", "Category", "Schedule C line", "Line description", "Account"];
  const lines = rows.map((t) => {
    const c = byName.get(t.category);
    const amount = (t.kind === "income" ? t.amount : -t.amount).toFixed(2);
    return [
      t.date,
      t.description,
      amount,
      t.transferId ? "Transfer" : t.category,
      t.transferId ? "—" : (c?.line ?? "Needs category"),
      t.transferId ? "Not on Schedule C" : (c?.lineLabel ?? ""),
      accounts.get(t.accountId)?.name ?? "",
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
