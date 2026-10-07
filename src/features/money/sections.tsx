"use client";

import { useState, type FormEvent } from "react";
import { newId, setMoneyData } from "./store";
import { ACCOUNT_TYPES, type AccountType, type MoneyData, type Transaction } from "./types";
import { accountBalance, accountTypeLabel, currentMonth, isLiability, money, monthLabel, monthTotals, today } from "./calc";
import { UpcomingBills } from "./bills";
import { Bar, Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "./ui";

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
                const spent = totals.byCategory.get(b.category) ?? 0;
                return (
                  <li key={b.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{b.category}</span>
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

export function Accounts({ data }: { data: MoneyData }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [balance, setBalance] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(balance || "0");
    if (!name.trim() || Number.isNaN(amount)) return;
    setMoneyData((d) => ({
      ...d,
      accounts: [...d.accounts, { id: newId(), name: name.trim(), type, openingBalance: amount }],
    }));
    setName("");
    setBalance("");
  }

  function remove(id: string) {
    const used = data.transactions.some((t) => t.accountId === id);
    const msg = used
      ? "Delete this account and all of its transactions?"
      : "Delete this account?";
    if (!confirm(msg)) return;
    setMoneyData((d) => ({
      ...d,
      accounts: d.accounts.filter((a) => a.id !== id),
      transactions: d.transactions.filter((t) => t.accountId !== id),
    }));
  }

  const owed = ACCOUNT_TYPES.find((t) => t.value === type)?.liability;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Add an account">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chase checking" />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label={owed ? "Amount owed now" : "Balance now"}>
            <input className={inputClass} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
          </Field>
          <button className={buttonClass} disabled={!name.trim()}>Add</button>
        </form>
      </Card>

      <Card title="Your accounts">
        {data.accounts.length === 0 ? (
          <Empty>No accounts yet.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.accounts.map((a) => {
              const b = accountBalance(data, a);
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-zinc-500">{accountTypeLabel(a)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`tabular-nums ${b < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                      {isLiability(a) && b <= 0 ? `${money(-b)} owed` : money(b)}
                    </span>
                    <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => remove(a.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Transactions ---------------- */

export function Transactions({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<Transaction["kind"]>("expense");
  const [category, setCategory] = useState("Groceries");
  const [accountId, setAccountId] = useState("");
  const [filterMonth, setFilterMonth] = useState(currentMonth());

  const account = accountId || data.accounts[0]?.id || "";

  function add(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!account || !description.trim() || Number.isNaN(n) || n <= 0) return;
    setMoneyData((d) => ({
      ...d,
      transactions: [
        ...d.transactions,
        { id: newId(), date, description: description.trim(), amount: n, kind, category: category.trim() || "Other", accountId: account },
      ],
    }));
    setDescription("");
    setAmount("");
  }

  if (data.accounts.length === 0 && data.bills.length === 0) {
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
      <Card title="Log a transaction">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="Type">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Transaction["kind"])}>
              <option value="expense">Money out</option>
              <option value="income">Money in</option>
            </select>
          </Field>
          <Field label="Amount">
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Description">
            <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Trader Joe's" />
          </Field>
          <Field label="Category">
            <input className={inputClass} list="money-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Account">
            <select className={inputClass} value={account} onChange={(e) => setAccountId(e.target.value)}>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <datalist id="money-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className="sm:col-span-3">
            <button className={buttonClass} disabled={!description.trim() || !amount}>Add transaction</button>
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
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{t.description}</p>
            <p className="text-xs text-zinc-500">
              {t.date} · {t.category} · {names.get(t.accountId) ?? "Unknown account"}
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
                onClick={() => setMoneyData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== t.id) }))}
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

/* ---------------- Budgets ---------------- */

export function Budgets({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [category, setCategory] = useState("Groceries");
  const [limit, setLimit] = useState("");
  const month = currentMonth();
  const totals = monthTotals(data, month);

  function add(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(limit);
    const cat = category.trim();
    if (!cat || Number.isNaN(n) || n <= 0) return;
    setMoneyData((d) => {
      const existing = d.budgets.find((b) => b.category.toLowerCase() === cat.toLowerCase());
      const budgets = existing
        ? d.budgets.map((b) => (b.id === existing.id ? { ...b, monthlyLimit: n } : b))
        : [...d.budgets, { id: newId(), category: cat, monthlyLimit: n }];
      return { ...d, budgets };
    });
    setLimit("");
  }

  const totalLimit = data.budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const totalSpent = data.budgets.reduce((s, b) => s + (totals.byCategory.get(b.category) ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <Card title="Set a monthly budget">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Field label="Category">
            <input className={inputClass} list="budget-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <datalist id="budget-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <Field label="Monthly limit">
            <input className={inputClass} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="500" />
          </Field>
          <button className={buttonClass} disabled={!limit}>Save</button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">Saving a category that already has a budget updates its limit.</p>
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
                const spent = totals.byCategory.get(b.category) ?? 0;
                const left = b.monthlyLimit - spent;
                return (
                  <li key={b.id}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{b.category}</span>
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
