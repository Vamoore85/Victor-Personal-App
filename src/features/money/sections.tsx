"use client";

import { useState, type FormEvent } from "react";
import { newId, setMoneyData } from "./store";
import { ACCOUNT_TYPES, DEFAULT_CATEGORIES, type Account, type AccountType, type MoneyData, type Transaction } from "./types";
import { BUSINESS_CATEGORY_NAMES, learnCategory } from "./books";
import { accountBalance, accountTypeLabel, categoriesInUse, currentMonth, daysUntil, dueLabel, isLiability, money, monthLabel, monthTotals, shortDate, today } from "./calc";
import { UpcomingBills } from "./bills";
import { StatementImport } from "./import";
import { ScopeBadge, ScopeField, filterByScope, scopeOf, useDefaultScope } from "./scope";
import type { Budget } from "./types";
import { isCompany, type Scope } from "./types";
import { Bar, Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "./ui";
import { AttachReceipt, receiptFor } from "./receipts";

/** Spending against a budget counts only transactions in the budget's own book. */
function budgetSpent(data: MoneyData, b: Budget, month: string) {
  return monthTotals(filterByScope(data, scopeOf(b)), month).byCategory.get(b.category) ?? 0;
}

function parseAmount(s: string) {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/* ---------------- Overview ---------------- */

export function Overview({ data, goTo }: { data: MoneyData; goTo: (tab: string) => void }) {
  const month = currentMonth();
  const totals = monthTotals(data, month);
  let assets = 0;
  let debts = 0;
  for (const a of data.accounts) {
    const b = accountBalance(data, a);
    if (b >= 0) assets += b;
    else debts += -b;
  }
  const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const spending = [...totals.byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const topSpend = spending[0]?.[1] ?? 0;

  if (data.accounts.length === 0 && data.bills.length === 0) {
    return (
      <Card title="Welcome to your Financial Center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Start by adding your accounts (checking, savings, credit cards, loans) with their current balances. Then log
          transactions and set monthly budgets. Everything stays in this browser.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => goTo("accounts")}>
            Add your first account
          </button>
          <button className={ghostButtonClass} onClick={() => goTo("bills")}>
            Start with your bills
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Net worth" value={money(assets - debts)} tone={assets - debts >= 0 ? "good" : "bad"} />
        <Stat label="Assets" value={money(assets)} />
        <Stat label="Debts" value={money(debts)} tone={debts > 0 ? "bad" : undefined} />
      </div>

      <Card title={monthLabel(month)}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-500">Money in</p>
            <p className="text-lg font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{money(totals.income)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Money out</p>
            <p className="text-lg font-medium tabular-nums text-rose-600 dark:text-rose-400">{money(totals.expenses)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Left over</p>
            <p className="text-lg font-medium tabular-nums">{money(totals.net)}</p>
          </div>
        </div>
      </Card>

      <Card
        title="Bills due in the next 2 weeks"
        action={<button className={ghostButtonClass} onClick={() => goTo("bills")}>All bills</button>}
      >
        <UpcomingBills data={data} days={14} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Budgets this month"
          action={<button className={ghostButtonClass} onClick={() => goTo("budgets")}>Manage</button>}
        >
          {data.budgets.length === 0 ? (
            <Empty>No budgets yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.budgets.map((b) => {
                const spent = budgetSpent(data, b, month);
                return (
                  <li key={b.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{b.category}<ScopeBadge item={b} /></span>
                      <span className="tabular-nums text-zinc-500">
                        {money(spent)} / {money(b.monthlyLimit)}
                      </span>
                    </div>
                    <Bar value={spent} max={b.monthlyLimit} over={spent > b.monthlyLimit} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Spending by category">
          {spending.length === 0 ? (
            <Empty>No spending logged this month.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {spending.map(([cat, amt]) => (
                <li key={cat}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{cat}</span>
                    <span className="tabular-nums text-zinc-500">{money(amt)}</span>
                  </div>
                  <Bar value={amt} max={topSpend} neutral />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Recent transactions"
        action={<button className={ghostButtonClass} onClick={() => goTo("transactions")}>See all</button>}
      >
        {recent.length === 0 ? <Empty>No transactions yet.</Empty> : <TransactionList data={data} items={recent} />}
      </Card>
    </div>
  );
}

/* ---------------- Accounts ---------------- */

type AccountDraft = {
  name: string;
  type: AccountType;
  balance: string;
  institutionId: string;
  scope: Scope;
  last4: string;
  creditLimit: string;
  apr: string;
  dueDay: string;
  minPayment: string;
};

const blankAccount = (scope: Scope): AccountDraft => ({
  name: "",
  type: "checking",
  balance: "",
  institutionId: "",
  scope,
  last4: "",
  creditLimit: "",
  apr: "",
  dueDay: "",
  minPayment: "",
});

const optionalNumber = (s: string) => {
  if (!s.trim()) return undefined;
  const n = parseAmount(s.replace("%", ""));
  return Number.isNaN(n) ? undefined : n;
};

/** Next date a card payment is due, given its day of month. */
function nextDueFromDay(day: number) {
  const now = new Date(today() + "T00:00:00");
  const make = (y: number, m: number) => {
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last));
  };
  let d = make(now.getFullYear(), now.getMonth());
  if (d < now) d = make(now.getFullYear(), now.getMonth() + 1);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return ymd;
}

export function Accounts({ data }: { data: MoneyData }) {
  const defaultScope = useDefaultScope();
  const [draft, setDraft] = useState<AccountDraft>(() => blankAccount(defaultScope));
  const [editingId, setEditingId] = useState<string | null>(null);
  const set = <K extends keyof AccountDraft>(k: K, v: AccountDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const isCard = draft.type === "credit";

  function save(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(draft.balance || "0");
    if (!draft.name.trim() || Number.isNaN(amount)) return;
    const dueDay = optionalNumber(draft.dueDay);
    const fields = {
      name: draft.name.trim(),
      type: draft.type,
      openingBalance: amount,
      institutionId: draft.institutionId,
      scope: draft.scope,
      last4: draft.last4.replace(/\D/g, "").slice(-4) || undefined,
      creditLimit: isCard ? optionalNumber(draft.creditLimit) : undefined,
      apr: isCard || draft.type === "loan" ? optionalNumber(draft.apr) : undefined,
      dueDay: (isCard || draft.type === "loan") && dueDay ? Math.min(31, Math.max(1, Math.round(dueDay))) : undefined,
      minPayment: isCard || draft.type === "loan" ? optionalNumber(draft.minPayment) : undefined,
    };
    setMoneyData((d) => ({
      ...d,
      accounts: editingId
        ? d.accounts.map((a) => (a.id === editingId ? { ...a, ...fields } : a))
        : [...d.accounts, { id: newId(), ...fields }],
    }));
    setDraft(blankAccount(defaultScope));
    setEditingId(null);
  }

  function edit(a: Account) {
    setEditingId(a.id);
    const str = (n?: number) => (n === undefined ? "" : String(n));
    setDraft({
      name: a.name,
      type: a.type,
      balance: String(a.openingBalance),
      institutionId: a.institutionId ?? "",
      scope: a.scope ?? "personal",
      last4: a.last4 ?? "",
      creditLimit: str(a.creditLimit),
      apr: str(a.apr),
      dueDay: str(a.dueDay),
      minPayment: str(a.minPayment),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove() {
    if (!editingId) return;
    const used = data.transactions.some((t) => t.accountId === editingId);
    if (!confirm(used ? "Delete this account and all of its transactions?" : "Delete this account?")) return;
    setMoneyData((d) => ({
      ...d,
      accounts: d.accounts.filter((a) => a.id !== editingId),
      transactions: d.transactions.filter((t) => t.accountId !== editingId),
    }));
    setDraft(blankAccount(defaultScope));
    setEditingId(null);
  }

  const owed = ACCOUNT_TYPES.find((t) => t.value === draft.type)?.liability;
  const institutionNames = new Map(data.institutions.map((i) => [i.id, i.name]));
  const banks = data.accounts.filter((a) => !isLiability(a));
  const cards = data.accounts.filter((a) => a.type === "credit");
  const loans = data.accounts.filter((a) => a.type === "loan");

  const cardOwed = cards.reduce((s, a) => s + Math.max(0, -accountBalance(data, a)), 0);
  const cardLimit = cards.reduce((s, a) => s + (a.creditLimit ?? 0), 0);
  const cardsWithLimit = cards.filter((a) => a.creditLimit);
  const owedOnLimited = cardsWithLimit.reduce((s, a) => s + Math.max(0, -accountBalance(data, a)), 0);
  const utilization = cardLimit > 0 ? (owedOnLimited / cardLimit) * 100 : null;

  const accountRow = (a: Account) => {
    const b = accountBalance(data, a);
    const debt = isLiability(a);
    const owedNow = Math.max(0, -b);
    const used = a.creditLimit ? (owedNow / a.creditLimit) * 100 : null;
    const due = a.dueDay ? nextDueFromDay(a.dueDay) : null;
    return (
      <li key={a.id} className="flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">
              {a.name}
              {a.last4 && <span className="ml-1 text-sm font-normal text-zinc-500">•••• {a.last4}</span>}
              <ScopeBadge item={a} />
            </p>
            <p className="text-xs text-zinc-500">
              {accountTypeLabel(a)}
              {a.institutionId && institutionNames.get(a.institutionId) && ` · ${institutionNames.get(a.institutionId)}`}
              {a.apr !== undefined && ` · ${a.apr}% APR`}
              {due && (
                <>
                  {" · "}
                  <span className={dueClass(due)}>
                    Payment {dueLabel(due).toLowerCase()} ({shortDate(due)})
                  </span>
                </>
              )}
              {a.minPayment !== undefined && ` · min ${money(a.minPayment)}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`tabular-nums ${b < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
              {debt && b <= 0 ? `${money(owedNow)} owed` : money(b)}
            </span>
            <button className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => edit(a)}>
              Edit
            </button>
          </div>
        </div>
        {used !== null && a.creditLimit && (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Bar value={owedNow} max={a.creditLimit} over={used > 30} />
            </div>
            <span className="w-44 shrink-0 text-right text-xs tabular-nums text-zinc-500">
              {Math.round(used)}% of {money(a.creditLimit)} · {money(Math.max(0, a.creditLimit - owedNow))} free
            </span>
          </div>
        )}
      </li>
    );
  }

  const group = (title: string, items: Account[]) =>
    items.length > 0 && (
      <Card title={title}>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {items.map(accountRow)}
        </ul>
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      {cards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Owed on cards" value={money(cardOwed)} tone={cardOwed > 0 ? "bad" : undefined} />
          <Stat label="Total credit limit" value={cardLimit ? money(cardLimit) : "Not set"} />
          <Stat
            label="Credit used"
            value={utilization === null ? "Add limits" : `${Math.round(utilization)}%`}
            tone={utilization === null ? undefined : utilization > 30 ? "bad" : "good"}
          />
        </div>
      )}

      <Card title={editingId ? "Edit account" : "Add a bank account, card or loan"}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-3">
          <Field label="Name">
            <input className={inputClass} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Chase checking" />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={draft.type} onChange={(e) => set("type", e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label={editingId ? (owed ? "Amount owed when added" : "Balance when added") : owed ? "Amount owed now" : "Balance now"}>
            <input className={inputClass} inputMode="decimal" value={draft.balance} onChange={(e) => set("balance", e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Last 4 digits">
            <input className={inputClass} inputMode="numeric" maxLength={4} value={draft.last4} onChange={(e) => set("last4", e.target.value)} placeholder="1234" />
          </Field>
          <Field label="Institution">
            <select className={inputClass} value={draft.institutionId} onChange={(e) => set("institutionId", e.target.value)}>
              <option value="">None</option>
              {data.institutions.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </Field>
          <ScopeField value={draft.scope} onChange={(v) => set("scope", v)} />
          {(isCard || draft.type === "loan") && (
            <>
              {isCard && (
                <Field label="Credit limit">
                  <input className={inputClass} inputMode="decimal" value={draft.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} placeholder="5000" />
                </Field>
              )}
              <Field label="APR (%)">
                <input className={inputClass} inputMode="decimal" value={draft.apr} onChange={(e) => set("apr", e.target.value)} placeholder="24.99" />
              </Field>
              <Field label="Payment due day of month">
                <input className={inputClass} inputMode="numeric" value={draft.dueDay} onChange={(e) => set("dueDay", e.target.value)} placeholder="15" />
              </Field>
              <Field label="Minimum payment">
                <input className={inputClass} inputMode="decimal" value={draft.minPayment} onChange={(e) => set("minPayment", e.target.value)} placeholder="35" />
              </Field>
            </>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
            <button className={buttonClass} disabled={!draft.name.trim()}>
              {editingId ? "Save changes" : "Add account"}
            </button>
            {editingId && (
              <>
                <button type="button" className={ghostButtonClass} onClick={() => { setEditingId(null); setDraft(blankAccount(defaultScope)); }}>
                  Cancel
                </button>
                <button type="button" className="px-2 text-sm text-rose-600" onClick={remove}>
                  Delete account
                </button>
              </>
            )}
          </div>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          To record a card payment, use Transactions: pick &quot;Pay a card or move money&quot;.
        </p>
      </Card>

      {data.accounts.length === 0 ? (
        <Card>
          <Empty>No accounts yet. Add your bank accounts and credit cards with today&apos;s balances.</Empty>
        </Card>
      ) : (
        <>
          {group("Bank accounts", banks)}
          {group("Credit cards", cards)}
          {group("Loans", loans)}
        </>
      )}
    </div>
  );
}

function dueClass(ymd: string) {
  const days = daysUntil(ymd);
  if (days <= 3) return "text-amber-600 dark:text-amber-400";
  return "";
}

/* ---------------- Transactions ---------------- */

export function Transactions({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<Transaction["kind"] | "transfer">("expense");
  const [toAccountId, setToAccountId] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [accountId, setAccountId] = useState("");
  const [filterMonth, setFilterMonth] = useState(currentMonth());

  const account = accountId || data.accounts[0]?.id || "";
  const toAccount = toAccountId || data.accounts.find((a) => a.type === "credit" && a.id !== account)?.id || data.accounts.find((a) => a.id !== account)?.id || "";
  const isTransfer = kind === "transfer";

  function add(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(amount);
    if (isTransfer) {
      if (!account || !toAccount || account === toAccount || Number.isNaN(n) || n <= 0) return;
      const transferId = newId();
      const to = data.accounts.find((a) => a.id === toAccount);
      const label = description.trim() || (to?.type === "credit" ? `Payment to ${to.name}` : `Transfer to ${to?.name ?? "account"}`);
      setMoneyData((d) => ({
        ...d,
        transactions: [
          ...d.transactions,
          { id: newId(), date, description: label, amount: n, kind: "expense", category: "Transfer", accountId: account, transferId },
          { id: newId(), date, description: label, amount: n, kind: "income", category: "Transfer", accountId: toAccount, transferId },
        ],
      }));
      setDescription("");
      setAmount("");
      return;
    }
    if (!account || !description.trim() || Number.isNaN(n) || n <= 0) return;
    const k = kind as Transaction["kind"];
    setMoneyData((d) => ({
      ...d,
      transactions: [
        ...d.transactions,
        { id: newId(), date, description: description.trim(), amount: n, kind: k, category: category.trim() || "Other", accountId: account },
      ],
    }));
    setDescription("");
    setAmount("");
  }

  if (data.accounts.length === 0) {
    return (
      <Card>
        <Empty>Add an account first, then you can log transactions against it.</Empty>
      </Card>
    );
  }

  const items = data.transactions
    .filter((t) => !filterMonth || t.date.startsWith(filterMonth))
    .sort((a, b) => b.date.localeCompare(a.date));
  const totals = monthTotals(data, filterMonth);

  return (
    <div className="flex flex-col gap-6">
      <StatementImport data={data} />

      <Card title="Log a transaction">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="Type">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Transaction["kind"] | "transfer")}>
              <option value="expense">Money out</option>
              <option value="income">Money in</option>
              <option value="transfer">Pay a card or move money</option>
            </select>
          </Field>
          <Field label="Amount">
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Description">
            <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isTransfer ? "Optional" : "Trader Joe's"} />
          </Field>
          {!isTransfer && (
            <Field label="Category">
              <input className={inputClass} list="money-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            </Field>
          )}
          <Field label={isTransfer ? "From" : "Account"}>
            <select className={inputClass} value={account} onChange={(e) => setAccountId(e.target.value)}>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          {isTransfer && (
            <Field label="To">
              <select className={inputClass} value={toAccount} onChange={(e) => setToAccountId(e.target.value)}>
                {data.accounts.filter((a) => a.id !== account).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
          )}
          <datalist id="money-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className="sm:col-span-3">
            <button className={buttonClass} disabled={!amount || (!isTransfer && !description.trim())}>
              {isTransfer ? "Record payment" : "Add transaction"}
            </button>
            {isTransfer && (
              <p className="mt-2 text-xs text-zinc-500">
                Takes the amount out of the first account and pays it into the second. It isn&apos;t counted as spending or income.
              </p>
            )}
          </div>
        </form>
      </Card>

      <Card
        title="Transactions"
        action={
          <div className="w-44 shrink-0">
            <input type="month" className={inputClass} value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
          </div>
        }
      >
        {filterMonth && (
          <p className="mb-3 text-xs text-zinc-500">
            In {money(totals.income)} · Out {money(totals.expenses)} · Net {money(totals.net)}
          </p>
        )}
        {items.length === 0 ? <Empty>No transactions for this period.</Empty> : <TransactionList data={data} items={items} deletable />}
      </Card>
    </div>
  );
}

function TransactionList({ data, items, deletable }: { data: MoneyData; items: Transaction[]; deletable?: boolean }) {
  const names = new Map(data.accounts.map((a) => [a.id, a.name]));
  const scopes = new Map(data.accounts.map((a) => [a.id, scopeOf(a)]));
  const personalCategories = categoriesInUse(filterByScope(data, "personal"), DEFAULT_CATEGORIES).filter((c) => c !== "Transfer");
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{t.description}</p>
            <p className="flex flex-wrap items-center gap-x-1 text-xs text-zinc-500">
              <span>{t.date} ·</span>
              {deletable && !t.transferId ? (
                <CategoryPicker
                  value={t.category}
                  options={isCompany(scopes.get(t.accountId)) ? BUSINESS_CATEGORY_NAMES : personalCategories}
                  onChange={(category) => setMoneyData((d) => learnCategory(d, t, category, scopes.get(t.accountId) ?? "personal", newId))}
                />
              ) : (
                <span>{t.category}</span>
              )}
              <span>· {names.get(t.accountId) ?? "Unknown account"}</span>
              {t.kind === "expense" && !t.transferId && <ReceiptMark data={data} t={t} scope={scopes.get(t.accountId) ?? "personal"} />}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`text-sm tabular-nums ${t.kind === "income" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
              {t.kind === "income" ? "+" : "−"}
              {money(t.amount)}
            </span>
            {deletable && (
              <button
                className="text-xs text-zinc-400 hover:text-rose-600"
                onClick={() =>
                  setMoneyData((d) => ({
                    ...d,
                    // Deleting either half of a payment or transfer removes both.
                    transactions: d.transactions.filter((x) => x.id !== t.id && !(t.transferId && x.transferId === t.transferId)),
                  }))
                }
              >
                Delete
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReceiptMark({ data, t, scope }: { data: MoneyData; t: Transaction; scope: Scope }) {
  const r = receiptFor(data, t.id);
  if (r) {
    return (
      <a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline dark:text-emerald-400">
        · 🧾 Receipt
      </a>
    );
  }
  return isCompany(scope) ? (
    <span>
      · <AttachReceipt t={t} scope={scope} />
    </span>
  ) : null;
}

/** Changing a category also teaches the app: others described the same way follow, now and on future syncs. */
function CategoryPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (c: string) => void }) {
  const list = options.includes(value) ? options : [value, ...options];
  const needsOne = !options.includes(value);
  return (
    <select
      aria-label="Category"
      className={`max-w-[12rem] cursor-pointer rounded border-0 bg-transparent py-0 pr-5 pl-0 text-xs hover:text-brand focus:ring-1 focus:ring-ember/50 ${
        needsOne ? "text-amber-600 dark:text-amber-400" : ""
      }`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {list.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

/* ---------------- Budgets ---------------- */

export function Budgets({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [category, setCategory] = useState("Groceries");
  const [limit, setLimit] = useState("");
  const defaultScope = useDefaultScope();
  const [scopeChoice, setScope] = useState<Scope | null>(null);
  const scope = scopeChoice ?? defaultScope;
  const month = currentMonth();

  function add(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(limit);
    const cat = category.trim();
    if (!cat || Number.isNaN(n) || n <= 0) return;
    setMoneyData((d) => {
      // Personal and business each keep their own budget per category.
      const existing = d.budgets.find(
        (b) => b.category.toLowerCase() === cat.toLowerCase() && (b.scope ?? "personal") === scope,
      );
      const budgets = existing
        ? d.budgets.map((b) => (b.id === existing.id ? { ...b, monthlyLimit: n } : b))
        : [...d.budgets, { id: newId(), category: cat, monthlyLimit: n, scope }];
      return { ...d, budgets };
    });
    setLimit("");
  }

  const totalLimit = data.budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const totalSpent = data.budgets.reduce((s, b) => s + (budgetSpent(data, b, month)), 0);

  return (
    <div className="flex flex-col gap-6">
      <Card title="Set a monthly budget">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end">
          <Field label="Category">
            <input className={inputClass} list="budget-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <datalist id="budget-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <Field label="Monthly limit">
            <input className={inputClass} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="500" />
          </Field>
          <ScopeField value={scope} onChange={setScope} />
          <button className={buttonClass} disabled={!limit}>Save</button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">Saving a category that already has a budget in the same book updates its limit.</p>
      </Card>

      <Card title={`${monthLabel(month)} budgets`}>
        {data.budgets.length === 0 ? (
          <Empty>No budgets yet.</Empty>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-500">
              {money(totalSpent)} spent of {money(totalLimit)} budgeted
            </p>
            <ul className="flex flex-col gap-4">
              {data.budgets.map((b) => {
                const spent = budgetSpent(data, b, month);
                const left = b.monthlyLimit - spent;
                return (
                  <li key={b.id}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{b.category}<ScopeBadge item={b} /></span>
                      <span className="flex items-center gap-3">
                        <span className={`tabular-nums ${left < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-500"}`}>
                          {left >= 0 ? `${money(left)} left` : `${money(-left)} over`}
                        </span>
                        <button
                          className="text-xs text-zinc-400 hover:text-rose-600"
                          onClick={() => setMoneyData((d) => ({ ...d, budgets: d.budgets.filter((x) => x.id !== b.id) }))}
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                    <Bar value={spent} max={b.monthlyLimit} over={left < 0} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
