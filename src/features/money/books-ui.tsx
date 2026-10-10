"use client";

import { useState, type FormEvent } from "react";
import { booksCsv, estimatedTaxDueDates, periodsFor, profitAndLoss, taxSetAside, type LineTotal } from "./books";
import { money, today } from "./calc";
import { StatementImport } from "./import";
import { newId, setMoneyData } from "./store";
import { ACCOUNT_TYPES, COMPANIES, companyLabel, taxFormLabel, taxFormOf, type AccountType, type Company, type MoneyData } from "./types";
import { Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "./ui";
import { QuickBooksPanel } from "./quickbooks";

// Gladiator's bookkeeper keeps its books in QuickBooks.
const QUICKBOOKS_COMPANY: Company = "gladiator";

const RATE_KEY = "maverick.books.taxRate";

/** A company's books: profit and loss by Schedule C line, tax set-aside, and a CPA export. */
export function Books({
  data,
  goTo,
  initialCompany = "business",
  quickBooksNotice,
}: {
  data: MoneyData;
  goTo: (tab: string) => void;
  initialCompany?: Company;
  quickBooksNotice?: string | null;
}) {
  const [company, setCompany] = useState<Company>(initialCompany);
  const name = companyLabel(company);
  const form = taxFormOf(company);
  const sCorp = form === "1120S";
  const drawsLabel = sCorp ? "Shareholder distributions" : "Owner draws";
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [rate, setRate] = useState(() => {
    try {
      return Number(window.localStorage.getItem(RATE_KEY)) || 22;
    } catch {
      return 22;
    }
  });
  const periods = periodsFor(year);
  const period = periods[periodIndex];
  const pl = profitAndLoss(data, period, company);
  const hasBusinessAccounts = data.accounts.some((a) => a.scope === company);

  // Tax set-aside is for the year to date, so it reflects the whole year's profit.
  const ytd = profitAndLoss(data, periods[0], company);
  const tax = taxSetAside(ytd.taxableProfit, rate, form);

  function saveRate(n: number) {
    setRate(n);
    try {
      window.localStorage.setItem(RATE_KEY, String(n));
    } catch {
      /* fine */
    }
  }

  function exportCsv() {
    const blob = new Blob([booksCsv(data, period, company)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase()}-books-${period.label.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!hasBusinessAccounts) {
    return (
      <div className="flex flex-col gap-6">
        <CompanyPicker company={company} onChange={setCompany} />
        {company === QUICKBOOKS_COMPANY && <QuickBooksPanel year={thisYear} notice={quickBooksNotice} />}
        <Card title={`${name} books`}>
          <Empty>
            {company === QUICKBOOKS_COMPANY && "Optional when QuickBooks is connected. "}
            Start by adding {name}&apos;s bank or card account below. Then import its statement, and the transactions show up here as profit
            and loss, sorted by {taxFormLabel(form)} line.
          </Empty>
        </Card>
        <AddBusinessAccount company={company} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CompanyPicker company={company} onChange={setCompany} />
      {company === QUICKBOOKS_COMPANY && <QuickBooksPanel year={year} notice={quickBooksNotice} />}
      <StatementImport data={data} scope={company} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Year">
          <select className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period">
          <select className={inputClass} value={periodIndex} onChange={(e) => setPeriodIndex(Number(e.target.value))}>
            {periods.map((p, i) => (
              <option key={p.label} value={i}>
                {i === 0 ? "Full year" : p.label}
              </option>
            ))}
          </select>
        </Field>
        <button className={ghostButtonClass} onClick={exportCsv}>
          Export for CPA (CSV)
        </button>
      </div>

      {pl.uncategorized.length > 0 && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {pl.uncategorized.length} transaction{pl.uncategorized.length === 1 ? "" : "s"} in this period need a business category (
          {money(pl.uncategorized.reduce((s, t) => s + t.amount, 0))}).{" "}
          <button className="underline" onClick={() => goTo("transactions")}>
            Sort them in Transactions
          </button>
          . Pick a category once and similar ones follow.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Income" value={money(pl.income)} />
        <Stat label="Expenses" value={money(pl.cogs + pl.expenses)} />
        <Stat label="Net profit" value={money(pl.netProfit)} tone={pl.netProfit >= 0 ? "good" : "bad"} />
        <Stat label={drawsLabel} value={money(pl.draws)} />
      </div>

      <Card title={`Profit and loss · ${period.label}`}>
        <PlTable title="Income" lines={pl.incomeLines} total={pl.income} />
        {pl.cogs > 0 && <Row label="Gross profit" value={pl.grossProfit} strong />}
        <PlTable title="Expenses" lines={pl.expenseLines} total={pl.cogs + pl.expenses} />
        <div className="mt-2 border-t border-zinc-300 pt-2 dark:border-zinc-700">
          <Row
            label={sCorp ? "Ordinary business income (Form 1120-S line 21, before adjustments)" : "Net profit (Schedule C line 31, before adjustments)"}
            value={pl.netProfit}
            strong
          />
          {pl.taxableProfit !== pl.netProfit && <Row label="After the 50% meals limit" value={pl.taxableProfit} />}
        </div>
        <div className="mt-4 grid gap-1 text-xs text-zinc-500">
          <p>Not profit or loss: {sCorp ? "shareholder contributions" : "owner contributions"} {money(pl.contributions)} · {drawsLabel.toLowerCase()} {money(pl.draws)} · equipment purchases {money(pl.assets)} (ask your CPA about depreciation).</p>
        </div>
      </Card>

      <Card title={`Taxes to set aside · ${year} so far`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {sCorp ? (
            <Stat label="Self-employment tax" value="None (S-corp)" />
          ) : (
            <Stat label="Self-employment tax" value={money(tax.seTax)} />
          )}
          <Stat label={`Income tax at ${rate}%`} value={money(tax.incomeTax)} />
          <Stat label="Set aside" value={money(tax.total)} tone="bad" />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Your income tax rate (federal + state)">
            <select className={inputClass} value={rate} onChange={(e) => saveRate(Number(e.target.value))}>
              {[12, 15, 18, 22, 25, 28, 30, 32, 35, 40].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </Field>
          <div className="text-xs text-zinc-500">
            <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-400">Estimated tax payments (IRS Form 1040-ES)</p>
            <p>
              {estimatedTaxDueDates(year)
                .map((d) => `${d.label} due ${new Date(d.due + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`)
                .join(" · ")}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          {sCorp
            ? "Gladiator's profit passes to your personal return on a K-1, taxed at your rate with no self-employment tax. Your salary is taxed through payroll, so it isn't counted here. A rough estimate, not tax advice. Confirm with your CPA."
            : "A rough estimate from this year's profit so far, not tax advice. Confirm amounts with your CPA."}
        </p>
      </Card>
      <AddBusinessAccount company={company} />
    </div>
  );
}

function PlTable({ title, lines, total }: { title: string; lines: LineTotal[]; total: number }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500">None in this period.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {lines.map((l) => (
            <li key={`${l.line}-${l.lineLabel}`} className="py-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  <span className="mr-2 inline-block w-9 text-xs tabular-nums text-zinc-400">{l.line}</span>
                  {l.lineLabel}
                </span>
                <span className="tabular-nums">{money(l.amount)}</span>
              </div>
              {l.categories.size > 1 && (
                <p className="ml-11 text-xs text-zinc-500">
                  {[...l.categories].map(([c, v]) => `${c} ${money(v)}`).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Row label={`Total ${title.toLowerCase()}`} value={total} strong />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${strong ? "font-medium" : ""}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${value < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{money(value)}</span>
    </div>
  );
}

function CompanyPicker({ company, onChange }: { company: Company; onChange: (c: Company) => void }) {
  return (
    <div role="radiogroup" aria-label="Company" className="flex gap-2">
      {COMPANIES.map((c) => (
        <button
          key={c.value}
          role="radio"
          aria-checked={company === c.value}
          onClick={() => onChange(c.value)}
          className={company === c.value ? buttonClass : ghostButtonClass}
        >
          {c.legalName}
        </button>
      ))}
    </div>
  );
}

/** Quick way to add a company account without leaving the books. */
function AddBusinessAccount({ company }: { company: Company }) {
  const label = companyLabel(company);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [opening, setOpening] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setMoneyData((d) => ({
      ...d,
      accounts: [...d.accounts, { id: newId(), name: name.trim(), type, openingBalance: Number(opening) || 0, scope: company }],
    }));
    setName("");
    setOpening("");
  }

  return (
    <Card title={`Add a ${label} account`}>
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${label} checking`} />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Balance at the start of your statement">
          <input className={inputClass} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
        </Field>
        <button className={buttonClass} type="submit">
          Add account
        </button>
      </form>
    </Card>
  );
}
