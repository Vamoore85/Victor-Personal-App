"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PasteLogins } from "./logins-paste-ui";
import { ENTITIES } from "./outlook";
import { scopeOf } from "./scope";
import { useMoneyData } from "./store";
import type { MoneyData, Scope } from "./types";
import { InstitutionLogins, VaultBar } from "./vault-ui";

/*
 * Every login by company. Passwords live in the Maverick Vault and only show
 * after you unlock it (vault-ui.tsx); this page only arranges them.
 */

// Same company colors as the Bills and Accounts pages.
const HEAD: Record<Scope, string> = { business: "bg-blue-600", personal: "bg-green-600", gladiator: "bg-orange-500" };
const ORDER: Scope[] = ["personal", "business", "gladiator"];

export function LoginsOverview() {
  const data = useMoneyData();
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  return <LoginsView data={data} />;
}

function LoginsView({ data }: { data: MoneyData }) {
  const companies = useMemo(
    () =>
      ORDER.map((id) => ({
        id,
        label: ENTITIES.find((e) => e.id === id)!.label,
        institutions: data.institutions.filter((i) => scopeOf(i) === id).sort((a, b) => a.name.localeCompare(b.name)),
      })),
    [data],
  );

  return (
    <div className="flex flex-col gap-5">
      <VaultBar />

      {companies.map((c) => (
        <section key={c.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
          <header className={`${HEAD[c.id]} flex items-baseline justify-between px-4 py-2.5 text-white`}>
            <h2 className="font-semibold">{c.label}</h2>
            <span className="text-sm tabular-nums">{c.institutions.length} {c.institutions.length === 1 ? "company" : "companies"}</span>
          </header>
          <div className="p-4">
            {c.institutions.length === 0 ? (
              <p className="text-sm text-zinc-500">No logins yet. Paste them below.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {c.institutions.map((inst) => (
                  <div key={inst.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">{inst.name}</p>
                      {inst.loginUrl && (
                        <a href={inst.loginUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600">
                          Sign in ↗
                        </a>
                      )}
                    </div>
                    <InstitutionLogins institution={inst} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ))}

      <PasteLogins data={data} />

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
        <Link href="/accounts" className="underline hover:text-brand">Accounts and bills</Link>
      </div>
    </div>
  );
}
