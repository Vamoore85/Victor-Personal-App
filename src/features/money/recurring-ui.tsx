"use client";

import { useState } from "react";
import { confirmFinding, setFindingStatus } from "./bill-intel";
import { BillDetail } from "./bill-intel-ui";
import { money } from "./calc";
import { CONFIDENCE_LABEL, STATUS_LABEL, cadenceWord, entityLabel, recurringRows, splitFinding, upcoming, total, type BillStatus, type RecurringRow, type UpcomingLine } from "./outlook";
import { useBillScan } from "./outlook-ui";
import { newId, setMoneyData } from "./store";
import type { MoneyData, Scope } from "./types";

/*
 * Bills: every recurring withdrawal found in your real transactions, all
 * entities in one list. You can confirm one, correct it, split a payee that
 * covers two bills, or hide one that isn't a bill. Nothing here is invented:
 * each row has the transactions it was found in.
 */

const longDate = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const STATUS_TONE: Record<BillStatus, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  autopay: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const selectClass = "rounded-full border border-zinc-200 bg-surface px-3 py-1.5 text-sm dark:border-zinc-800";

// Fixed order, left to right (stacked in this order on a phone).
const COLUMNS: Scope[] = ["business", "personal", "gladiator"];

export function RecurringBills({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  useBillScan(data);

  const all = recurringRows(data);
  const q = query.trim().toLowerCase();
  const rows = all
    .filter((r) => (!status || r.status === status) && (!q || `${r.name} ${r.accounts.join(" ")} ${entityLabel(r.entity)}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || b.nextAmount - a.nextAmount);
  const hidden = data.recurring.filter((f) => f.direction === "out" && f.status === "dismissed");
  const lines = upcoming(data, 30);
  const scan = data.billScan;
  const bankTxns = data.transactions.filter((t) => t.plaidId).length;

  return (
    <div className="flex flex-col gap-5" data-testid="recurring-bills">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Recurring bills</h2>
          <p className="text-sm text-zinc-500" data-testid="scan-line">
            {scan
              ? `Found in ${scan.scanned.toLocaleString()} transactions (${scan.bankFeed.toLocaleString()} from your banks), ${longDate(scan.windowStart)} to ${longDate(scan.windowEnd)}`
              : bankTxns
                ? "Looking through your transactions…"
                : "No bank transactions yet, so no bills have been found."}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search payee or account"
            aria-label="Search bills"
            className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-surface px-4 py-2 text-sm sm:w-64 sm:flex-none dark:border-zinc-800"
          />
          <select aria-label="Status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as BillStatus | "")}>
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as BillStatus[]).map((st) => (
              <option key={st} value={st}>{STATUS_LABEL[st]}</option>
            ))}
          </select>
        </div>
      </header>

      <Next30 lines={lines} onOpen={setOpenId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        {COLUMNS.map((e) => (
          <BillColumn
            key={e}
            entity={e}
            rows={rows.filter((r) => r.entity === e)}
            next7={total(lines, e, 7)}
            next30={total(lines, e, 30)}
            empty={all.length ? (q || status ? "No bills match." : "No recurring bills found for this company yet.") : bankTxns ? "No recurring withdrawals found yet. A bill shows up after it has come out at least twice on a steady schedule." : "Bills appear here once a bank has synced."}
            onOpen={setOpenId}
          />
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="text-sm">
          <button className="text-zinc-500 underline" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide" : "Show"} {hidden.length} marked not a bill
          </button>
          {showHidden && (
            <ul className="mt-2 flex flex-col gap-1">
              {hidden.map((f) => (
                <li key={f.id} className="flex items-center gap-3 text-zinc-500">
                  <span className="min-w-0 flex-1 truncate">{f.overrides?.name ?? f.merchant}</span>
                  <button className="underline" onClick={() => setMoneyData((d) => setFindingStatus(d, f.id, "review"))}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openId && <BillDetail d={data} target={{ findingId: openId }} update={setMoneyData} categories={categories} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function BillColumn({ entity, rows, next7, next30, empty, onOpen }: { entity: Scope; rows: RecurringRow[]; next7: number; next30: number; empty: string; onOpen: (id: string) => void }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid={`bills-${entity}`}>
      <header className="border-b border-zinc-100 px-5 pb-4 pt-5 dark:border-zinc-800">
        <h3 className="text-2xl font-bold tracking-tight">{entityLabel(entity)}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-sm text-zinc-500">Next 7 days</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid={`sub7-${entity}`}>{money(next7)}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Next 30 days</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid={`sub30-${entity}`}>{money(next30)}</dd>
          </div>
        </dl>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {rows.map((r) => (
            <BillRow key={r.finding.id} r={r} onOpen={() => onOpen(r.finding.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

const md = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const wd = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });

function BillRow({ r, onOpen }: { r: RecurringRow; onOpen: () => void }) {
  const f = r.finding;
  const link = "underline hover:text-zinc-900 dark:hover:text-zinc-100";
  return (
    <li className="px-5 py-3.5">
      <button className="flex w-full items-start gap-3 text-left" onClick={onOpen}>
        <span className="w-14 shrink-0 tabular-nums">
          <span className="block whitespace-nowrap text-[15px] font-semibold">{r.nextDate ? md(r.nextDate) : "—"}</span>
          {r.nextDate && <span className="block text-xs text-zinc-500">{wd(r.nextDate)}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium hover:underline">{r.name}</span>
          <span className="block text-sm leading-snug text-zinc-500">{r.accounts.join(", ") || "—"}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-lg font-semibold tabular-nums">{money(r.nextAmount)}</span>
          <span className={`mt-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
        </span>
      </button>
      <div className="mt-1.5 flex items-baseline gap-3 pl-[4.25rem] text-xs text-zinc-500">
        <span className="min-w-0 flex-1 truncate">
          {cadenceWord(r.cadence)} · {CONFIDENCE_LABEL[r.confidence]}
        </span>
        {f.status !== "confirmed" && (
          <button className={link} onClick={() => setMoneyData((d) => confirmFinding(d, f.id, newId))}>
            Confirm
          </button>
        )}
        {f.accountIds.length > 1 && (
          <button className={link} title="Two different bills under one payee? Split them by account." onClick={() => setMoneyData((d) => splitFinding(d, f.id, newId))}>
            Split
          </button>
        )}
        <button className="whitespace-nowrap underline hover:text-rose-600" onClick={() => setMoneyData((d) => setFindingStatus(d, f.id, "dismissed"))}>
          Not a bill
        </button>
      </div>
    </li>
  );
}

const ENTITY_TONE: Record<string, string> = {
  business: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  personal: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  gladiator: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

/** Every bill due in the next 30 days, all companies, in the order they come out. */
function Next30({ lines, onOpen }: { lines: UpcomingLine[]; onOpen: (id: string) => void }) {
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const sum = sorted.reduce((s, l) => s + l.amount, 0);
  return (
    <section className="rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid="next-30">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800">
        <h3 className="text-2xl font-bold tracking-tight">Next 30 days</h3>
        <p className="text-base text-zinc-500">
          {sorted.length} bill{sorted.length === 1 ? "" : "s"} · <span className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">{money(sum)}</span>
        </p>
      </header>
      {sorted.length === 0 ? (
        <p className="px-4 py-4 text-base text-zinc-500 sm:px-5">No bills expected in the next 30 days.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sorted.map((l) => {
            const d = new Date(`${l.date}T12:00:00`);
            return (
              <li key={l.key}>
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 sm:gap-4 sm:px-5 dark:hover:bg-zinc-900"
                  onClick={() => l.findingId && onOpen(l.findingId)}
                  disabled={!l.findingId}
                >
                  <span className="w-14 shrink-0">
                    <span className="block text-base font-semibold">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span className="block text-xs text-zinc-500">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium">{l.name}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${ENTITY_TONE[l.entity] ?? ENTITY_TONE.gladiator}`}>{entityLabel(l.entity)}</span>
                      {l.account && <span className="truncate">{l.account}</span>}
                      {l.predicted && <span>expected</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-lg font-semibold tabular-nums">{money(l.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
