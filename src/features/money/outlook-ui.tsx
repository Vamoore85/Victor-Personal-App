"use client";

import { useEffect, useState } from "react";
import { applyScan, detectRecurring, SCAN_RULES } from "./bill-intel";
import { addDays, money, today } from "./calc";
import { ago } from "./intel-shared";
import { CONFIDENCE_LABEL, ENTITIES, balances, type AccountLine, cadenceWord, entityLabel, total, transactionRows, upcoming, type Confidence, type EntityBalance, type TxnRow, type UpcomingLine } from "./outlook";
import { connectBank, syncAll, useSyncActivity } from "./plaid";
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
  const unassigned = data.accounts.filter((a) => a.needsEntity && !(a.plaid && data.bankLinks.find((l) => l.id === a.plaid!.linkId)?.duplicateOf)).length;

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

      {unassigned > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm" data-testid="needs-assignment">
          <p className="min-w-0 flex-1">
            {unassigned} account{unassigned === 1 ? " has" : "s have"} no company yet, so {unassigned === 1 ? "it isn't" : "they aren't"} counted below.
          </p>
          <button className="rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-on-brand" onClick={onSettings}>
            Assign accounts
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

/** One account or card: the bank's balance with its time, or exactly why there isn't one. */
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
          {a.bankName && <span className="block truncate text-[11px] text-zinc-400">{a.bankName}</span>}
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
          {card && a.credit != null && <span className="text-[11px] text-zinc-400">{money(a.credit)} credit left</span>}
        </span>
      </span>
      {why && <span className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="acct-why">{why}</span>}
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
  const [shown, setShown] = useState(8);
  const [open, setOpen] = useState<string | null>(null);
  const due7 = total(lines, undefined, 7);
  const due30 = total(lines, undefined, 30);
  const in7 = lines.some((l) => l.date <= addDays(today(), 6));
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  // Bank history, but no live connection feeding any of this company's accounts.
  const all = [...b.accounts, ...b.cards];
  const missing = all.filter((a) => a.state === "lost" || a.state === "unlinked");
  const needsConnection = b.counted === 0 && missing.length > 0;
  const lost = all.some((a) => a.state === "lost");
  async function reconnect() {
    setConnectError("");
    setConnecting(true);
    try {
      await connectBank(b.entity);
    } catch (e) {
      setConnectError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid={`panel-${b.entity}`} aria-label={entityLabel(b.entity)}>
      {/* Balance */}
      <div className="flex flex-col gap-1 p-4 sm:p-5">
        <h3 className="text-sm font-medium text-zinc-500">{entityLabel(b.entity)}</h3>
        <p className="text-3xl font-semibold tabular-nums tracking-tight" data-testid={`bal-${b.entity}`}>{b.counted ? money(b.available) : "—"}</p>
        <p className="text-xs text-zinc-500" data-testid={`bal-note-${b.entity}`}>
          {b.counted
            ? `Cash available${b.asOf ? ` · bank balance ${ago(b.asOf)}` : ""}${b.stale ? ` · ${b.stale} account${b.stale === 1 ? "" : "s"} without a balance` : ""}`
            : needsConnection
              ? lost
                ? `${entityLabel(b.entity)} has bank history, but no live bank connection, so there is no current balance.`
                : `${entityLabel(b.entity)}'s accounts aren't connected to a bank, so there is no current balance.`
              : b.accounts.length
                ? "Waiting for the bank's balance"
                : "No checking or savings account"}
        </p>
        {needsConnection && (
          <div className="mt-2 flex flex-col gap-1" data-testid={`reconnect-${b.entity}`}>
            <button className="self-start rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-on-brand disabled:opacity-60" onClick={() => void reconnect()} disabled={connecting}>
              {connecting ? "Connecting…" : lost ? "Reconnect bank" : "Connect bank"}
            </button>
            {connectError && <p className="text-xs text-rose-600 dark:text-rose-400">{connectError}</p>}
          </div>
        )}
        {b.accounts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-500" data-testid={`accts-${b.entity}`}>
            {b.accounts.map((a, i) => (
              <AccountRow key={i} a={a} onConnect={() => void reconnect()} />
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
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
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
