"use client";

import { assignEntity } from "./accounts-fix";
import { ENTITIES, entityLabel } from "./outlook";
import { setMoneyData } from "./store";
import type { MoneyData, Scope } from "./types";

/*
 * Which company each account belongs to: Personal, Maverick or Gladiator.
 * Every real account is listed once. An account nobody has assigned yet is
 * counted in no company's totals until you pick one here.
 */
export function AssignAccounts({ data }: { data: MoneyData }) {
  const links = new Map(data.bankLinks.map((l) => [l.id, l]));
  const rows = data.accounts
    .filter((a) => !(a.plaid && links.get(a.plaid.linkId)?.duplicateOf))
    .map((a) => {
      const link = a.plaid ? links.get(a.plaid.linkId) : undefined;
      return { a, bank: link?.institution || "", live: !!link };
    })
    .sort((x, y) => Number(!!y.a.needsEntity) - Number(!!x.a.needsEntity) || x.a.name.localeCompare(y.a.name));
  const open = rows.filter((r) => r.a.needsEntity).length;

  function pick(id: string, to: Scope, from: Scope | null) {
    if (from && from !== to && !confirm(`Move this account from ${entityLabel(from)} to ${entityLabel(to)}? Its transactions and bills move with it.`)) return;
    setMoneyData((d) => assignEntity(d, id, to));
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-surface p-4 sm:p-5 dark:border-zinc-800" data-testid="assign-accounts">
      <h2 className="text-lg font-semibold tracking-tight">Which company is each account?</h2>
      <p className="mt-1 text-sm text-zinc-500">
        {open
          ? `${open} account${open === 1 ? " needs" : "s need"} a company. Until then ${open === 1 ? "it isn't" : "they aren't"} counted in Personal, Maverick or Gladiator.`
          : "Every account has a company. Change one here if it's wrong."}
      </p>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {rows.map(({ a, bank, live }) => {
          const current = a.needsEntity ? null : (a.scope ?? "personal");
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`assign-${a.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {a.name}
                  {a.last4 && <span className="text-zinc-500"> ··{a.last4}</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  {[bank, a.type === "credit" ? "Card" : a.type === "loan" ? "Loan" : a.type === "savings" ? "Savings" : a.type === "checking" ? "Checking" : a.type, live ? "connected" : "no live connection"].filter(Boolean).join(" · ")}
                  {a.needsEntity && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-300">Needs assignment</span>}
                </p>
              </div>
              <div role="radiogroup" aria-label={`Company for ${a.name}`} className="inline-flex rounded-full border border-zinc-300 p-0.5 dark:border-zinc-700">
                {ENTITIES.map((e) => (
                  <button
                    key={e.id}
                    role="radio"
                    aria-checked={current === e.id}
                    onClick={() => pick(a.id, e.id, current)}
                    className={`rounded-full px-3 py-1 text-sm ${current === e.id ? "bg-brand font-medium text-on-brand" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
