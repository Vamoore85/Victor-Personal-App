"use client";

import { useState } from "react";
import { confirmFinding, setFindingStatus } from "./bill-intel";
import { BillDetail } from "./bill-intel-ui";
import { money, shortDate } from "./calc";
import { CONFIDENCE_LABEL, ENTITIES, STATUS_LABEL, cadenceWord, entityLabel, recurringRows, splitFinding, upcoming, total, type BillStatus, type RecurringRow } from "./outlook";
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

type Sort = "next" | "amount" | "name" | "entity";

const STATUS_TONE: Record<BillStatus, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  autopay: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const selectClass = "rounded-full border border-zinc-200 bg-surface px-3 py-1.5 text-sm dark:border-zinc-800";

export function RecurringBills({ data, categories }: { data: MoneyData; categories: string[] }) {
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState<Scope | "">("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [sort, setSort] = useState<Sort>("next");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  useBillScan(data);

  const all = recurringRows(data);
  const q = query.trim().toLowerCase();
  const rows = all
    .filter((r) => (!entity || r.entity === entity) && (!status || r.status === status) && (!q || `${r.name} ${r.accounts.join(" ")} ${entityLabel(r.entity)}`.toLowerCase().includes(q)))
    .sort((a, b) =>
      sort === "amount" ? b.nextAmount - a.nextAmount : sort === "name" ? a.name.localeCompare(b.name) : sort === "entity" ? entityLabel(a.entity).localeCompare(entityLabel(b.entity)) || a.name.localeCompare(b.name) : (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"),
    );
  const hidden = data.recurring.filter((f) => f.direction === "out" && f.status === "dismissed");
  const lines = upcoming(data, 30);
  const scan = data.billScan;
  const bankTxns = data.transactions.filter((t) => t.plaidId).length;

  return (
    <div className="flex flex-col gap-5" data-testid="recurring-bills">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">All recurring bills</h2>
          <p className="text-xs text-zinc-500" data-testid="scan-line">
            {scan
              ? `Found in ${scan.scanned.toLocaleString()} transactions (${scan.bankFeed.toLocaleString()} from your banks), ${longDate(scan.windowStart)} to ${longDate(scan.windowEnd)}`
              : bankTxns
                ? "Looking through your transactions…"
                : "No bank transactions yet, so no bills have been found."}
          </p>
        </div>
        <p className="flex gap-4 text-sm text-zinc-500 tabular-nums">
          <span>
            Next 7 days <span className="font-semibold text-zinc-900 dark:text-zinc-100">{money(total(lines, entity || undefined, 7))}</span>
          </span>
          <span>
            30 days <span className="font-semibold text-zinc-900 dark:text-zinc-100">{money(total(lines, entity || undefined, 30))}</span>
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search payee or account"
          aria-label="Search bills"
          className="w-full rounded-full border border-zinc-200 bg-surface px-4 py-1.5 text-sm sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1 dark:border-zinc-800"
        />
        <select aria-label="Entity" className={selectClass} value={entity} onChange={(e) => setEntity(e.target.value as Scope | "")}>
          <option value="">All entities</option>
          {ENTITIES.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <select aria-label="Status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as BillStatus | "")}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as BillStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select aria-label="Sort" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="next">Next date</option>
          <option value="amount">Amount</option>
          <option value="name">Payee</option>
          <option value="entity">Entity</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500" data-testid="bills-empty">
            {all.length
              ? "No bills match these filters."
              : bankTxns
                ? "No recurring withdrawals were found in your transactions yet. A bill shows up here after it has come out at least twice on a steady schedule."
                : "Bills are found in your bank transactions. Once a bank has synced, they appear here on their own."}
          </p>
        ) : (
          <>
            {/* Column headings on wide screens */}
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-zinc-100 px-4 py-2 text-[11px] uppercase tracking-wider text-zinc-500 lg:grid dark:border-zinc-800">
              <span>Payee</span>
              <span>Entity · account</span>
              <span>Last paid</span>
              <span>Expected next</span>
              <span className="w-28 text-right">Status</span>
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70" data-testid="bills-list">
              {rows.map((r) => (
                <BillRow key={r.finding.id} r={r} onOpen={() => setOpenId(r.finding.id)} />
              ))}
            </ul>
          </>
        )}
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

function BillRow({ r, onOpen }: { r: RecurringRow; onOpen: () => void }) {
  const f = r.finding;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-3">
      <button className="min-w-0 text-left" onClick={onOpen}>
        <span className="block truncate text-sm font-medium hover:underline">{r.name}</span>
        <span className="block text-xs text-zinc-500">
          {cadenceWord(r.cadence)} · seen {r.seen}× · {CONFIDENCE_LABEL[r.confidence]}
        </span>
      </button>
      <span className="min-w-0 truncate text-xs text-zinc-500 lg:text-sm">
        {entityLabel(r.entity)} · {r.accounts.join(", ") || "—"}
      </span>
      <span className="text-xs tabular-nums text-zinc-500 lg:text-sm">
        <span className="lg:hidden">Last </span>
        {shortDate(r.lastDate)} · {money(r.lastAmount)}
      </span>
      <span className="text-xs tabular-nums lg:text-sm">
        <span className="text-zinc-500 lg:hidden">Next </span>
        {r.nextDate ? `${shortDate(r.nextDate)} · ${money(r.nextAmount)}` : "Not predictable"}
      </span>
      <span className="flex flex-wrap items-center gap-2 lg:w-28 lg:flex-col lg:items-end lg:gap-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
        <span className="flex gap-2 text-xs text-zinc-500">
          {f.status !== "confirmed" && (
            <button className="underline hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setMoneyData((d) => confirmFinding(d, f.id, newId))}>
              Confirm
            </button>
          )}
          {f.accountIds.length > 1 && (
            <button className="underline hover:text-zinc-900 dark:hover:text-zinc-100" title="Two different bills under one payee? Split them by account." onClick={() => setMoneyData((d) => splitFinding(d, f.id, newId))}>
              Split
            </button>
          )}
          <button className="underline hover:text-rose-600" onClick={() => setMoneyData((d) => setFindingStatus(d, f.id, "dismissed"))}>
            Not a bill
          </button>
        </span>
      </span>
    </li>
  );
}
