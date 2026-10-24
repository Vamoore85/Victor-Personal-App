"use client";

import { useEffect, useState } from "react";
import { applyScan, detectRecurring } from "./bill-intel";
import { money, today } from "./calc";
import { ago } from "./intel-shared";
import { CONFIDENCE_LABEL, ENTITIES, balances, cadenceWord, entityLabel, total, transactionRows, upcoming, type Confidence, type EntityBalance, type TxnRow, type UpcomingLine } from "./outlook";
import { syncAll, useSyncActivity } from "./plaid";
import { freshness } from "./briefing";
import { newId, setMoneyData } from "./store";
import type { MoneyData } from "./types";

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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function Overview({ data, onSettings }: { data: MoneyData; onSettings: () => void }) {
  const [query, setQuery] = useState("");
  const activity = useSyncActivity();
  useBillScan(data);

  // Fixed order, left to right: Maverick | Personal | Gladiator.
  const ORDER = ["business", "personal", "gladiator"];
  const bal = balances(data).sort((a, b) => ORDER.indexOf(a.entity) - ORDER.indexOf(b.entity));
  const lines = upcoming(data, 30);
  const f = freshness(data);
  const combined = bal.reduce((s, b) => s + b.available, 0);
  const anyBalance = bal.some((b) => b.counted > 0);
  const txns = transactionRows(data, query);
  const hasBankTxns = data.transactions.some((t) => t.plaidId);

  return (
    <div className="flex flex-col gap-5 lg:gap-6" data-testid="outlook">
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
            {anyBalance && (
              <>
                {" · "}All three <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100" data-testid="combined">{money(combined)}</span>
              </>
            )}
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

      {/* Three permanent panels, the same order inside each: balance, upcoming bills, transactions */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3 lg:gap-5">
        {bal.map((b) => (
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
  const [shown, setShown] = useState(8);
  const [open, setOpen] = useState<string | null>(null);
  const due7 = total(lines, undefined, 7);
  const due30 = total(lines, undefined, 30);
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid={`panel-${b.entity}`} aria-label={entityLabel(b.entity)}>
      {/* Balance */}
      <div className="flex flex-col gap-1 p-4 sm:p-5">
        <h3 className="text-sm font-medium text-zinc-500">{entityLabel(b.entity)}</h3>
        <p className="text-3xl font-semibold tabular-nums tracking-tight" data-testid={`bal-${b.entity}`}>{b.counted ? money(b.available) : "—"}</p>
        <p className="text-xs text-zinc-500">
          {b.counted
            ? `Cash available now${b.stale ? ` · ${b.stale} account${b.stale === 1 ? "" : "s"} not current` : ""}`
            : b.stale
              ? "No current bank balance"
              : "No checking or savings account"}
        </p>
        {b.accounts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-zinc-500" data-testid={`accts-${b.entity}`}>
            {b.accounts.map((a, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">
                  {a.name}
                  {a.last4 && ` ··${a.last4}`}
                </span>
                <span className="shrink-0 tabular-nums">{a.amount === null ? "not current" : money(a.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {b.cards.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 border-t border-dashed border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800" data-testid={`cards-${b.entity}`}>
            {b.cards.map((c, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">
                  {c.name}
                  {c.last4 && ` ··${c.last4}`}
                </span>
                <span className="flex shrink-0 flex-col items-end tabular-nums">
                  <span>{c.owed === null ? "not current" : `${money(c.owed)} owed`}</span>
                  {c.credit !== null && <span className="text-[11px] text-zinc-400">{money(c.credit)} credit left</span>}
                </span>
              </li>
            ))}
            {b.cards.length > 1 && (
              <li className="flex justify-between gap-2 font-medium">
                <span>Cards and loans owed</span>
                <span className="tabular-nums">{money(b.owed)}</span>
              </li>
            )}
          </ul>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
          <div>
            <dt className="text-zinc-500">Due 7 days</dt>
            <dd className="font-medium tabular-nums">{money(due7)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Due 30 days</dt>
            <dd className="font-medium tabular-nums">{money(due30)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">After bills</dt>
            <dd className={`font-medium tabular-nums ${b.counted && b.available - due30 < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{b.counted ? money(b.available - due30) : "—"}</dd>
          </div>
        </dl>
      </div>

      {/* Upcoming automatic bills */}
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <h4 className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500 sm:px-5">Upcoming bills</h4>
        {lines.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-xs text-zinc-500 sm:px-5">
            {hasBankTxns ? "None expected in the next 30 days." : linked ? "Appear once bank transactions have synced." : "Connect a bank under Accounts."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 pb-1 dark:divide-zinc-800/70" data-testid={`up-${b.entity}`}>
            {lines.map((l) => (
              <UpcomingRow key={l.key} l={l} />
            ))}
          </ul>
        )}
      </div>

      {/* Recent transactions */}
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <h4 className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500 sm:px-5">{query ? "Matching transactions" : "Recent transactions"}</h4>
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
                      <span className="block truncate text-sm">{r.t.description}</span>
                      <span className="block truncate text-xs text-zinc-500">{r.account}</span>
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
        <span className="block truncate text-sm">{l.name}</span>
        <span className="block truncate text-xs text-zinc-500">
          {cadenceWord(l.cadence)}
          {l.account && ` · ${l.account}`}
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
