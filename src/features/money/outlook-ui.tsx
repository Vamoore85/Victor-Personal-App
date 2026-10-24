"use client";

import { useEffect, useState } from "react";
import { applyScan, detectRecurring } from "./bill-intel";
import { money, today } from "./calc";
import { ago } from "./intel-shared";
import { CONFIDENCE_LABEL, ENTITIES, balances, cadenceWord, entityLabel, total, transactionRows, upcoming, type Confidence, type UpcomingLine } from "./outlook";
import { syncAll, useSyncActivity } from "./plaid";
import { freshness } from "./briefing";
import { newId, setMoneyData } from "./store";
import type { MoneyData, Scope } from "./types";

/*
 * The Money overview: balances, then upcoming bills, then transactions, all
 * three entities together. Clicking an entity's balance narrows the lists
 * below to it; that's the only filter, and it's optional.
 */

let scannedFor = "";

/** Finds recurring bills again whenever the banks have synced since the last look. */
export function useBillScan(d: MoneyData | null) {
  const lastSync = d?.bankLinks.map((l) => l.lastSync ?? "").sort().at(-1) ?? "";
  const ranAt = d?.billScan?.ranAt ?? "";
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
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

export function Overview({ data, onSettings }: { data: MoneyData; onSettings: () => void }) {
  const [only, setOnly] = useState<Scope | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  const activity = useSyncActivity();
  useBillScan(data);

  const bal = balances(data);
  const lines = upcoming(data, 30);
  const f = freshness(data);
  const combined = bal.reduce((s, b) => s + b.available, 0);
  const anyBalance = bal.some((b) => b.counted > 0);
  const visibleLines = lines.filter((l) => !only || l.entity === only);
  const txns = transactionRows(data, query).filter((r) => !only || r.entity === only);
  const hasBankTxns = data.transactions.some((t) => t.plaidId);

  return (
    <div className="flex flex-col gap-6 lg:gap-8" data-testid="outlook">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
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

      {/* 1. Balances */}
      <section aria-labelledby="bal-h">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 id="bal-h" className="text-xs font-medium uppercase tracking-wider text-zinc-500">Balances</h3>
          <p className="text-sm text-zinc-500">
            All three <span className="ml-1 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100" data-testid="combined">{anyBalance ? money(combined) : "—"}</span>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {bal.map((b) => {
            const active = only === b.entity;
            const due30 = total(lines, b.entity, 30);
            return (
              <button
                key={b.entity}
                onClick={() => setOnly(active ? null : b.entity)}
                aria-pressed={active}
                data-testid={`bal-${b.entity}`}
                className={`flex flex-col gap-1 rounded-2xl border bg-surface p-4 text-left transition sm:p-5 ${
                  active ? "border-brand ring-1 ring-brand" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                }`}
              >
                <span className="text-sm text-zinc-500">{entityLabel(b.entity)}</span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{b.counted ? money(b.available) : "—"}</span>
                <span className="text-xs text-zinc-500">
                  {b.counted
                    ? `Available now${b.stale ? ` · ${b.stale} account${b.stale === 1 ? "" : "s"} not current` : ""}`
                    : b.stale
                      ? "No current bank balance"
                      : "No checking or savings account"}
                </span>
                {b.counted > 0 && (
                  <span className={`mt-1 text-xs tabular-nums ${b.available - due30 < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-500"}`}>
                    {money(b.available - due30)} after the next 30 days of bills
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Upcoming bills */}
      <section aria-labelledby="up-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="up-h" className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Upcoming bills{only && <span className="normal-case tracking-normal"> · {entityLabel(only)}</span>}
          </h3>
          <p className="flex gap-4 text-sm text-zinc-500 tabular-nums" data-testid="due-totals">
            <span>
              Next 7 days <span className="font-semibold text-zinc-900 dark:text-zinc-100">{money(total(visibleLines, undefined, 7))}</span>
            </span>
            <span>
              30 days <span className="font-semibold text-zinc-900 dark:text-zinc-100">{money(total(visibleLines, undefined, 30))}</span>
            </span>
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
          {visibleLines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500" data-testid="up-empty">
              {hasBankTxns
                ? "No recurring withdrawals expected in the next 30 days. Bills found in your transactions show up here with their expected date."
                : data.bankLinks.length
                  ? "Bills appear here once your bank transactions have synced."
                  : "Connect a bank under Accounts and your recurring bills appear here."}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70" data-testid="up-list">
              {visibleLines.map((l) => (
                <UpcomingRow key={l.key} l={l} />
              ))}
            </ul>
          )}
        </div>
        {visibleLines.some((l) => l.predicted) && (
          <p className="mt-2 text-xs text-zinc-500">Predicted from your bank history unless marked Confirmed. Expected amounts are typical past amounts.</p>
        )}
      </section>

      {/* 3. Transactions */}
      <section aria-labelledby="tx-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 id="tx-h" className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Transactions{only && <span className="normal-case tracking-normal"> · {entityLabel(only)}</span>}
          </h3>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(25);
            }}
            placeholder="Search"
            aria-label="Search transactions"
            className="w-full rounded-full border border-zinc-200 bg-surface px-4 py-1.5 text-sm sm:w-64 dark:border-zinc-800 focus:outline-none focus:ring-2 focus:ring-ember/40"
          />
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
          {txns.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">{query ? "Nothing matches that search." : "No transactions yet."}</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70" data-testid="tx-list">
              {txns.slice(0, shown).map((r) => {
                const isOpen = open === r.t.id;
                return (
                  <li key={r.t.id}>
                    <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60" onClick={() => setOpen(isOpen ? null : r.t.id)} aria-expanded={isOpen}>
                      <span className="w-14 shrink-0 text-xs text-zinc-500 tabular-nums">{new Date(`${r.t.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{r.t.description}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {entityLabel(r.entity)} · {r.account}
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm tabular-nums ${r.signed > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{r.signed > 0 ? "+" : "−"}{money(Math.abs(r.signed))}</span>
                    </button>
                    {isOpen && (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 bg-zinc-50 px-4 py-3 text-xs sm:grid-cols-4 dark:bg-zinc-900/60">
                        <Fact k="Date" v={r.t.date} />
                        <Fact k="Category" v={r.t.category || "—"} />
                        <Fact k="Account" v={`${r.account} (${entityLabel(r.entity)})`} />
                        <Fact k="Source" v={r.t.plaidId ? "Bank feed" : r.t.docId ? "Uploaded document" : "Statement or typed in"} />
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {txns.length > shown && (
          <button className="mt-3 text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setShown((n) => n + 50)}>
            Show more ({(txns.length - shown).toLocaleString()} older)
          </button>
        )}
      </section>
    </div>
  );
}

function UpcomingRow({ l }: { l: UpcomingLine }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="w-20 shrink-0 text-xs text-zinc-500 sm:w-24">{dayLabel(l.date)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{l.name}</span>
        <span className="block truncate text-xs text-zinc-500">
          {entityLabel(l.entity)}
          {l.account && ` · ${l.account}`} · {cadenceWord(l.cadence)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-sm tabular-nums">{money(l.amount)}</span>
        <span className={`text-[11px] ${TONE[l.confidence]}`}>{l.predicted ? `Predicted · ${CONFIDENCE_LABEL[l.confidence]}` : "Confirmed"}</span>
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
