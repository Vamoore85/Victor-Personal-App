"use client";

import { useState, type ReactNode } from "react";
import {
  BUCKETS,
  CADENCES,
  RECENT_DAYS,
  SCAN_DAYS,
  applyScan,
  briefingText,
  bucketLabel,
  bucketOf,
  bucketReport,
  cadenceLabel,
  confirmFinding,
  coverage,
  detectRecurring,
  editFinding,
  effective,
  merchantKey,
  nextMonthRollup,
  reportWindow,
  scopeForBucket,
  setFindingStatus,
  yearStart,
  type Bucket,
  type BucketReport,
  type ReportKind,
  type ReportLine,
} from "./bill-intel";
import { BillLedger, markBillPaid } from "./bills";
import { AccountOwnerSelect, BucketChip } from "./bucket-ui";
import { BILL_FREQUENCIES, type BillFrequency, type MoneyData, type RecurringCadence, type RecurringFinding, type Scope } from "./types";
import { accountTypeLabel, addDays, frequencyLabel, money, shortDate, today } from "./calc";
import { newId } from "./store";
import { Card, Empty, Field, buttonClass, ghostButtonClass, inputClass } from "./ui";
import {
  ControlBar,
  CoverageNote,
  DEFAULT_BILL_FILTERS,
  DataSourceField,
  RealEmpty,
  SampleBanner,
  Sheet,
  Tag,
  ago,
  setPrefs,
  usePrefs,
  useWorkspace,
  type BillsView,
  type Chip,
  type HistoryRange,
  type OwnerView,
  type StatusFilter,
  type UpcomingRange,
  type Update,
} from "./intel-shared";

/*
 * The Bills tab: what's coming up (today and tomorrow, 7 or 30 days), the
 * recurring payments found in your history, your bill list, and which
 * accounts belong to which owner. Works on your real money data, or on a
 * clearly labeled sample workspace kept only in this browser.
 */

const VIEWS: { id: BillsView; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "recurring", label: "Recurring" },
  { id: "ledger", label: "Bill list" },
  { id: "accounts", label: "Accounts" },
];
const UPCOMING: { id: UpcomingRange; label: string }[] = [
  { id: "day", label: "Today and tomorrow" },
  { id: "week", label: "Next 7 days" },
  { id: "month", label: "Next 30 days" },
];
const HISTORY: { id: HistoryRange; label: string }[] = [
  { id: "ytd", label: "Year to date" },
  { id: "12m", label: "Last 12 months" },
  { id: "120", label: `Last ${RECENT_DAYS} days` },
  { id: "all", label: "All history scanned" },
];
const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "open", label: "All but dismissed" },
  { id: "review", label: "Needs review" },
  { id: "detected", label: "Detected" },
  { id: "confirmed", label: "Confirmed" },
  { id: "dismissed", label: "Dismissed" },
  { id: "everything", label: "Everything" },
];
const historyStart = (h: HistoryRange, t = today()) =>
  h === "ytd" ? yearStart(t) : h === "12m" ? addDays(t, -364) : h === "120" ? addDays(t, -(RECENT_DAYS - 1)) : addDays(t, -SCAN_DAYS);
const ukind: Record<UpcomingRange, ReportKind> = { day: "day", week: "week", month: "month" };

const dayLabel = (ymd: string) => {
  const t = today();
  if (ymd === t) return "Today";
  if (ymd === addDays(t, 1)) return "Tomorrow";
  if (ymd < t) return `Past due · ${shortDate(ymd)}`;
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/* ---------------- Entry ---------------- */

export function Bills({ data, categories, goTo, initialEntity }: { data: MoneyData; categories: string[]; goTo?: (tab: "accounts" | "books") => void; initialEntity?: OwnerView }) {
  const { mode, ws, update, readiness } = useWorkspace(data);
  const prefs = usePrefs();
  const f = prefs.bills;
  const owner: OwnerView = prefs.entity ?? initialEntity ?? "pm";
  const [open, setOpen] = useState<{ billId?: string; findingId?: string } | null>(null);
  const setBills = (patch: Partial<typeof f>) => setPrefs((p) => ({ ...p, bills: { ...p.bills, ...patch } }));

  if (!ws) return <Empty>Loading the sample workspace…</Empty>;

  const buckets: Bucket[] = owner === "all" ? ["pm", "gladiator"] : [owner];
  const review = ws.recurring.filter((x) => x.status === "review" && (owner === "all" || effective(x).bucket === owner)).length;
  const accountName = new Map(ws.accounts.map((a) => [a.id, a.name]));

  const chips: Chip[] = [];
  if (f.view === "recurring" && f.status !== "open") chips.push({ label: STATUS_OPTIONS.find((s) => s.id === f.status)!.label, clear: () => setBills({ status: "open" }) });
  if (f.view === "recurring" && !f.income) chips.push({ label: "Bills only (no money in)", clear: () => setBills({ income: true }) });
  if (f.accountId && f.view !== "accounts") chips.push({ label: `Account: ${accountName.get(f.accountId) ?? "?"}`, clear: () => setBills({ accountId: "" }) });
  if (f.category && f.view !== "accounts") chips.push({ label: `Category: ${f.category}`, clear: () => setBills({ category: "" }) });

  const ranges = f.view === "upcoming" ? UPCOMING : f.view === "recurring" ? HISTORY : null;
  const range = f.view === "upcoming" ? f.upcoming : f.history;
  // Account and category filters apply to bills and findings alike.
  const filtered: MoneyData = {
    ...ws,
    bills: ws.bills.filter((b) => (!f.accountId || b.accountId === f.accountId) && (!f.category || b.category === f.category)),
    recurring: ws.recurring.filter((x) => (!f.accountId || x.accountIds.includes(f.accountId)) && (!f.category || effective(x).category === f.category)),
  };
  const usedCategories = [...new Set([...ws.bills.map((b) => b.category), ...ws.recurring.map((x) => effective(x).category)])].filter(Boolean).sort();

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <ControlBar
        views={VIEWS.map((v) => (v.id === "recurring" && review > 0 ? { id: v.id, label: <>Recurring<span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{review}</span></> } : v))}
        view={f.view}
        onView={(view) => setBills({ view })}
        ranges={ranges as { id: string; label: string }[] | null}
        range={range}
        onRange={(r) => (f.view === "upcoming" ? setBills({ upcoming: r as UpcomingRange }) : setBills({ history: r as HistoryRange }))}
        entity={owner}
        onEntity={(entity) => setPrefs((p) => ({ ...p, entity }))}
        chips={chips}
        filterTitle="Bills filters"
        filters={
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Recurring: show">
                <select className={inputClass} value={f.status} onChange={(e) => setBills({ status: e.target.value as StatusFilter })}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Paid from account">
                <select className={inputClass} value={f.accountId} onChange={(e) => setBills({ accountId: e.target.value })}>
                  <option value="">Every account</option>
                  {ws.accounts.filter((a) => owner === "all" || bucketOf(a.scope) === owner).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select className={inputClass} value={f.category} onChange={(e) => setBills({ category: e.target.value })}>
                  <option value="">Every category</option>
                  {usedCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={f.income} onChange={(e) => setBills({ income: e.target.checked })} /> Show money coming in under Recurring
              </label>
            </div>
            <DataSourceField mode={mode} />
            <button className="self-start text-xs underline" onClick={() => setBills({ ...DEFAULT_BILL_FILTERS, view: f.view, upcoming: f.upcoming, history: f.history })}>
              Clear filters
            </button>
          </div>
        }
      />

      {mode === "sample" ? <SampleBanner /> : !readiness.ready && <RealEmpty bills={data.bills.length} goTo={goTo} />}

      {f.view === "upcoming" && <Briefing d={filtered} kind={ukind[f.upcoming]} buckets={buckets} onOpen={setOpen} onAccounts={() => setBills({ view: "accounts" })} />}
      {f.view === "recurring" && (
        <Recurring d={filtered} all={ws} owner={owner} buckets={buckets} history={f.history} status={f.status} income={f.income} update={update} sample={mode === "sample"} onOpen={setOpen} onStatus={(status) => setBills({ status })} />
      )}
      {f.view === "ledger" && (
        <BillLedger
          data={owner === "all" ? filtered : { ...filtered, bills: filtered.bills.filter((b) => bucketOf(b.scope) === owner) }}
          categories={categories}
          update={update}
          onOpen={(billId) => setOpen({ billId })}
          defaultScope={owner === "gladiator" ? "gladiator" : "personal"}
        />
      )}
      {f.view === "accounts" && <Accounts d={ws} buckets={buckets} update={update} sample={mode === "sample"} goTo={goTo} />}

      {open && <BillDetail d={ws} target={open} update={update} categories={categories} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------- Upcoming ---------------- */

function Briefing({ d, kind, buckets, onOpen, onAccounts }: { d: MoneyData; kind: ReportKind; buckets: Bucket[]; onOpen: (t: { billId?: string; findingId?: string }) => void; onAccounts: () => void }) {
  const [copied, setCopied] = useState(false);
  const t = today();
  const w = reportWindow(kind, t);
  const reports = buckets.map((b) => bucketReport(d, b, w.start, w.end, t));
  const both = reports.length > 1;
  const title = kind === "day" ? "Today and tomorrow" : `${shortDate(w.start)} – ${shortDate(w.end)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-3 ${both ? "lg:grid-cols-2" : ""}`}>
        {reports.map((r) => (
          <BucketBriefing key={r.bucket} r={r} kind={kind} title={title} d={d} onOpen={onOpen} onAccounts={onAccounts} wide={!both} />
        ))}
      </div>
      {both && (
        <p className="text-xs text-zinc-500">
          Both owners added together, on purpose: bills {money(reports.reduce((s, r) => s + r.outgoing, 0))}
          {reports.every((r) => r.available !== null) && <> · available {money(reports.reduce((s, r) => s + (r.available ?? 0), 0))}</>}
          . Each owner&apos;s money pays only its own bills.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span className="min-w-0 flex-1">
          Bills come from your bill list; predictions from the recurring scan. Balances only from banks synced in the last day. Money coming in counts only after you confirm it. In the app only; nothing is emailed or pushed.
        </span>
        <button
          className="shrink-0 underline"
          onClick={() => {
            void navigator.clipboard?.writeText(briefingText(kind, reports, money)).then(() => setCopied(true));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy as text"}
        </button>
      </div>
    </div>
  );
}

function BucketBriefing({
  r,
  kind,
  title,
  d,
  onOpen,
  onAccounts,
  wide,
}: {
  r: BucketReport;
  kind: ReportKind;
  title: string;
  d: MoneyData;
  onOpen: (t: { billId?: string; findingId?: string }) => void;
  onAccounts: () => void;
  wide: boolean;
}) {
  const byDate = new Map<string, ReportLine[]>();
  for (const l of r.lines) byDate.set(l.overdue ? "past" : l.date, [...(byDate.get(l.overdue ? "past" : l.date) ?? []), l]);
  const expectedIn = r.lines.filter((l) => l.status === "incoming-unconfirmed").reduce((s, l) => s + l.amount, 0);
  const rollup = kind === "month" ? nextMonthRollup(d, r.bucket) : null;
  const scheduled = r.lines.filter((l) => l.status === "scheduled").length;

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-surface p-3 sm:p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <BucketChip bucket={r.bucket} />
        <span className="text-xs text-zinc-500">{title}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure label="Available now" value={r.available === null ? "No live balance" : money(r.available)} muted={r.available === null} />
        <Figure label={`Bills (${scheduled})`} value={money(r.outgoing)} />
        <Figure
          label="After bills"
          value={r.projected === null ? "—" : money(r.projected)}
          tone={r.alert === "short" ? "bad" : r.alert === "tight" ? "warn" : r.projected !== null ? "good" : undefined}
        />
      </div>
      <NextDue r={r} onOpen={onOpen} />
      {r.incoming > 0 && <p className="text-xs text-zinc-500">Includes {money(r.incoming)} of confirmed money coming in.</p>}
      {r.alert === "short" && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          Bills of {money(r.outgoing)} are more than the {money((r.available ?? 0) + r.incoming)} {bucketLabel(r.bucket)} has to cover them.
        </p>
      )}
      {r.alert === "tight" && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Tight: only {money(r.projected ?? 0)} left after these bills.</p>
      )}
      {r.available === null && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
          No {bucketLabel(r.bucket)} spending account has a fresh bank balance, so there&apos;s no after-bills figure.{" "}
          <button className="underline" onClick={onAccounts}>See accounts</button>
        </p>
      )}

      <details className="text-xs text-zinc-500" open={wide && typeof window !== "undefined" && window.innerWidth >= 1024}>
        <summary className="cursor-pointer select-none">Where the money is ({r.cash.length} account{r.cash.length === 1 ? "" : "s"})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {r.cash.map((c) => (
            <li key={c.account.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.account.name}</span>
              <span className="shrink-0 tabular-nums">
                {c.status === "live" && `${money(c.balance ?? 0)} ${c.kind} · ${ago(c.asOf)}`}
                {c.status === "stale" && `Stale · synced ${ago(c.asOf)} · not counted`}
                {c.status === "reconnect" && "Reconnect needed · not counted"}
                {c.status === "unlinked" && "Not linked · not counted"}
              </span>
            </li>
          ))}
          {r.cash.length === 0 && <li>No checking or savings account assigned to {bucketLabel(r.bucket)}.</li>}
        </ul>
      </details>

      {r.lines.length === 0 ? (
        <Empty>Nothing due {kind === "day" ? "today or tomorrow" : "in this window"}.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {[...byDate].map(([date, lines]) => (
            <div key={date}>
              <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${date === "past" ? "text-rose-600" : "text-zinc-500"}`}>
                {date === "past" ? "Past due" : dayLabel(date)}
              </p>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((l, i) => (
                  <li key={`${l.billId ?? l.findingId}-${i}`} className={`flex items-center gap-2 py-1.5 ${l.status === "scheduled" ? "" : "opacity-70"}`}>
                    <button className="min-w-0 truncate text-left text-sm hover:underline" onClick={() => onOpen(l.billId ? { billId: l.billId } : { findingId: l.findingId })}>
                      {l.name}
                    </button>
                    {l.status === "possible" && <Tag>Not confirmed</Tag>}
                    {l.status === "incoming" && <Tag tone="good">Coming in</Tag>}
                    {l.status === "incoming-unconfirmed" && <Tag>Expected in · not counted</Tag>}
                    <span className={`ml-auto shrink-0 text-sm tabular-nums ${l.status.startsWith("incoming") ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                      {l.status.startsWith("incoming") ? "+" : ""}
                      {money(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {(r.possible > 0 || expectedIn > 0) && (
        <p className="text-xs text-zinc-500">
          Not counted until confirmed: {r.possible > 0 && `${money(r.possible)} of possible bills`}
          {r.possible > 0 && expectedIn > 0 && ", "}
          {expectedIn > 0 && `${money(expectedIn)} of expected income`}.
        </p>
      )}
      {rollup && (
        <p className="border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
          {rollup.label}: {money(rollup.outgoing)} across {rollup.count} bill{rollup.count === 1 ? "" : "s"}
          {rollup.incoming > 0 && `, ${money(rollup.incoming)} confirmed coming in`}.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, tone, muted }: { label: string; value: string; tone?: "good" | "bad" | "warn"; muted?: boolean }) {
  const color =
    tone === "bad" ? "text-rose-600 dark:text-rose-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 px-1.5 py-2 dark:bg-zinc-900">
      <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500 sm:text-[11px]">{label}</p>
      <p className={`truncate font-semibold tabular-nums ${muted ? "text-xs text-zinc-400" : "text-sm sm:text-base"} ${color}`}>{value}</p>
    </div>
  );
}


function NextDue({ r, onOpen }: { r: BucketReport; onOpen: (t: { billId?: string; findingId?: string }) => void }) {
  const next = r.lines.find((l) => l.status === "scheduled");
  if (!next) return null;
  return (
    <button
      className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:border-ember dark:border-zinc-800"
      onClick={() => onOpen(next.billId ? { billId: next.billId } : { findingId: next.findingId })}
    >
      <span className="shrink-0 text-xs uppercase tracking-wide text-zinc-500">Next due</span>
      <span className="min-w-0 flex-1 truncate font-medium">{next.name}</span>
      <span className="shrink-0 text-xs text-zinc-500">{next.overdue ? "Past due" : dayLabel(next.date)}</span>
      <span className="shrink-0 font-medium tabular-nums">{money(next.amount)}</span>
    </button>
  );
}


/* ---------------- Recurring (scan + review) ---------------- */

const STATUS_LABEL: Record<RecurringFinding["status"], string> = { review: "Needs review", detected: "Detected", confirmed: "Confirmed", dismissed: "Dismissed" };
const STATUS_TONE: Record<RecurringFinding["status"], "warn" | "good" | undefined> = { review: "warn", detected: undefined, confirmed: "good", dismissed: undefined };
const ORDER: Record<RecurringFinding["status"], number> = { review: 0, detected: 1, confirmed: 2, dismissed: 3 };

function Recurring({
  d,
  all,
  owner,
  buckets,
  history,
  status,
  income,
  update,
  sample,
  onOpen,
  onStatus,
}: {
  d: MoneyData;
  all: MoneyData;
  owner: OwnerView;
  buckets: Bucket[];
  history: HistoryRange;
  status: StatusFilter;
  income: boolean;
  update: Update;
  sample: boolean;
  onOpen: (t: { findingId: string }) => void;
  onStatus: (s: StatusFilter) => void;
}) {
  const [note, setNote] = useState("");
  const t = today();
  const start = historyStart(history, t);
  const mine = d.recurring.filter((x) => (owner === "all" || effective(x).bucket === owner) && (income || x.direction === "out"));
  const review = mine.filter((x) => x.status === "review").length;
  const list = mine
    .filter((x) => (status === "everything" ? true : status === "open" ? x.status !== "dismissed" : x.status === status))
    .filter((x) => x.lastDate >= start) // paid at least once in the range
    .map((x) => {
      const paid = x.occurrences.filter((o) => o.date >= start && o.date <= t);
      return { f: x, e: effective(x), paid: paid.reduce((s, o) => s + o.amount, 0), times: paid.length };
    })
    .sort((a, b) => ORDER[a.f.status] - ORDER[b.f.status] || b.paid - a.paid);
  const scan = all.billScan;
  const accountName = new Map(d.accounts.map((a) => [a.id, a.name]));
  const rangeLabel = HISTORY.find((h) => h.id === history)!.label;
  const totals = buckets.map((b) => ({ b, out: list.filter((x) => x.e.bucket === b && x.f.direction === "out").reduce((s, x) => s + x.paid, 0) }));

  function runScan() {
    const { found, scan: s } = detectRecurring(all);
    if (s.scanned === 0) {
      setNote(`No transactions dated ${s.windowStart} to ${s.windowEnd}, so there was nothing to scan. Connect a bank on Accounts or import statements under Company books.`);
      return;
    }
    update((x) => applyScan(x, found, s, newId));
    setNote(`Scanned ${s.scanned.toLocaleString()} transactions from ${s.windowStart} to ${s.windowEnd}: ${s.found} repeating payment${s.found === 1 ? "" : "s"} found.`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {totals.map(({ b, out }) => (
          <div key={b} className="min-w-0 rounded-xl border border-zinc-200 bg-surface p-3 dark:border-zinc-800">
            <p className="truncate text-[11px] uppercase tracking-wide text-zinc-500">{bucketLabel(b)} · {rangeLabel}</p>
            <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">{money(out)}</p>
            <p className="text-xs text-zinc-500">paid to recurring payees</p>
          </div>
        ))}
        {review > 0 && (
          <button className="min-w-0 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-left dark:bg-amber-950/30" onClick={() => onStatus("review")}>
            <p className="text-[11px] uppercase tracking-wide text-amber-800 dark:text-amber-300">Needs review</p>
            <p className="mt-0.5 text-lg font-semibold">{review}</p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80">Tap to see them</p>
          </button>
        )}
      </div>

      {buckets.map((b) => (
        <CoverageNote key={b} cover={coverage(all, b, start, t)} start={start} end={t} label={bucketLabel(b)} />
      ))}

      {list.length === 0 ? (
        <Empty>{status === "review" ? "Nothing waiting for review." : `No recurring payments paid in this range.`}</Empty>
      ) : (
        <Card>
          {/* Phone: compact rows */}
          <ul className="divide-y divide-zinc-200 lg:hidden dark:divide-zinc-800">
            {list.map(({ f, e, paid, times }) => (
              <li key={f.id} className="flex flex-col gap-1 py-2.5">
                <div className="flex items-center gap-2">
                  <button className="min-w-0 truncate text-left text-sm font-medium" onClick={() => onOpen({ findingId: f.id })}>
                    {e.name}
                  </button>
                  {f.status !== "detected" && <Tag tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Tag>}
                  {f.direction === "in" && <Tag tone="good">Income</Tag>}
                  <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">{money(e.amount)}</span>
                </div>
                <p className="truncate text-xs text-zinc-500">
                  {cadenceLabel(e.cadence)} · last {shortDate(f.lastDate)} · next {e.nextDate ? shortDate(e.nextDate) : "unknown"}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {money(paid)} paid {history === "ytd" ? "this year" : "in range"} ({times}×){owner === "all" && ` · ${bucketLabel(e.bucket)}`}
                </p>
                <FindingActions f={f} update={update} onOpen={() => onOpen({ findingId: f.id })} />
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <table className="hidden w-full text-left text-sm lg:table">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">Payee</th>
                <th className="py-2 pr-3 text-right font-medium">Typical</th>
                <th className="py-2 pr-3 font-medium">How often</th>
                <th className="py-2 pr-3 font-medium">Last paid</th>
                <th className="py-2 pr-3 font-medium">Next</th>
                <th className="py-2 pr-3 text-right font-medium">{history === "ytd" ? "Paid YTD" : "Paid in range"}</th>
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {list.map(({ f, e, paid, times }) => (
                <tr key={f.id} className="align-top">
                  <td className="py-2 pr-3">
                    <button className="font-medium hover:underline" onClick={() => onOpen({ findingId: f.id })}>
                      {e.name}
                    </button>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {owner === "all" && <BucketChip bucket={e.bucket} />}
                      <Tag tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Tag>
                      {f.direction === "in" && <Tag tone="good">Income</Tag>}
                      {e.edited && <Tag>Edited</Tag>}
                      <span className="text-[10px] uppercase tracking-wide text-zinc-400">{f.confidence} confidence</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {money(e.amount)}
                    {f.max - f.min >= 0.01 && <p className="text-xs text-zinc-500">{money(f.min)}–{money(f.max)}</p>}
                  </td>
                  <td className="py-2 pr-3">{cadenceLabel(e.cadence)}</td>
                  <td className="py-2 pr-3 tabular-nums">{shortDate(f.lastDate)}</td>
                  <td className="py-2 pr-3 tabular-nums">{e.nextDate ? shortDate(e.nextDate) : <span className="text-zinc-400">Unknown</span>}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {money(paid)}
                    <p className="text-xs text-zinc-500">{times}×</p>
                  </td>
                  <td className="max-w-[10rem] truncate py-2 pr-3 text-zinc-500">{f.accountIds.map((id) => accountName.get(id) ?? "Removed account").join(", ")}</td>
                  <td className="py-2">
                    <FindingActions f={f} update={update} onOpen={() => onOpen({ findingId: f.id })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span className="min-w-0 flex-1">
          {scan
            ? `Last scan ${ago(scan.ranAt)}: ${scan.windowStart} to ${scan.windowEnd}, ${scan.scanned.toLocaleString()} transactions (${scan.bankFeed.toLocaleString()} bank feed, ${scan.statement.toLocaleString()} statements or typed in), ${scan.found} found.`
            : "Not scanned yet. The scan reads up to two years of posted transactions already in Maverick: bank feed and imported statements."}
          {sample && " Sample transactions only."}
        </span>
        <button className="shrink-0 font-medium text-brand underline" onClick={runScan}>
          Scan again
        </button>
      </div>
      {note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{note}</p>}
    </div>
  );
}

function FindingActions({ f, update, onOpen }: { f: RecurringFinding; update: Update; onOpen: () => void }) {
  const small = "text-xs font-medium";
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(f.status === "review" || f.status === "detected") && (
        <>
          <button className={`${small} text-brand`} onClick={() => update((d) => confirmFinding(d, f.id, newId))}>
            {f.direction === "in" ? "Count it" : "Confirm"}
          </button>
          <button className={`${small} text-zinc-500`} onClick={() => update((d) => setFindingStatus(d, f.id, "dismissed"))}>
            Dismiss
          </button>
        </>
      )}
      {f.status === "dismissed" && (
        <button className={`${small} text-zinc-500`} onClick={() => update((d) => setFindingStatus(d, f.id, "review"))}>
          Restore
        </button>
      )}
      <button className={`${small} text-zinc-500`} onClick={onOpen}>
        Details
      </button>
    </div>
  );
}

/* ---------------- Detail ---------------- */

export function BillDetail({
  d,
  target,
  update,
  categories,
  onClose,
}: {
  d: MoneyData;
  target: { billId?: string; findingId?: string };
  update: Update;
  categories: string[];
  onClose: () => void;
}) {
  const bill = target.billId ? d.bills.find((b) => b.id === target.billId) : undefined;
  const finding = target.findingId ? d.recurring.find((f) => f.id === target.findingId) : bill?.recurringId ? d.recurring.find((f) => f.id === bill.recurringId) : undefined;
  const linkedBill = !bill && finding?.billId ? d.bills.find((b) => b.id === finding.billId) : bill;
  const e = finding ? effective(finding) : null;
  const accountName = new Map(d.accounts.map((a) => [a.id, a.name]));

  // History: the scan's evidence, or for a hand-added bill, matching transactions in the history scanned.
  const billKey = linkedBill ? merchantKey(linkedBill.name) : "";
  const from = addDays(today(), -SCAN_DAYS);
  const history = finding
    ? finding.occurrences
    : billKey
      ? d.transactions
          .filter((t) => t.kind === "expense" && t.date >= from && merchantKey(t.description) === billKey)
          .map((t) => ({ txnId: t.id, date: t.date, amount: t.amount, accountId: t.accountId, source: t.plaidId ? ("bank" as const) : ("statement" as const) }))
      : [];

  const editingBill = linkedBill;
  const init = editingBill
    ? { name: editingBill.name, amount: String(editingBill.amount), freq: editingBill.frequency as string, next: editingBill.nextDue, category: editingBill.category, scope: editingBill.scope ?? "personal" }
    : e
      ? { name: e.name, amount: String(e.amount), freq: e.cadence as string, next: e.nextDate ?? "", category: e.category, scope: e.scope }
      : null;
  const [form, setForm] = useState(init);

  if (!form || (!editingBill && !finding)) {
    return (
      <Sheet title="Not found" onClose={onClose}>
        <Empty>This item no longer exists.</Empty>
      </Sheet>
    );
  }

  function save() {
    if (!form) return;
    const amount = Number(form.amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) return;
    if (editingBill) {
      update((x) => ({
        ...x,
        bills: x.bills.map((b) =>
          b.id === editingBill.id
            ? {
                ...b,
                name: form.name.trim() || b.name,
                amount,
                frequency: form.freq as BillFrequency,
                nextDue: form.next || b.nextDue,
                dueDay: form.next ? Number(form.next.slice(8, 10)) : b.dueDay,
                category: form.category || b.category,
                scope: form.scope,
              }
            : b,
        ),
      }));
    } else if (finding) {
      update((x) =>
        editFinding(x, finding.id, {
          name: form.name.trim() !== finding.merchant ? form.name.trim() : undefined,
          amount: amount !== finding.typical ? amount : undefined,
          cadence: form.freq !== finding.cadence ? (form.freq as RecurringCadence) : undefined,
          nextDate: form.next && form.next !== finding.nextExpected ? form.next : undefined,
          category: form.category !== finding.category ? form.category : undefined,
          scope: form.scope !== finding.scope ? form.scope : undefined,
        }),
      );
    }
  }

  const status = editingBill ? (finding ? "Confirmed bill (from bank history)" : "Bill added by hand") : finding ? STATUS_LABEL[finding.status] : "";
  const set = (k: keyof NonNullable<typeof form>, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <Sheet title={form.name || "Bill"} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <BucketChip scope={form.scope as Scope} />
        <span>{status}</span>
        {finding?.direction === "in" && <Tag tone="good">Income</Tag>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Fact label="Amount">{editingBill ? money(editingBill.amount) : money(e!.amount)}{finding && finding.max - finding.min >= 0.01 && <span className="block text-xs text-zinc-500">seen {money(finding.min)}–{money(finding.max)}</span>}</Fact>
        <Fact label="How often">{editingBill ? frequencyLabel(editingBill) : cadenceLabel(e!.cadence)}</Fact>
        <Fact label="Next">{editingBill ? shortDate(editingBill.nextDue) : e!.nextDate ? `${shortDate(e!.nextDate)} (predicted)` : "Unknown"}</Fact>
        <Fact label="Last paid">{finding ? shortDate(finding.lastDate) : history.length ? shortDate(history[history.length - 1].date) : "No bank record"}</Fact>
        <Fact label="Usual day">
          {finding ? (finding.cadence === "weekly" || finding.cadence === "biweekly" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][finding.usualDay] : `Day ${finding.usualDay}`) : editingBill ? `Day ${editingBill.dueDay}` : "—"}
        </Fact>
        <Fact label="Confidence">{finding ? <span className="capitalize">{finding.confidence}</span> : "Set by you"}</Fact>
        <Fact label="Paid from">
          {(finding?.accountIds ?? [editingBill?.accountId ?? ""]).filter(Boolean).map((id) => accountName.get(id) ?? "Removed account").join(", ") || "No account"}
        </Fact>
      </dl>

      {finding && (
        <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">How this was worked out</p>
          <ul className="list-disc pl-4">
            {finding.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
            <li>Matched by payee name &quot;{finding.merchant}&quot; on {bucketLabel(bucketOf(finding.scope))} accounts, in up to two years of history.</li>
            {e?.edited && <li>Your edits override what was detected.</li>}
          </ul>
        </div>
      )}
      {editingBill?.note && <p className="text-xs text-zinc-500">{editingBill.note}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(ev) => set("name", ev.target.value)} />
          </Field>
        </div>
        <Field label="Amount">
          <input className={inputClass} inputMode="decimal" value={form.amount} onChange={(ev) => set("amount", ev.target.value)} />
        </Field>
        <Field label="How often">
          <select className={inputClass} value={form.freq} onChange={(ev) => set("freq", ev.target.value)}>
            {editingBill
              ? BILL_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)
              : CADENCES.map((c) => <option key={c} value={c}>{cadenceLabel(c)}</option>)}
          </select>
        </Field>
        <Field label="Next date">
          <input type="date" className={inputClass} value={form.next} onChange={(ev) => set("next", ev.target.value)} />
        </Field>
        <Field label="Category">
          <input className={inputClass} list="detail-categories" value={form.category} onChange={(ev) => set("category", ev.target.value)} />
        </Field>
        <datalist id="detail-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
        <Field label="Belongs to">
          <select className={inputClass} value={bucketOf(form.scope as Scope)} onChange={(ev) => set("scope", scopeForBucket(ev.target.value as Bucket, form.scope as Scope))}>
            {BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} onClick={save}>Save changes</button>
        {finding && !editingBill && (finding.status === "review" || finding.status === "detected") && (
          <button className={ghostButtonClass} onClick={() => { save(); update((x) => confirmFinding(x, finding.id, newId)); onClose(); }}>
            {finding.direction === "in" ? "Count as income" : "Confirm as bill"}
          </button>
        )}
        {finding && !editingBill && finding.status !== "dismissed" && (
          <button className={ghostButtonClass} onClick={() => { update((x) => setFindingStatus(x, finding.id, "dismissed")); onClose(); }}>Dismiss</button>
        )}
        {finding?.overrides && !editingBill && (
          <button className="px-2 text-sm text-zinc-500" onClick={() => { update((x) => ({ ...x, recurring: x.recurring.map((f) => (f.id === finding.id ? { ...f, overrides: undefined } : f)) })); onClose(); }}>
            Undo my edits
          </button>
        )}
        {editingBill && (
          <>
            <button className={ghostButtonClass} onClick={() => markBillPaid(editingBill, update)}>Mark paid</button>
            <button
              className="px-2 text-sm text-rose-600"
              onClick={() => {
                if (!confirm(`Delete ${editingBill.name}?`)) return;
                update((x) => ({
                  ...x,
                  bills: x.bills.filter((b) => b.id !== editingBill.id),
                  recurring: x.recurring.map((f) => (f.billId === editingBill.id ? { ...f, status: "review" as const, billId: undefined } : f)),
                }));
                onClose();
              }}
            >
              Delete bill
            </button>
          </>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Payment history ({history.length}) · paid this year {money(history.filter((o) => o.date >= yearStart(today())).reduce((s, o) => s + o.amount, 0))}
        </p>
        {history.length === 0 ? (
          <Empty>No matching bank or statement transactions in the history here.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {[...history].reverse().map((o) => (
              <li key={o.txnId} className="flex items-center gap-2 py-1.5">
                <span className="w-16 shrink-0 tabular-nums text-zinc-500">{shortDate(o.date)}</span>
                <span className="min-w-0 truncate text-xs text-zinc-500">
                  {accountName.get(o.accountId) ?? "Removed account"} · {o.source === "bank" ? "bank feed" : "statement"}
                </span>
                <span className="ml-auto shrink-0 tabular-nums">{money(o.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

/* ---------------- Accounts by owner ---------------- */

function Accounts({ d, buckets, update, sample, goTo }: { d: MoneyData; buckets: Bucket[]; update: Update; sample: boolean; goTo?: (tab: "accounts" | "books") => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Each account belongs to one owner; its balance and the bills paid from it count only there. Changing an owner here also moves the account in
        your books. Only checking, savings and cash count as money available, and only with a bank balance from the last 24 hours.
      </p>
      {buckets.map((b) => {
        const accts = d.accounts.filter((a) => bucketOf(a.scope) === b);
        return (
          <Card key={b} title={bucketLabel(b)}>
            {accts.length === 0 ? (
              <Empty>No accounts assigned to {bucketLabel(b)} yet.</Empty>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {accts.map((a) => {
                  const link = a.plaid ? d.bankLinks.find((l) => l.id === a.plaid!.linkId) : undefined;
                  const asOf = a.bankBalance?.asOf ?? link?.lastSync ?? null;
                  const fresh = !!asOf && Date.now() - new Date(asOf).getTime() <= 24 * 3600 * 1000;
                  const state = !a.plaid ? "Not linked" : !link || link.error ? "Reconnect needed" : fresh ? `Synced ${ago(asOf)}` : `Stale · synced ${ago(asOf)}`;
                  const bb = a.bankBalance;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {accountTypeLabel(a)}
                          {link && ` · ${link.institution}`} · {state}
                          {bb && ` · ${money(bb.available ?? bb.current ?? 0)} ${bb.available !== null ? "available" : "current"}`}
                        </p>
                      </div>
                      <AccountOwnerSelect
                        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                        value={a.scope ?? "personal"}
                        onChange={(s) => update((x) => ({ ...x, accounts: x.accounts.map((y) => (y.id === a.id ? { ...y, scope: s } : y)) }))}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
      {!sample && goTo && (
        <button className={`${ghostButtonClass} self-start`} onClick={() => goTo("accounts")}>
          Sync or reconnect banks
        </button>
      )}
    </div>
  );
}
