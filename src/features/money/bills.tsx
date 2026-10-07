"use client";

import { useState, type FormEvent } from "react";
import { newId, setMoneyData } from "./store";
import { BILL_FREQUENCIES, type Bill, type BillFrequency, type MoneyData } from "./types";
import {
  addDays,
  billDatesBetween,
  billMonthlyCost,
  currentMonth,
  daysUntil,
  dueLabel,
  frequencyLabel,
  money,
  monthBounds,
  monthLabel,
  nextDueAfter,
  normalizeUrl,
  shortDate,
  today,
} from "./calc";
import { Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "./ui";

function parseAmount(s: string) {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Logs the payment as a transaction (when the bill has an account) and moves the bill to its next date. */
export function markBillPaid(bill: Bill) {
  const paidOn = bill.nextDue <= today() ? bill.nextDue : today();
  setMoneyData((d) => {
    const transactions = bill.accountId && d.accounts.some((a) => a.id === bill.accountId)
      ? [
          ...d.transactions,
          {
            id: newId(),
            date: paidOn,
            description: bill.name,
            amount: bill.amount,
            kind: "expense" as const,
            category: bill.category,
            accountId: bill.accountId,
          },
        ]
      : d.transactions;
    const next = nextDueAfter(bill, bill.nextDue);
    const bills = next
      ? d.bills.map((b) => (b.id === bill.id ? { ...b, nextDue: next } : b))
      : d.bills.filter((b) => b.id !== bill.id);
    return { ...d, transactions, bills };
  });
}

function BillName({ bill }: { bill: Bill }) {
  if (!bill.url) return <>{bill.name}</>;
  return (
    <a href={bill.url} target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100">
      {bill.name}
      <span className="ml-1 text-xs text-zinc-400">↗</span>
    </a>
  );
}

function dueTone(ymd: string) {
  const days = daysUntil(ymd);
  if (days < 0) return "text-rose-600 dark:text-rose-400";
  if (days <= 3) return "text-amber-600 dark:text-amber-400";
  return "text-zinc-500";
}

/** Compact list used on the Overview. */
export function UpcomingBills({ data, days }: { data: MoneyData; days: number }) {
  const until = addDays(today(), days);
  const items = data.bills.filter((b) => b.nextDue <= until).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  if (data.bills.length === 0) return <Empty>No bills yet.</Empty>;
  if (items.length === 0) return <Empty>Nothing due in the next {days} days.</Empty>;
  return <BillRows items={items} />;
}

function BillRows({ items, onEdit }: { items: Bill[]; onEdit?: (bill: Bill) => void }) {
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              <BillName bill={b} />
              {b.autopay && (
                <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800">
                  Autopay
                </span>
              )}
            </p>
            <p className="text-xs text-zinc-500">
              {shortDate(b.nextDue)} · <span className={dueTone(b.nextDue)}>{dueLabel(b.nextDue)}</span> · {frequencyLabel(b)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm tabular-nums">{money(b.amount)}</span>
            <button className={ghostButtonClass} onClick={() => markBillPaid(b)} title="Log the payment and move to the next date">
              Paid
            </button>
            {onEdit && (
              <button className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onEdit(b)}>
                Edit
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Draft = {
  name: string;
  amount: string;
  frequency: BillFrequency;
  nextDue: string;
  category: string;
  accountId: string;
  autopay: boolean;
  url: string;
  institutionId: string;
};

const blankDraft = (): Draft => ({
  name: "",
  amount: "",
  frequency: "monthly",
  nextDue: today(),
  category: "Utilities",
  accountId: "",
  autopay: false,
  url: "",
  institutionId: "",
});

export function Bills({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function save(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(draft.amount);
    if (!draft.name.trim() || Number.isNaN(amount) || amount < 0 || !draft.nextDue) return;
    const fields = {
      name: draft.name.trim(),
      amount,
      frequency: draft.frequency,
      nextDue: draft.nextDue,
      dueDay: Number(draft.nextDue.slice(8, 10)),
      category: draft.category.trim() || "Other",
      accountId: draft.accountId,
      autopay: draft.autopay,
      url: normalizeUrl(draft.url),
      institutionId: draft.institutionId,
    };
    setMoneyData((d) => ({
      ...d,
      bills: editingId
        ? d.bills.map((b) => (b.id === editingId ? { ...b, ...fields } : b))
        : [...d.bills, { id: newId(), ...fields }],
    }));
    setDraft(blankDraft());
    setEditingId(null);
  }

  function edit(b: Bill) {
    setEditingId(b.id);
    setDraft({
      name: b.name,
      amount: String(b.amount),
      frequency: b.frequency,
      nextDue: b.nextDue,
      category: b.category,
      accountId: b.accountId,
      autopay: b.autopay,
      url: b.url ?? "",
      institutionId: b.institutionId ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove() {
    if (!editingId || !confirm("Delete this bill?")) return;
    setMoneyData((d) => ({ ...d, bills: d.bills.filter((b) => b.id !== editingId) }));
    setDraft(blankDraft());
    setEditingId(null);
  }

  const sorted = [...data.bills].sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const monthly = data.bills.reduce((s, b) => s + billMonthlyCost(b), 0);
  const weekEnd = addDays(today(), 7);
  const dueThisWeek = data.bills.filter((b) => b.nextDue <= weekEnd).reduce((s, b) => s + b.amount, 0);
  const overdue = data.bills.filter((b) => daysUntil(b.nextDue) < 0).length;

  // Every date each bill comes out in the chosen month, earliest first.
  const { start, end } = monthBounds(month);
  const calendar = data.bills
    .flatMap((b) => billDatesBetween(b, start, end).map(({ date, paid }) => ({ date, paid, bill: b })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill.name.localeCompare(b.bill.name));
  const monthTotal = calendar.reduce((s, x) => s + x.bill.amount, 0);
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]));

  return (
    <div className="flex flex-col gap-6">
      {data.bills.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Bills per month" value={money(monthly)} />
          <Stat label="Due in next 7 days" value={money(dueThisWeek)} />
          <Stat label="Overdue" value={String(overdue)} tone={overdue > 0 ? "bad" : undefined} />
        </div>
      )}

      <Card title={editingId ? "Edit bill" : "Add a bill"}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="Bill">
            <input className={inputClass} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Electric" />
          </Field>
          <Field label="Amount">
            <input className={inputClass} inputMode="decimal" value={draft.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="How often">
            <select className={inputClass} value={draft.frequency} onChange={(e) => set("frequency", e.target.value as BillFrequency)}>
              {BILL_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Next comes out on">
            <input type="date" className={inputClass} value={draft.nextDue} onChange={(e) => set("nextDue", e.target.value)} />
          </Field>
          <Field label="Category">
            <input className={inputClass} list="bill-categories" value={draft.category} onChange={(e) => set("category", e.target.value)} />
          </Field>
          <datalist id="bill-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <Field label="Paid from">
            <select className={inputClass} value={draft.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value="">No account</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Company">
            <select className={inputClass} value={draft.institutionId} onChange={(e) => set("institutionId", e.target.value)}>
              <option value="">None</option>
              {data.institutions.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Where to pay it (link)">
              <input className={inputClass} inputMode="url" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://www.duke-energy.com/pay" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={draft.autopay} onChange={(e) => set("autopay", e.target.checked)} />
            Comes out automatically (autopay)
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button className={buttonClass} disabled={!draft.name.trim() || !draft.amount}>
              {editingId ? "Save changes" : "Add bill"}
            </button>
            {editingId && (
              <>
                <button type="button" className={ghostButtonClass} onClick={() => { setEditingId(null); setDraft(blankDraft()); }}>
                  Cancel
                </button>
                <button type="button" className="px-2 text-sm text-rose-600" onClick={remove}>
                  Delete bill
                </button>
              </>
            )}
          </div>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          Press Paid when a bill comes out. If it has an account, the payment is logged as a transaction, and the bill moves to its next date.
        </p>
      </Card>

      <Card title="All bills, next due first">
        {sorted.length === 0 ? <Empty>No bills yet. Add rent, utilities, phone, insurance, subscriptions and so on.</Empty> : <BillRows items={sorted} onEdit={edit} />}
      </Card>

      <Card
        title={`What comes out in ${monthLabel(month)}`}
        action={<div className="w-44 shrink-0"><input type="month" className={inputClass} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>}
      >
        {calendar.length === 0 ? (
          <Empty>No bills scheduled this month.</Empty>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-500">{money(monthTotal)} total across {calendar.length} payments</p>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {calendar.map(({ date, paid, bill }) => (
                <li key={`${bill.id}-${date}`} className={`flex items-center justify-between gap-3 py-2 ${paid ? "opacity-50" : ""}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-24 shrink-0 text-sm tabular-nums text-zinc-500">{shortDate(date)}</span>
                    <span className="truncate text-sm">
                      <BillName bill={bill} />
                      {bill.accountId && <span className="text-zinc-400"> · {accountNames.get(bill.accountId)}</span>}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">
                    {paid && <span className="mr-2 text-xs text-emerald-600 dark:text-emerald-400">Paid</span>}
                    {money(bill.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
