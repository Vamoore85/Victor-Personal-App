"use client";

import Link from "next/link";
import { useMemo } from "react";
import { cleanAccounts, accountLabel } from "./accounts-fix";
import { balances, ENTITIES, type AccountLine, type BalanceState } from "./outlook";
import { useMoneyData } from "./store";
import type { Scope } from "./types";

/*
 * Every account in one place, by company: what's in it, what's owed, and
 * whether its balance comes live from the bank or only from statements.
 * Read-only; adding, naming and assigning accounts stays under Money > Accounts.
 */

// Same company colors as the Bills page.
const HEAD: Record<Scope, string> = { business: "bg-blue-600", personal: "bg-green-600", gladiator: "bg-orange-500" };
const ORDER: Scope[] = ["business", "personal", "gladiator"];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return m < 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
const STATE: Record<BalanceState, { label: string; tone: string }> = {
  bank: { label: "Live", tone: "text-green-700 dark:text-green-400" },
  "bank-old": { label: "Live (not updated today)", tone: "text-amber-700 dark:text-amber-400" },
  waiting: { label: "Connected, waiting for balance", tone: "text-zinc-500" },
  lost: { label: "Connection lost", tone: "text-rose-600 dark:text-rose-400" },
  unlinked: { label: "Statements only", tone: "text-zinc-500" },
};

function Rows({ lines, owed }: { lines: AccountLine[]; owed?: boolean }) {
  return (
    <>
      {lines.map((a, i) => (
        <tr key={`${a.last4}-${i}`} className="border-t border-zinc-100 dark:border-zinc-800">
          <td className="py-2 pr-3">
            <div className="font-medium">{a.name}</div>
            <div className="text-xs text-zinc-500">
              {a.last4 ? `··${a.last4}` : ""}
              {a.bankName ? ` · ${a.bankName}` : ""}
            </div>
          </td>
          <td className={`py-2 pr-3 text-xs ${STATE[a.state].tone}`}>
            {STATE[a.state].label}
            {a.asOf && <div className="text-zinc-400">{ago(a.asOf)}</div>}
          </td>
          <td className="py-2 text-right font-semibold tabular-nums">
            {a.amount === null ? <span className="text-zinc-400">—</span> : money(a.amount)}
            {owed && a.credit != null && <div className="text-xs font-normal text-zinc-500">{money(a.credit)} left</div>}
          </td>
        </tr>
      ))}
    </>
  );
}

export function AccountsOverview() {
  const data = useMoneyData();
  const view = useMemo(() => {
    if (!data) return null;
    const clean = cleanAccounts(data).data;
    return { ents: balances(clean), unassigned: clean.accounts.filter((a) => a.needsEntity) };
  }, [data]);
  if (!view) return <p className="text-sm text-zinc-500">Loading…</p>;
  const { ents, unassigned } = view;
  const totalCash = ents.reduce((s, e) => s + e.available, 0);
  const totalOwed = ents.reduce((s, e) => s + e.owed, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Cash, all companies</div>
          <div className="text-2xl font-semibold tabular-nums">{money(totalCash)}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Owed on cards and loans</div>
          <div className="text-2xl font-semibold tabular-nums">{money(totalOwed)}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {ORDER.map((id) => {
          const e = ents.find((x) => x.entity === id)!;
          const label = ENTITIES.find((x) => x.id === id)!.label;
          return (
            <section key={id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
              <header className={`${HEAD[id]} flex items-baseline justify-between px-4 py-2.5 text-white`}>
                <h2 className="font-semibold">{label}</h2>
                <span className="text-sm tabular-nums">{money(e.available)} cash</span>
              </header>
              <div className="px-4 pb-3">
                {e.accounts.length + e.cards.length === 0 && <p className="py-3 text-sm text-zinc-500">No accounts yet.</p>}
                {e.accounts.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-zinc-500">
                        <th className="pt-3 pb-1 font-medium">Bank accounts</th>
                        <th className="pt-3 pb-1 font-medium">Balance from</th>
                        <th className="pt-3 pb-1 text-right font-medium">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Rows lines={e.accounts} />
                    </tbody>
                  </table>
                )}
                {e.cards.length > 0 && (
                  <table className="mt-2 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-zinc-500">
                        <th className="pt-3 pb-1 font-medium">Cards and loans</th>
                        <th className="pt-3 pb-1 font-medium">Balance from</th>
                        <th className="pt-3 pb-1 text-right font-medium">Owed</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Rows lines={e.cards} owed />
                    </tbody>
                  </table>
                )}
                {e.stale > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    {e.stale} account{e.stale === 1 ? " has" : "s have"} no live balance and {e.stale === 1 ? "isn't" : "aren't"} in the cash total.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/30">
          <h2 className="font-semibold">Needs a company</h2>
          <p className="text-zinc-600 dark:text-zinc-400">These aren&apos;t counted anywhere until you pick Personal, Maverick or Gladiator.</p>
          <ul className="mt-2 list-disc pl-5">
            {unassigned.map((a) => (
              <li key={a.id}>
                {accountLabel(a)} {a.last4 ? `··${a.last4}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/money?tab=accounts" className="self-start text-sm text-zinc-500 underline hover:text-brand">
        Connect a bank, rename or reassign accounts
      </Link>
    </div>
  );
}
