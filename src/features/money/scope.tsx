"use client";

import { createContext, useContext } from "react";
import { companyLabel, isCompany, type MoneyData, type Scope } from "./types";
import { Field, inputClass } from "./ui";

export type ScopeView = "all" | Scope;

export const SCOPES: { value: Scope; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Maverick" },
  { value: "gladiator", label: "Gladiator" },
];

/** The All / Personal / Maverick / Gladiator switch at the top of the Financial Center. */
export const ScopeContext = createContext<ScopeView>("all");

export function useScopeView() {
  return useContext(ScopeContext);
}

/** New items go into the book being viewed; in "All" they default to Personal. */
export function useDefaultScope(): Scope {
  const view = useScopeView();
  return view === "all" ? "personal" : view;
}

export const scopeOf = (item: { scope?: Scope }): Scope => item.scope ?? "personal";

/** Only the items in the chosen book. Transactions follow their account. */
export function filterByScope(data: MoneyData, view: ScopeView): MoneyData {
  if (view === "all") return data;
  const inView = (x: { scope?: Scope }) => scopeOf(x) === view;
  const accounts = data.accounts.filter(inView);
  const accountIds = new Set(accounts.map((a) => a.id));
  return {
    ...data,
    accounts,
    transactions: data.transactions.filter((t) => accountIds.has(t.accountId)),
    budgets: data.budgets.filter(inView),
    bills: data.bills.filter(inView),
    institutions: data.institutions.filter(inView),
    bankLinks: data.bankLinks.filter(inView),
  };
}

export function ScopeField({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  return (
    <Field label="Whose is it">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Scope)}>
        {SCOPES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </Field>
  );
}

/** Small tag on company items, shown only when every book is on screen. */
export function ScopeBadge({ item }: { item: { scope?: Scope } }) {
  const view = useScopeView();
  if (view !== "all" || !isCompany(scopeOf(item))) return null;
  return (
    <span className="ml-2 rounded bg-ember/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
      {companyLabel(scopeOf(item))}
    </span>
  );
}
