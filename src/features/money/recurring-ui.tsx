"use client";

import { useState } from "react";
import { RecurringEmailBills } from "@/features/gmail/RecurringEmailBills";
import { confirmFinding, setFindingStatus } from "./bill-intel";
import { BillDetail } from "./bill-intel-ui";
import { addDays, money, today } from "./calc";
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
          <details className="mt-1 text-sm text-zinc-500">
          <summary className="cursor-pointer">Bill sources</summary>
          <p className="mt-1" data-testid="scan-line">
            {scan
              ? `Found in ${scan.scanned.toLocaleString()} transactions (${scan.bankFeed.toLocaleString()} from your banks), ${longDate(scan.windowStart)} to ${longDate(scan.windowEnd)}`
              : bankTxns
                ? "Looking through your transactions…"
                : "No bank transactions yet, so no bills have been found."}
          </p>
          </details>
        </div>
      </header>

      <BillCalendar data={data} onOpen={setOpenId} />

      <UpcomingColumns lines={lines} onOpen={setOpenId} />

      <RecurringEmailBills />

      <details className="group" data-testid="review-bills">
        <summary className="cursor-pointer list-none text-lg font-semibold tracking-tight">
          <span className="mr-1 inline-block transition group-open:rotate-90">›</span> Review and confirm bills
        </summary>
        <div className="mt-3 flex w-full flex-wrap gap-2">
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
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
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
      </details>

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

// Company colors on the bills page: Maverick blue, Personal green, Gladiator orange.
const HEAD: Record<string, string> = {
  business: "bg-blue-600 text-white",
  personal: "bg-green-600 text-white",
  gladiator: "bg-orange-500 text-white",
};

/** Next 30 days, one column per company: date, bill and amount, in the order they come out. */
function UpcomingColumns({ lines, onOpen }: { lines: UpcomingLine[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start" data-testid="next-30">
      {COLUMNS.map((e) => {
        const rows = lines.filter((l) => l.entity === e).sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
        const sum = rows.reduce((x, l) => x + l.amount, 0);
        return (
          <section key={e} className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid={`next30-${e}`}>
            <header className={`flex items-baseline justify-between gap-2 px-4 py-3 ${HEAD[e]}`}>
              <h3 className="text-2xl font-bold tracking-tight">{entityLabel(e)}</h3>
              <span className="text-right">
                <span className="block text-xs font-medium uppercase tracking-wide opacity-80">Next 30 days</span>
                <span className="text-xl font-semibold tabular-nums">{money(sum)}</span>
              </span>
            </header>
            {rows.length === 0 ? (
              <p className="px-4 py-4 text-base text-zinc-500">No bills in the next 30 days.</p>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-zinc-100 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    <th className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">Date</th>
                    <th className="border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">Bill</th>
                    <th className="border-b border-zinc-200 px-4 py-2 text-right dark:border-zinc-800">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => {
                    const d = new Date(`${l.date}T12:00:00`);
                    return (
                      <tr
                        key={l.key}
                        className={`${i % 2 ? "bg-zinc-50 dark:bg-zinc-900/40" : ""} ${l.findingId ? "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800" : ""}`}
                        onClick={() => l.findingId && onOpen(l.findingId)}
                      >
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-2.5 align-top dark:border-zinc-800">
                          <span className="block text-base font-semibold">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          <span className="block text-xs text-zinc-500">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                        </td>
                        <td className="border-b border-zinc-100 px-2 py-2.5 align-top dark:border-zinc-800">
                          <span className="block text-base font-medium">{l.name}</span>
                          {l.account && <span className="block text-xs text-zinc-500">{l.account}</span>}
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-2.5 text-right align-top text-lg font-semibold tabular-nums dark:border-zinc-800">{money(l.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-100 font-semibold dark:bg-zinc-900">
                    <td className="px-4 py-2.5" colSpan={2}>Total</td>
                    <td className="px-4 py-2.5 text-right text-lg tabular-nums">{money(sum)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

const WEEKS = 5;
const DOT: Record<string, string> = { business: "bg-blue-600", personal: "bg-green-600", gladiator: "bg-orange-500" };
const CHIP: Record<string, string> = {
  business: "bg-blue-50 text-blue-900 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-100",
  personal: "bg-green-50 text-green-900 hover:bg-green-100 dark:bg-green-950/50 dark:text-green-100",
  gladiator: "bg-orange-50 text-orange-900 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-100",
};

/** A rolling calendar from this week on: every bill on the day it comes out, colored by company. */
function BillCalendar({ data, onOpen }: { data: MoneyData; onOpen: (id: string) => void }) {
  const [offset, setOffset] = useState(0); // in weeks from this week
  const t = today();
  const weekStart = addDays(t, -new Date(`${t}T12:00:00`).getDay() + offset * 7);
  const end = addDays(weekStart, WEEKS * 7 - 1);
  const lines = upcoming(data, Math.max(1, Math.round((Date.parse(`${end}T12:00:00`) - Date.parse(`${t}T12:00:00`)) / 864e5) + 1));
  const byDay = new Map<string, UpcomingLine[]>();
  for (const l of lines) if (l.date >= weekStart && l.date <= end) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(weekStart, i));
  const label = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", o);
  const rangeTotal = [...byDay.values()].flat().reduce((sum, l) => sum + l.amount, 0);

  const chip = (l: UpcomingLine) => (
    <button
      key={l.key}
      onClick={() => l.findingId && onOpen(l.findingId)}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-tight ${CHIP[l.entity] ?? CHIP.gladiator}`}
      title={`${l.name} · ${money(l.amount)} · ${entityLabel(l.entity)}${l.account ? ` · ${l.account}` : ""}`}
    >
      <span className={`mt-1 size-2.5 shrink-0 self-start rounded-full ${DOT[l.entity] ?? DOT.gladiator}`} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words">{l.name}</span>
        <span className="block font-bold tabular-nums">{money(l.amount).replace(/\.00$/, "")}</span>
      </span>
    </button>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800" data-testid="bill-calendar">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800">
        <div>
          <h3 className="text-2xl font-bold tracking-tight">Bill calendar</h3>
          <p className="text-sm text-zinc-500">
            {label(weekStart, { month: "short", day: "numeric" })} to {label(end, { month: "short", day: "numeric" })} · <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">{money(rangeTotal)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-4 text-sm font-medium sm:flex">
            {(["business", "personal", "gladiator"] as const).map((e) => (
              <span key={e} className="flex items-center gap-1">
                <span className={`size-3 rounded-full ${DOT[e]}`} />
                {entityLabel(e)}
              </span>
            ))}
          </span>
          <div className="flex gap-1">
            <button className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" onClick={() => setOffset((o) => o - 4)} disabled={offset <= 0} aria-label="Earlier weeks">
              ‹
            </button>
            {offset > 0 && (
              <button className="rounded-full border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700" onClick={() => setOffset(0)}>
                Today
              </button>
            )}
            <button className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" onClick={() => setOffset((o) => o + 4)} disabled={offset >= 48} aria-label="Later weeks">
              ›
            </button>
          </div>
        </div>
      </header>

      {/* Desktop and tablet: a month-style grid, Sunday to Saturday. */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-sm">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const past = d < t;
            const isToday = d === t;
            const sum = items.reduce((x, l) => x + l.amount, 0);
            return (
              <div key={d} className={`min-h-32 border-b border-r border-zinc-100 p-2 dark:border-zinc-800 ${past ? "bg-zinc-50/60 text-zinc-400 dark:bg-zinc-900/40" : ""}`} data-testid={`cal-${d}`}>
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className={`text-sm font-semibold ${isToday ? "rounded-full bg-brand px-2 text-on-brand" : ""}`}>
                    {d.endsWith("-01") || d === days[0] ? label(d, { month: "short", day: "numeric" }) : Number(d.slice(8))}
                  </span>
                  {sum > 0 && <span className="text-sm font-bold tabular-nums">{money(sum).replace(/\.00$/, "")}</span>}
                </div>
                <div className="flex flex-col gap-1">{items.map(chip)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phone: one row per day that has a bill, grouped by week. */}
      <div className="md:hidden">
        {Array.from({ length: WEEKS }, (_, w) => {
          const week = days.slice(w * 7, w * 7 + 7);
          const withBills = week.filter((d) => byDay.has(d) && d >= t);
          return (
            <div key={w} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <p className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                Week of {label(week[0], { month: "short", day: "numeric" })}
              </p>
              {withBills.length === 0 ? (
                <p className="px-4 py-2 text-sm text-zinc-400">No bills</p>
              ) : (
                withBills.map((d) => (
                  <div key={d} className="flex gap-3 px-4 py-2">
                    <span className="w-12 shrink-0">
                      <span className="block text-base font-semibold">{label(d, { day: "numeric" })}</span>
                      <span className="block text-xs text-zinc-500">{label(d, { weekday: "short" })}</span>
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">{(byDay.get(d) ?? []).map(chip)}</div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
