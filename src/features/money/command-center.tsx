"use client";

import { estimatedTaxDueDates, periodsFor, profitAndLoss, taxSetAside } from "./books";
import { accountBalance, currentMonth, daysUntil, money, monthLabel, monthTotals, shortDate, today } from "./calc";
import { UpcomingBills } from "./bills";
import { filterByScope } from "./scope";
import { COMPANIES, type Company, type MoneyData, type Scope } from "./types";
import { Card, Stat, ghostButtonClass } from "./ui";

const RATE_KEY = "maverick.books.taxRate";

function savedTaxRate() {
  try {
    return Number(window.localStorage.getItem(RATE_KEY)) || 22;
  } catch {
    return 22;
  }
}

/** Cash and debt on the accounts in one book. */
function position(data: MoneyData, scope: Scope) {
  const book = filterByScope(data, scope);
  let cash = 0;
  let debt = 0;
  for (const a of book.accounts) {
    const b = accountBalance(book, a);
    if (b >= 0) cash += b;
    else debt += -b;
  }
  return { book, cash, debt, accounts: book.accounts.length };
}

/**
 * The whole picture on one screen: personal net worth, each company's cash,
 * profit and tax set-aside, what's due soon, and what needs attention.
 */
export function CommandCenter({ data, goTo, openBooks }: { data: MoneyData; goTo: (tab: string) => void; openBooks: (c: Company) => void }) {
  const month = currentMonth();
  const year = Number(today().slice(0, 4));
  const ytdPeriod = periodsFor(year)[0];
  const rate = savedTaxRate();

  const personal = position(data, "personal");
  const personalMonth = monthTotals(personal.book, month);
  const companies = COMPANIES.map((c) => {
    const p = position(data, c.value);
    const ytd = profitAndLoss(data, ytdPeriod, c.value);
    const thisMonth = profitAndLoss(data, { start: `${month}-01`, end: `${month}-31`, label: month }, c.value);
    return { ...c, ...p, ytd, thisMonth, tax: taxSetAside(ytd.taxableProfit, rate, c.taxForm) };
  });

  const businessCash = companies.reduce((s, c) => s + c.cash - c.debt, 0);
  const taxReserve = companies.reduce((s, c) => s + c.tax.total, 0);
  const nextTax = estimatedTaxDueDates(year)
    .concat(estimatedTaxDueDates(year + 1))
    .find((d) => d.due >= today());

  // Things worth a look, in plain words.
  const alerts: { text: string; action?: () => void; label?: string }[] = [];
  for (const c of companies) {
    if (c.ytd.uncategorized.length > 0)
      alerts.push({ text: `${c.ytd.uncategorized.length} ${c.label} transaction${c.ytd.uncategorized.length === 1 ? "" : "s"} this year need${c.ytd.uncategorized.length === 1 ? "s" : ""} a tax category.`, action: () => openBooks(c.value), label: "Sort them" });
    if (c.accounts === 0) alerts.push({ text: `${c.legalName} has no accounts yet.`, action: () => openBooks(c.value), label: "Add one" });
  }
  for (const l of data.bankLinks) if (l.error) alerts.push({ text: `${l.institution} needs you to sign in again.`, action: () => goTo("accounts"), label: "Fix" });
  if (nextTax && daysUntil(nextTax.due) <= 30 && taxReserve > 0)
    alerts.push({ text: `Estimated tax payment ${nextTax.label} is due ${shortDate(nextTax.due)} (${daysUntil(nextTax.due)} days).` });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Personal net worth" value={money(personal.cash - personal.debt)} tone={personal.cash - personal.debt >= 0 ? "good" : "bad"} />
        <Stat label="Business cash (net of debt)" value={money(businessCash)} />
        <Stat label={`Business profit ${year}`} value={money(companies.reduce((s, c) => s + c.ytd.netProfit, 0))} />
        <Stat label="Tax to set aside" value={money(taxReserve)} tone={taxReserve > 0 ? "bad" : undefined} />
      </div>

      <Card title="Needs your attention">
        {alerts.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing right now.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span>{a.text}</span>
                {a.action && (
                  <button className={ghostButtonClass} onClick={a.action}>
                    {a.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`By book · ${year} so far`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-normal"></th>
                <th className="py-1 pr-3 text-right font-normal">Cash</th>
                <th className="py-1 pr-3 text-right font-normal">Debt</th>
                <th className="py-1 pr-3 text-right font-normal">In · {monthLabel(month)}</th>
                <th className="py-1 pr-3 text-right font-normal">Out · {monthLabel(month)}</th>
                <th className="py-1 pr-3 text-right font-normal">Profit {year}</th>
                <th className="py-1 pr-3 text-right font-normal">Draws / distributions</th>
                <th className="py-1 text-right font-normal">Tax to set aside</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-3 font-medium">Personal</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(personal.cash)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(personal.debt)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(personalMonth.income)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(personalMonth.expenses)}</td>
                <td className="py-2 pr-3 text-right text-zinc-400">—</td>
                <td className="py-2 pr-3 text-right text-zinc-400">—</td>
                <td className="py-2 text-right text-zinc-400">—</td>
              </tr>
              {companies.map((c) => (
                <tr key={c.value} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-3 font-medium">
                    <button className="underline-offset-2 hover:underline" onClick={() => openBooks(c.value)}>
                      {c.legalName}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(c.cash)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(c.debt)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(c.thisMonth.income)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(c.thisMonth.cogs + c.thisMonth.expenses)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${c.ytd.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {money(c.ytd.netProfit)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(c.ytd.draws)}</td>
                  <td className="py-2 text-right tabular-nums">{money(c.tax.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Business cash belongs to each company, so it isn&apos;t counted in personal net worth. Tax to set aside is a rough
          estimate at your {rate}% income tax rate, plus self-employment tax for Maverick (Gladiator is an S-corp, so none);
          confirm with your CPA.
          {nextTax && ` Next estimated payment: ${nextTax.label}, due ${shortDate(nextTax.due)}.`}
        </p>
      </Card>

      <Card title="Bills due in the next 2 weeks" action={<button className={ghostButtonClass} onClick={() => goTo("bills")}>All bills</button>}>
        <UpcomingBills data={data} days={14} />
      </Card>
    </div>
  );
}
