"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createLocalStore } from "@/lib/local-store";
import { applyScan, BUCKETS, detectRecurring, type Bucket, type Coverage } from "./bill-intel";
import { buildSample } from "./bill-sample";
import { addDays, today } from "./calc";
import { getMoneyData, newId, setMoneyData } from "./store";
import { DEFAULT_SPEND_OPTIONS, type RangeId, type SpendOptions } from "./spend";
import type { MoneyData, RecurringFinding } from "./types";

/*
 * What Bills and Spending share: your data or the labeled sample, the owner
 * you're looking at, the remembered choices, and the controls (view, range,
 * owner, and one Filters sheet for everything else).
 */

export type Update = (fn: (d: MoneyData) => MoneyData) => void;
export type Mode = "real" | "sample";
export type OwnerView = Bucket | "all";

/* ---------------- Your data or the sample ---------------- */

type SampleState = { generatedOn: string; edited: boolean; data: MoneyData | null };
// v2: two years of made-up history (v1 had 120 days).
const sampleStore = createLocalStore<SampleState>("maverick.bills-sample.v2", { generatedOn: "", edited: false, data: null });
// v2: the first version treated old hand-made bill rows as real data.
const modeStore = createLocalStore<{ mode: Mode | null; withBank?: boolean }>("maverick.bills-mode.v2", { mode: null });

export function resetSample() {
  sampleStore.set(() => ({ generatedOn: today(), edited: false, data: buildSample() }));
}
const updateSample: Update = (fn) => sampleStore.set((s) => ({ generatedOn: s.generatedOn || today(), edited: true, data: fn(s.data ?? buildSample()) }));
const hasBankData = (d: MoneyData | null) => !!d?.transactions.some((t) => t.plaidId);
// Remembers whether bank data was already here when you picked, so a Sample chosen before your banks synced doesn't hide them.
export const setMode = (mode: Mode) => modeStore.set(() => ({ mode, withBank: hasBankData(getMoneyData()) }));

/**
 * Whether your real data is enough for these reports: bank or imported
 * history from the last 12 months, or bills you've confirmed from a scan.
 * Bills typed in by hand on their own don't count, so the sample opens first.
 */
export function realReadiness(d: MoneyData, t = today()) {
  const from = addDays(t, -365);
  const history = d.transactions.filter((x) => !x.transferId && x.date >= from && x.date <= t).length;
  const confirmed = d.recurring.filter((f) => f.status === "confirmed").length + d.bills.filter((b) => b.recurringId).length;
  // Any bank-feed transaction means your real data is here, however little has arrived yet.
  const bank = d.transactions.some((x) => x.plaidId);
  return { history, confirmed, ready: history >= 10 || confirmed > 0 || bank };
}

let autoScannedOn = "";

export function useWorkspace(data: MoneyData) {
  const sample = sampleStore.use();
  const saved = modeStore.use();
  const readiness = realReadiness(data);
  const pickedBeforeBank = saved?.mode === "sample" && !saved.withBank && hasBankData(data);
  const mode: Mode = (pickedBeforeBank ? null : saved?.mode) ?? (readiness.ready ? "real" : "sample");

  // Build the sample the first time it's shown, and refresh it each day until you edit it.
  useEffect(() => {
    if (mode === "sample" && sample && (!sample.data || (!sample.edited && sample.generatedOn !== today()))) resetSample();
  }, [mode, sample]);

  // Your data: rescan the full history once a day (and once after the scan grew
  // from 120 days to two years). Your decisions and edits are kept.
  const scan = data.billScan;
  useEffect(() => {
    const t = today();
    if (mode !== "real" || !readiness.ready || autoScannedOn === t) return;
    if (scan && scan.windowEnd === t && scan.windowStart <= addDays(t, -700)) return;
    autoScannedOn = t;
    setMoneyData((x) => {
      const { found, scan: s } = detectRecurring(x, t);
      return s.scanned === 0 ? x : applyScan(x, found, s, newId, t);
    });
  }, [mode, readiness.ready, scan]);

  const ws = mode === "sample" ? (sample?.data ?? null) : data;
  const update: Update = mode === "sample" ? updateSample : setMoneyData;
  return { mode, ws, update, readiness };
}

/* ---------------- Remembered choices ---------------- */

export type BillsView = "upcoming" | "recurring" | "ledger" | "accounts";
export type UpcomingRange = "day" | "week" | "month";
export type HistoryRange = "ytd" | "12m" | "120" | "all";
export type SpendView = "summary" | "categories" | "payees" | "transactions";
export type StatusFilter = "open" | RecurringFinding["status"] | "everything";

export type IntelPrefs = {
  entity: OwnerView | null; // null until you pick: follows the Financial Center's own switch
  bills: { view: BillsView; upcoming: UpcomingRange; history: HistoryRange; status: StatusFilter; income: boolean; accountId: string; category: string };
  spend: { view: SpendView; range: RangeId; custom: { start: string; end: string }; opts: SpendOptions };
};
const DEFAULT_PREFS: IntelPrefs = {
  entity: null,
  bills: { view: "upcoming", upcoming: "week", history: "ytd", status: "open", income: true, accountId: "", category: "" },
  spend: { view: "summary", range: "ytd", custom: { start: "", end: "" }, opts: DEFAULT_SPEND_OPTIONS },
};
export const DEFAULT_BILL_FILTERS = DEFAULT_PREFS.bills;
const prefsStore = createLocalStore<IntelPrefs>("maverick.intel-prefs.v1", DEFAULT_PREFS, (raw) => {
  const r = (raw ?? {}) as Partial<IntelPrefs>;
  return {
    entity: r.entity ?? null,
    bills: { ...DEFAULT_PREFS.bills, ...(r.bills ?? {}) },
    spend: { ...DEFAULT_PREFS.spend, ...(r.spend ?? {}), opts: { ...DEFAULT_SPEND_OPTIONS, ...(r.spend?.opts ?? {}) } },
  };
});
export const usePrefs = () => prefsStore.use() ?? DEFAULT_PREFS;
export const setPrefs = prefsStore.set;

/* ---------------- Small pieces ---------------- */

export const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export const fmtDate = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const seg = (on: boolean) =>
  `shrink-0 rounded-md px-3 py-1.5 text-sm ${on ? "bg-surface font-medium text-brand shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"}`;

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-zinc-200/60 p-1 [scrollbar-width:none] dark:bg-zinc-900">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={seg(value === o.id)} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tag({ children, tone }: { children: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
        tone === "good"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : tone === "warn"
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : tone === "bad"
              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
      }`}
    >
      {children}
    </span>
  );
}

/** Full-height sheet on phones, a centered panel on bigger screens. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[40rem] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
          <button className="h-8 w-8 shrink-0 rounded-full bg-zinc-100 text-lg leading-none dark:bg-zinc-800" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const selectClass = "min-w-0 rounded-lg border border-zinc-300 bg-surface px-2.5 py-1.5 text-sm dark:border-zinc-700";

export const ENTITY_OPTIONS: { id: OwnerView; label: string }[] = [...BUCKETS.map((b) => ({ id: b.id as OwnerView, label: b.label })), { id: "all", label: "All entities (side by side)" }];

export type Chip = { label: string; clear: () => void };

/**
 * The only controls on top: what to look at, when, and whose. Everything else
 * lives in one Filters sheet. Phones get the view tabs plus one summary row
 * that opens the sheet.
 */
export function ControlBar<V extends string, R extends string>({
  views,
  view,
  onView,
  ranges,
  range,
  onRange,
  entity,
  onEntity,
  chips,
  filters,
  filterTitle = "Filters",
}: {
  views: { id: V; label: ReactNode }[];
  view: V;
  onView: (v: V) => void;
  ranges: { id: R; label: string }[] | null;
  range: R;
  onRange: (r: R) => void;
  entity: OwnerView;
  onEntity: (e: OwnerView) => void;
  chips: Chip[];
  filters: ReactNode;
  filterTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const rangeLabel = ranges?.find((r) => r.id === range)?.label;
  const entityLabel = entity === "all" ? "All entities" : ENTITY_OPTIONS.find((e) => e.id === entity)!.label;
  const count = chips.length;
  const badge = count > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 text-[10px] text-on-brand">{count}</span>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 max-w-full">
          <Segmented label="View" value={view} onChange={onView} options={views} />
        </div>
        <div className="hidden items-center gap-2 md:ml-auto md:flex">
          {ranges && (
            <select aria-label="Time range" className={selectClass} value={range} onChange={(e) => onRange(e.target.value as R)}>
              {ranges.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Entity" className={selectClass} value={entity} onChange={(e) => onEntity(e.target.value as OwnerView)}>
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="inline-flex items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700" onClick={() => setOpen(true)}>
            Filters{badge}
          </button>
        </div>
      </div>
      {/* Phone: one summary row */}
      <button
        className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-left text-sm md:hidden dark:border-zinc-800"
        onClick={() => setOpen(true)}
        aria-label="Change range, entity and filters"
      >
        <span className="min-w-0 flex-1 truncate">
          {rangeLabel ? `${rangeLabel} · ` : ""}
          {entityLabel}
        </span>
        <span className="inline-flex shrink-0 items-center text-xs font-medium text-brand">Filters{badge}</span>
      </button>
      {count > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button key={c.label} onClick={c.clear} className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-200/70 px-2.5 py-0.5 text-xs dark:bg-zinc-800" aria-label={`Remove filter ${c.label}`}>
              <span className="truncate">{c.label}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <Sheet title={filterTitle} onClose={() => setOpen(false)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
            {ranges && (
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Time range
                <select aria-label="Time range" className={selectClass} value={range} onChange={(e) => onRange(e.target.value as R)}>
                  {ranges.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Entity
              <select aria-label="Entity" className={selectClass} value={entity} onChange={(e) => onEntity(e.target.value as OwnerView)}>
                {ENTITY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {filters}
          <button className="self-start rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-on-brand" onClick={() => setOpen(false)}>
            Done
          </button>
        </Sheet>
      )}
    </div>
  );
}

/** Your data / Sample, as a quiet setting inside Filters. */
export function DataSourceField({ mode }: { mode: Mode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <legend className="px-1 text-xs text-zinc-500">Data</legend>
      <label className="flex items-center gap-2">
        <input type="radio" name="data-source" checked={mode === "real"} onChange={() => setMode("real")} /> Your data
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="data-source" checked={mode === "sample"} onChange={() => setMode("sample")} /> Sample (made up, stays in this browser)
      </label>
      {mode === "sample" && (
        <button className="self-start text-xs underline" onClick={resetSample}>
          Reset the sample
        </button>
      )}
    </fieldset>
  );
}

/** A quiet line saying this is the sample, with the way back to your data. */
export function SampleBanner() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Sample data</span>
      <span className="min-w-0 flex-1">Made-up numbers, not your money.</span>
      <button className="font-medium underline" onClick={() => setMode("real")}>
        Use my data
      </button>
      <button className="underline" onClick={resetSample}>
        Reset
      </button>
    </div>
  );
}

/** Your data with nothing to report on yet. */
export function RealEmpty({ bills, goTo }: { bills: number; goTo?: (tab: "accounts" | "books") => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm dark:border-zinc-800" data-testid="real-empty">
      <span className="min-w-0 basis-full font-medium">No connected bank history or confirmed bills yet.</span>
      <span className="basis-full text-zinc-500">
        {bills > 0 ? `Your ${bills} hand-entered bill${bills === 1 ? " is" : "s are"} under Bill list. ` : ""}
        These reports need bank or statement history.
      </span>
      <button className="font-medium text-brand underline" onClick={() => setMode("sample")}>
        View sample
      </button>
      {goTo && (
        <button className="underline" onClick={() => goTo("accounts")}>
          Connect a bank
        </button>
      )}
      {goTo && (
        <button className="underline" onClick={() => goTo("books")}>
          Import statements
        </button>
      )}
    </div>
  );
}

/** What history is really here for this range, account by account. Never claims a full range it doesn't have. */
export function CoverageNote({ cover, start, end, label }: { cover: Coverage; start: string; end: string; label: string }) {
  const missing = cover.accounts.filter((a) => a.count === 0);
  return (
    <details className="text-xs text-zinc-500">
      <summary className="cursor-pointer select-none">
        {cover.first ? (
          <>
            {label}: history from {fmtDate(cover.first)} to {fmtDate(cover.last)} ({cover.count.toLocaleString()} transactions)
            {!cover.full && <span className="text-amber-700 dark:text-amber-400"> · starts after {fmtDate(start)}, so this isn&apos;t the full range</span>}
            {missing.length > 0 && <span> · {missing.length} account{missing.length === 1 ? "" : "s"} with none</span>}
          </>
        ) : (
          <>
            {label}: no transactions from {fmtDate(start)} to {fmtDate(end)}
          </>
        )}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {cover.accounts.map((a) => (
          <li key={a.account.id} className="flex flex-wrap justify-between gap-x-2">
            <span className="min-w-0 truncate">{a.account.name}</span>
            <span className="shrink-0 tabular-nums">
              {a.count
                ? `${fmtDate(a.first)} – ${fmtDate(a.last)} · ${a.bank ? `${a.bank} bank feed` : ""}${a.bank && a.statement ? ", " : ""}${a.statement ? `${a.statement} statement or typed` : ""}`
                : a.account.plaid
                  ? "Linked, no transactions in this range"
                  : "Not linked, nothing imported"}
            </span>
          </li>
        ))}
        {cover.accounts.length === 0 && <li>No accounts for this entity.</li>}
      </ul>
    </details>
  );
}
