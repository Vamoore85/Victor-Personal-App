"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { applyScan, detectRecurring, SCAN_RULES } from "./bill-intel";
import { addDays, money, today } from "./calc";
import { ago } from "./intel-shared";
import { CONFIDENCE_LABEL, ENTITIES, balances, type AccountLine, cadenceWord, entityLabel, total, transactionRows, upcoming, type Confidence, type EntityBalance, type TxnRow, type UpcomingLine } from "./outlook";
import { addAccountsToBank, connectBank, loadPlaidScript, syncAll, useSyncActivity, type LinkStep } from "./plaid";
import { freshness } from "./briefing";
import { getMoneyData, newId, setMoneyData } from "./store";
import type { Account, MoneyData, Scope } from "./types";
import { accountLabel, assignEntity } from "./accounts-fix";

/*
 * The Money overview: balances, then upcoming bills, then transactions, all
 * three entities together. Clicking an entity's balance narrows the lists
 * below to it; that's the only filter, and it's optional.
 */

let scannedFor = "";

/** Finds recurring bills again whenever the banks have synced since the last look. */
export function useBillScan(d: MoneyData | null) {
  const lastSync = d?.bankLinks.map((l) => l.lastSync ?? "").sort().at(-1) ?? "";
  const ranAt = d?.billScan?.rules === SCAN_RULES ? (d?.billScan?.ranAt ?? "") : "";
  const count = d?.transactions.length ?? 0;
  useEffect(() => {
    if (!count) return;
    const key = `${lastSync}|${count}`;
    if (scannedFor === key || (ranAt && ranAt >= lastSync && d?.billScan?.windowEnd === today())) return;
    scannedFor = key;
    setMoneyData((x) => {
      const { found, scan } = detectRecurring(x);
      return scan.scanned === 0 ? x : applyScan(x, found, scan, newId);
    });
  }, [lastSync, ranAt, count, d?.billScan?.windowEnd]);
}

const TONE: Record<Confidence, string> = {
  confirmed: "text-emerald-700 dark:text-emerald-400",
  high: "text-zinc-600 dark:text-zinc-300",
  medium: "text-amber-700 dark:text-amber-400",
  low: "text-amber-700 dark:text-amber-400",
};

const dayLabel = (ymd: string) => {
  const t = today();
  if (ymd === t) return "Today";
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function Overview({ data, onSettings }: { data: MoneyData; onSettings: () => void }) {
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState<Scope>("personal");
  const activity = useSyncActivity();
  useBillScan(data);

  // Personal first; one area at a time keeps names and amounts readable.
  const ORDER = ["personal", "business", "gladiator"];
  const bal = balances(data).sort((a, b) => ORDER.indexOf(a.entity) - ORDER.indexOf(b.entity));
  const lines = upcoming(data, 30);
  const f = freshness(data);
  const txns = transactionRows(data, query);
  const hasBankTxns = data.transactions.some((t) => t.plaidId);
  const unassignedAccts = data.accounts.filter((a) => a.needsEntity && !(a.plaid && data.bankLinks.find((l) => l.id === a.plaid!.linkId)?.duplicateOf));

  return (
    <div className="flex flex-col gap-5 lg:gap-6" data-testid="outlook">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium">Showing
          <select value={entity} onChange={(e) => setEntity(e.target.value as Scope)} className="min-h-11 min-w-52 rounded-xl border border-zinc-300 bg-surface px-4 text-base dark:border-zinc-700">
            {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </label>
        <Link href="/reports" className="rounded-xl bg-brand px-5 py-3 text-sm font-medium text-on-brand">Open reports</Link>
      </div>
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Money outlook</h2>
          <p className="text-xs text-zinc-500" data-testid="sync-line">
            {activity.syncing > 0
              ? "Syncing your banks…"
              : data.bankLinks.length === 0
                ? "No bank connected"
                : f.lastSync
                  ? `Banks synced ${ago(f.lastSync)}${f.freshness === "current" ? "" : f.freshness === "partial" ? " · older history still loading" : f.freshness === "failed" ? " · last sync failed" : " · not current"}`
                  : "Waiting for the first bank sync"}

          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transactions"
            aria-label="Search transactions"
            className="w-44 rounded-full border border-zinc-200 bg-surface px-4 py-1.5 text-sm sm:w-60 dark:border-zinc-800 focus:outline-none focus:ring-2 focus:ring-ember/40"
          />
          <button
            aria-label="Accounts and sync settings"
            title="Accounts and sync"
            onClick={onSettings}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* One banner, only when something is happening or wrong */}
      {(activity.problem || f.freshness === "failed") && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm" data-testid="sync-banner">
          <p className="min-w-0 flex-1">{activity.problem?.text ?? f.text}</p>
          <button className="text-sm font-medium underline" onClick={() => void syncAll()} disabled={activity.syncing > 0}>
            {activity.syncing > 0 ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}

      {unassignedAccts.length > 0 && <AssignTray accounts={unassignedAccts} />}

      {/* One selected area: balance, upcoming bills, then recent transactions. */}
      <div className="grid grid-cols-1 items-start gap-4">
        {bal.filter((b) => b.entity === entity).map((b) => (
          <EntityPanel
            key={b.entity}
            b={b}
            lines={lines.filter((l) => l.entity === b.entity)}
            txns={txns.filter((r) => r.entity === b.entity)}
            query={query}
            hasBankTxns={hasBankTxns}
            linked={data.bankLinks.length > 0}
          />
        ))}
      </div>
      {lines.some((l) => l.predicted) && <p className="text-xs text-zinc-500">Bills are predicted from your bank history unless marked Confirmed; amounts are the typical past amount.</p>}
    </div>
  );
}

/** One account or card: the bank's balance with its time, or exactly why there isn't one. */
const CHOICES: { id: Scope; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "business", label: "Maverick" },
  { id: "gladiator", label: "Gladiator" },
];

/** Accounts with no company yet, named one by one, with the company buttons right here. */
function AssignTray({ accounts }: { accounts: Account[] }) {
  return (
    <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950/40" data-testid="needs-assignment" aria-label="Assign accounts">
      <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
        Assign {accounts.length === 1 ? "this account" : `these ${accounts.length} accounts`} to a company
      </h3>
      <p className="text-sm text-amber-900/80 dark:text-amber-200/80">Until you pick one, {accounts.length === 1 ? "it isn't" : "they aren't"} counted in any company&apos;s totals.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`assign-${a.last4 ?? a.id}`}>
            <span className="text-base font-medium">
              {accountLabel(a)}
              {a.last4 && !accountLabel(a).includes(a.last4) && ` ··${a.last4}`}
              <span className="ml-2 text-sm font-normal text-zinc-500">{a.type === "credit" ? "card" : a.type}</span>
            </span>
            <span className="flex gap-2">
              {CHOICES.map((c) => (
                <button
                  key={c.id}
                  className="rounded-full border border-zinc-300 bg-surface px-4 py-1.5 text-sm font-medium hover:border-brand hover:text-brand dark:border-zinc-700"
                  onClick={() => setMoneyData((d) => assignEntity(d, a.id, c.id))}
                >
                  {c.label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AccountRow({ a, card, onConnect }: { a: AccountLine; card?: boolean; onConnect: () => void }) {
  const why =
    a.state === "waiting"
      ? `Waiting for the bank's balance${a.lastSync ? ` · last sync ${ago(a.lastSync)}` : ""} · refreshing`
      : a.state === "lost"
        ? `Bank connection missing · bank history through ${a.lastBankTxn ? dayLabel(a.lastBankTxn) : "earlier"} · no live balance`
        : a.state === "unlinked"
        ? a.twin
          ? `Not connected here; the same account number is connected under ${a.twin}`
          : "Not connected to a bank"
        : a.state === "bank-old"
          ? `Bank balance ${a.asOf ? ago(a.asOf) : ""}${a.lastSync ? "" : " · bank disconnected"}`
          : null;
  return (
    <li className="flex flex-col">
      <span className="flex justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate">
            {a.name}
            {a.last4 && ` ··${a.last4}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end tabular-nums">
          {a.amount === null ? (
            a.state === "unlinked" || a.state === "lost" ? (
              <button className="underline hover:text-zinc-900 dark:hover:text-zinc-100" onClick={onConnect}>
                {a.state === "lost" ? "Reconnect" : "Connect"}
              </button>
            ) : (
              <span>—</span>
            )
          ) : (
            <span className="text-zinc-700 dark:text-zinc-200">{card ? `${money(a.amount)} owed` : money(a.amount)}</span>
          )}
          {card && a.credit != null && <span className="text-sm text-zinc-400">{money(a.credit)} credit left</span>}
        </span>
      </span>
      {why && <span className="text-sm text-amber-700 dark:text-amber-400" data-testid="acct-why">{why}</span>}
    </li>
  );
}

function EntityPanel({
  b,
  lines,
  txns,
  query,
  hasBankTxns,
  linked,
}: {
  b: EntityBalance;
  lines: UpcomingLine[];
  txns: TxnRow[];
  query: string;
  hasBankTxns: boolean;
  linked: boolean;
}) {
  const [shown, setShown] = useState(5);
  const [allBills, setAllBills] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const due7 = total(lines, undefined, 7);
  const due30 = total(lines, undefined, 30);
  const in7 = lines.some((l) => l.date <= addDays(today(), 6));
  const [step, setStep] = useState<LinkStep | null>(null);
  const connecting = step !== null;
  const [connectError, setConnectError] = useState("");
  const [connectNote, setConnectNote] = useState("");
  // Bank history, but no live connection feeding any of this company's accounts.
  const all = [...b.accounts, ...b.cards];
  const missing = all.filter((a) => a.state === "lost" || a.state === "unlinked");
  const needsConnection = b.counted === 0 && missing.length > 0;
  // Load Plaid's window code ahead of time so the button opens it quickly.
  useEffect(() => {
    if (needsConnection) loadPlaidScript().catch(() => {});
  }, [needsConnection]);
  // The main button signs in fresh (any bank login); the existing connection is offered second,
  // because update mode can only ever reopen the login it was made with.
  async function reconnect(otherLogin = true) {
    if (connecting) return;
    setConnectError("");
    setConnectNote("");
    setStep("token");
    try {
      // First choice: tick the account in the bank connection you already have (no new connection, no copies).
      // Only for an account under a different bank login is a new connection made. Either way the
      // bank's account is matched to this record by its last 4 digits, so its history and company stay.
      const d = getMoneyData();
      const live = d?.bankLinks.find((l) => !l.duplicateOf && !l.errorCode);
      const target = missing.length === 1 ? missing[0].last4 : undefined;
      const r = live && !otherLogin ? await addAccountsToBank(live, setStep, target) : await connectBank(b.entity, setStep, target);
      if (r.status === "not-shared") setConnectNote(r.message ?? "");
    } catch (e) {
      setConnectError((e as Error).message || "Something went wrong opening your bank. Try again.");
    } finally {
      setStep(null);
    }
  }
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid={`panel-${b.entity}`} aria-label={entityLabel(b.entity)}>
      {/* Balance */}
      <div className="flex flex-col gap-1 p-4 sm:p-5">
        <h3 className="text-2xl font-bold tracking-tight">{entityLabel(b.entity)}</h3>
        <p className="text-3xl font-semibold tabular-nums tracking-tight" data-testid={`bal-${b.entity}`}>{b.counted ? money(b.available) : "—"}</p>
        <p className="text-xs text-zinc-500" data-testid={`bal-note-${b.entity}`}>
          {b.counted
            ? `Cash${b.asOf ? `, updated ${ago(b.asOf)}` : ""}${b.stale ? ` · ${b.stale} account${b.stale === 1 ? "" : "s"} without a balance` : ""}`
            : needsConnection
              ? "No live bank connection, so no current balance. Its history is kept."
              : b.accounts.length
                ? "Waiting for the bank's balance"
                : "No checking or savings account"}
        </p>
        {needsConnection && (
          <div className="mt-2 flex flex-col gap-1" data-testid={`reconnect-${b.entity}`}>
            <button className="self-start rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-on-brand disabled:opacity-60" onClick={() => void reconnect()} disabled={connecting}>
              {step === "token" ? "Getting a secure link…" : step === "script" ? "Loading Plaid…" : step === "starting" ? "Starting Plaid…" : step === "open" ? "Finish in the Plaid window" : step === "finishing" ? "Bringing the account in…" : connectError ? "Try again" : `Sign in to the bank login that has ${missing.length === 1 && missing[0].last4 ? `··${missing[0].last4}` : "this account"}`}
            </button>
            <p className="text-xs text-zinc-500">
              Pick your bank, sign in with that login, and tick {missing.length === 1 && missing[0].last4 ? `the account ending ${missing[0].last4}` : "it"}. If the bank signs you in to another company by itself, use a private window.{" "}
              <button className="underline hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => void reconnect(false)} disabled={connecting}>
                Or add it from the bank connection you already have
              </button>
            </p>
            {connectNote && (
              <p className="text-sm text-amber-700 dark:text-amber-400" role="status" data-testid={`reconnect-note-${b.entity}`}>
                {connectNote}
              </p>
            )}
            {connectError && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert" data-testid={`reconnect-error-${b.entity}`}>
                {connectError}
              </p>
            )}
          </div>
        )}
        {/* One account whose row would only repeat the figure (or the reconnect note) above is named once instead. */}
        {b.accounts.length === 1 && (needsConnection || b.accounts[0].state === "bank") ? (
          <p className="text-sm text-zinc-500" data-testid={`accts-${b.entity}`}>
            {b.accounts[0].name}
            {b.accounts[0].last4 && !b.accounts[0].name.includes(b.accounts[0].last4) && ` ··${b.accounts[0].last4}`}
          </p>
        ) : b.accounts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-500" data-testid={`accts-${b.entity}`}>
            {b.accounts.map((a, i) => (
              <AccountRow key={i} a={a} onConnect={() => void reconnect(true)} />
            ))}
          </ul>
        )}
        {b.cards.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-dashed border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800" data-testid={`cards-${b.entity}`}>
            {b.cards.map((c, i) => (
              <AccountRow key={i} a={c} card onConnect={() => void reconnect()} />
            ))}
            {b.cards.length > 1 && (
              <li className="flex justify-between gap-2 font-medium">
                <span>Cards and loans owed</span>
                <span className="tabular-nums">{money(b.owed)}</span>
              </li>
            )}
          </ul>
        )}
        <dl className="mt-3 grid grid-cols-1 gap-4 border-t border-zinc-100 pt-4 text-base sm:grid-cols-3 dark:border-zinc-800">
          <div>
            <dt className="text-zinc-500">Due 7 days</dt>
            <dd className="font-medium tabular-nums">{in7 ? money(due7) : <span className="font-normal text-zinc-500">None found</span>}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Due 30 days</dt>
            <dd className="font-medium tabular-nums">{lines.length ? money(due30) : <span className="font-normal text-zinc-500">None found</span>}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">After bills</dt>
            <dd className={`font-medium tabular-nums ${b.counted && b.available - due30 < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{b.counted ? money(b.available - due30) : <span className="font-normal text-zinc-500">Needs a live balance</span>}</dd>
          </div>
        </dl>
      </div>

      {/* Upcoming automatic bills */}
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <h4 className="px-4 pt-3 text-sm font-medium uppercase tracking-wider text-zinc-500 sm:px-5">Upcoming bills</h4>
        {lines.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-xs text-zinc-500 sm:px-5">
            {hasBankTxns ? "None expected in the next 30 days." : linked ? "Appear once bank transactions have synced." : "Connect a bank under Accounts."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 pb-1 dark:divide-zinc-800/70" data-testid={`up-${b.entity}`}>
            {(allBills ? lines : lines.slice(0, 5)).map((l) => (
              <UpcomingRow key={l.key} l={l} />
            ))}
          </ul>
        )}
      </div>

      {lines.length > 5 && <button className="px-5 py-3 text-left text-sm font-medium text-brand" onClick={() => setAllBills(!allBills)}>{allBills ? "Show fewer bills" : `View all ${lines.length} upcoming bills`}</button>}
      {/* Recent transactions */}
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <h4 className="px-4 pt-3 text-sm font-medium uppercase tracking-wider text-zinc-500 sm:px-5">{query ? "Matching transactions" : "Recent transactions"}</h4>
        {txns.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-xs text-zinc-500 sm:px-5">{query ? "Nothing matches." : "None yet."}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70" data-testid={`tx-${b.entity}`}>
            {txns.slice(0, shown).map((r) => {
              const isOpen = open === r.t.id;
              return (
                <li key={r.t.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 sm:px-5 dark:hover:bg-zinc-900/60" onClick={() => setOpen(isOpen ? null : r.t.id)} aria-expanded={isOpen}>
                    <span className="w-12 shrink-0 text-xs text-zinc-500 tabular-nums">{new Date(`${r.t.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-base">{r.t.description}</span>
                      <span className="block break-words text-sm text-zinc-500">{r.account}</span>
                    </span>
                    <span className={`shrink-0 text-sm tabular-nums ${r.signed > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                      {r.signed > 0 ? "+" : "−"}
                      {money(Math.abs(r.signed))}
                    </span>
                  </button>
                  {isOpen && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 bg-zinc-50 px-4 py-3 text-xs sm:px-5 dark:bg-zinc-900/60">
                      <Fact k="Date" v={r.t.date} />
                      <Fact k="Category" v={r.t.category || "—"} />
                      <Fact k="Account" v={r.account} />
                      <Fact k="Source" v={r.t.plaidId ? "Bank feed" : r.t.docId ? "Uploaded document" : "Statement or typed in"} />
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {txns.length > shown && (
          <button className="w-full border-t border-zinc-100 px-4 py-2.5 text-left text-xs text-zinc-500 hover:text-zinc-900 sm:px-5 dark:border-zinc-800 dark:hover:text-zinc-100" onClick={() => setShown((n) => n + 25)}>
            Show more ({(txns.length - shown).toLocaleString()} older)
          </button>
        )}
      </div>
    </section>
  );
}

function UpcomingRow({ l }: { l: UpcomingLine }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <span className="w-12 shrink-0 text-xs leading-tight text-zinc-500">{dayLabel(l.date)}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-base">{l.name}</span>
        <span className="block break-words text-sm text-zinc-500">
          {cadenceWord(l.cadence)}
          {l.account && ` · ${l.account}`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-sm tabular-nums">{money(l.amount)}</span>
        <span className={`text-sm ${TONE[l.confidence]}`}>{l.predicted ? `Predicted · ${CONFIDENCE_LABEL[l.confidence]}` : "Confirmed"}</span>
      </span>
    </li>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="truncate">{v}</dd>
    </div>
  );
}

export { ENTITIES };
