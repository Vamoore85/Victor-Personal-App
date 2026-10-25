"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { accountLabel, cleanAccounts } from "./accounts-fix";
import { accountBalance, accountTypeLabel, isLiability, money, shortDate } from "./calc";
import { PasteLogins } from "./logins-paste-ui";
import { ENTITIES, upcoming, type UpcomingLine } from "./outlook";
import { scopeOf, ScopeField } from "./scope";
import { newId, setMoneyData, useMoneyData } from "./store";
import { ACCOUNT_TYPES, type Account, type AccountType, type Institution, type MoneyData, type Scope } from "./types";
import { Card, Field, Stat, buttonClass, inputClass } from "./ui";
import { InstitutionLogins, VaultBar } from "./vault-ui";

/*
 * Every account, bill and login by company, on one page, with what each one
 * leaves you with. Adding an account is open; passwords live in the vault and
 * only show after you unlock it. Editing and bank connections stay on Money.
 */

// Same company colors as the Bills page.
const HEAD: Record<Scope, string> = { business: "bg-blue-600", personal: "bg-green-600", gladiator: "bg-orange-500" };
const ORDER: Scope[] = ["personal", "business", "gladiator"];

const round = (n: number) => Math.round(n * 100) / 100;

type CompanyBooks = {
  id: Scope;
  cash: number;
  owed: number;
  confirmed: number;
  accounts: { account: Account; balance: number }[];
  bills: UpcomingLine[];
  institutions: Institution[];
};

function booksByCompany(d: MoneyData, lines: UpcomingLine[]): CompanyBooks[] {
  return ORDER.map((id) => {
    const accounts = d.accounts
      .filter((a) => !a.needsEntity && scopeOf(a) === id && !(a.plaid && d.bankLinks.find((l) => l.id === a.plaid!.linkId)?.duplicateOf))
      .map((account) => ({ account, balance: accountBalance(d, account) }));
    const cash = accounts.filter((x) => !isLiability(x.account)).reduce((s, x) => s + x.balance, 0);
    const owed = accounts.filter((x) => isLiability(x.account)).reduce((s, x) => s + Math.max(0, -x.balance), 0);
    const bills = lines.filter((l) => l.entity === id);
    const confirmed = bills.filter((l) => !l.predicted).reduce((s, l) => s + l.amount, 0);
    return {
      id,
      cash: round(cash),
      owed: round(owed),
      confirmed: round(confirmed),
      accounts,
      bills,
      institutions: d.institutions.filter((i) => scopeOf(i) === id).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export function AccountsOverview() {
  const data = useMoneyData();
  // Dates are read only once the data is loaded, so the page can still prerender.
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  return <AccountsView data={data} />;
}

function AccountsView({ data }: { data: MoneyData }) {
  const clean = useMemo(() => cleanAccounts(data).data, [data]);
  const lines = useMemo(() => upcoming(clean, 30), [clean]);
  const companies = useMemo(() => booksByCompany(clean, lines), [clean, lines]);
  const unassigned = clean.accounts.filter((a) => a.needsEntity);
  const total = (pick: (c: CompanyBooks) => number) => round(companies.reduce((s, c) => s + pick(c), 0));
  const cash = total((c) => c.cash);
  const confirmed = total((c) => c.confirmed);
  const left = round(cash - confirmed);

  return (
    <div className="flex flex-col gap-5">
      <VaultBar />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cash, all companies" value={money(cash)} />
        <Stat label="Owed on cards and loans" value={money(total((c) => c.owed))} />
        <Stat label="Confirmed bills, next 30 days" value={money(confirmed)} />
        <Stat label="Left after those bills" value={money(left)} tone={left < 0 ? "bad" : "good"} />
      </div>

      <AddAccount data={data} />

      {companies.map((c) => (
        <CompanySection key={c.id} books={c} data={clean} />
      ))}

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

      <PasteLogins data={data} />

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
        <Link href="/money?tab=bills" className="underline hover:text-brand">All bills</Link>
        <Link href="/money?tab=accounts" className="underline hover:text-brand">Edit or rename accounts</Link>
        <Link href="/integrations" className="underline hover:text-brand">Connect a bank</Link>
      </div>
    </div>
  );
}

function CompanySection({ books, data }: { books: CompanyBooks; data: MoneyData }) {
  const label = ENTITIES.find((e) => e.id === books.id)!.label;
  const left = round(books.cash - books.confirmed);
  const bankName = (id?: string) => data.institutions.find((i) => i.id === id)?.name;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
      <header className={`${HEAD[books.id]} flex items-baseline justify-between px-4 py-2.5 text-white`}>
        <h2 className="font-semibold">{label}</h2>
        <span className="text-sm tabular-nums">{money(books.cash)} cash</span>
      </header>

      <div className="flex flex-col gap-6 p-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-zinc-500">Owed on cards and loans</dt>
            <dd className="font-semibold tabular-nums">{money(books.owed)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Confirmed bills, 30 days</dt>
            <dd className="font-semibold tabular-nums">{money(books.confirmed)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Left after bills</dt>
            <dd className={`font-semibold tabular-nums ${left < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{money(left)}</dd>
          </div>
        </dl>

        <div>
          <h3 className="mb-1 text-sm font-medium text-zinc-500">Accounts</h3>
          {books.accounts.length === 0 ? (
            <p className="text-sm text-zinc-500">No accounts yet. Add one above.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {books.accounts.map(({ account: a, balance }) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {accountLabel(a)}
                      {a.last4 && <span className="ml-1 text-sm font-normal text-zinc-500">··{a.last4}</span>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {[accountTypeLabel(a), bankName(a.institutionId), a.plaid ? "from bank" : "typed in"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {isLiability(a) ? `${money(Math.max(0, -balance))} owed` : money(balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-sm font-medium text-zinc-500">Bills, next 30 days</h3>
          {books.bills.length === 0 ? (
            <p className="text-sm text-zinc-500">No bills due in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {books.bills.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="tabular-nums text-zinc-500">{shortDate(l.date)}</span> {l.name}
                    {l.account && <span className="text-xs text-zinc-500"> · {l.account}</span>}
                    {l.predicted && <span className="text-xs text-amber-700 dark:text-amber-400"> · not confirmed yet</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-sm font-medium text-zinc-500">Logins</h3>
          {books.institutions.length === 0 ? (
            <p className="text-sm text-zinc-500">No companies yet. Add a bank above, or paste logins below.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {books.institutions.map((inst) => (
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
      </div>
    </section>
  );
}

function AddAccount({ data }: { data: MoneyData }) {
  const [scope, setScope] = useState<Scope>("personal");
  const [bank, setBank] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [last4, setLast4] = useState("");
  const [balance, setBalance] = useState("");
  const [message, setMessage] = useState("");
  const owed = ACCOUNT_TYPES.find((t) => t.value === type)?.liability ?? false;

  function add(e: FormEvent) {
    e.preventDefault();
    const amount = Number(balance.replace(/[$,\s]/g, "") || "0");
    const accountName = name.trim();
    if (!accountName || !Number.isFinite(amount)) return;
    const bankName = bank.trim();
    // Same bank name in the same company reuses its card; otherwise it's added.
    const known = data.institutions.find((i) => i.name.trim().toLowerCase() === bankName.toLowerCase() && scopeOf(i) === scope);
    const institutionId = known?.id ?? (bankName ? newId() : "");
    const institution: Institution | null =
      bankName && !known
        ? {
            id: institutionId,
            name: bankName,
            type: type === "credit" ? "Credit card" : type === "loan" ? "Lender" : "Bank",
            website: "",
            loginUrl: "",
            phone: "",
            memberNumber: "",
            notes: "",
            scope,
          }
        : null;
    setMoneyData((d) => ({
      ...d,
      institutions: institution ? [...d.institutions, institution] : d.institutions,
      accounts: [
        ...d.accounts,
        {
          id: newId(),
          name: accountName,
          type,
          openingBalance: amount,
          institutionId: institutionId || undefined,
          scope,
          last4: last4.replace(/\D/g, "").slice(-4) || undefined,
        },
      ],
    }));
    setName("");
    setLast4("");
    setBalance("");
    setMessage(`Added ${accountName}.`);
  }

  return (
    <Card title="Add an account">
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <ScopeField value={scope} onChange={setScope} />
        <Field label="Bank or company">
          <input className={inputClass} list="account-banks" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="M&T" />
        </Field>
        <Field label="Account name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Checking" />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Last 4 digits">
          <input className={inputClass} inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="5443" />
        </Field>
        <Field label={owed ? "What you owe" : "Balance now"}>
          <input className={inputClass} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button className={buttonClass} disabled={!name.trim()}>
            Add account
          </button>
          {message && <span className="text-sm text-zinc-600 dark:text-zinc-400">{message}</span>}
        </div>
      </form>
      <datalist id="account-banks">
        {data.institutions.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
    </Card>
  );
}
