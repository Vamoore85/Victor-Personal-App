"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createLocalStore } from "@/lib/local-store";
import {
  BUCKETS,
  CADENCES,
  SCAN_DAYS,
  applyScan,
  briefingText,
  bucketLabel,
  bucketOf,
  bucketReport,
  cadenceLabel,
  confirmFinding,
  detectRecurring,
  editFinding,
  effective,
  merchantKey,
  nextMonthRollup,
  reportWindow,
  scopeForBucket,
  setFindingStatus,
  type Bucket,
  type BucketReport,
  type ReportKind,
  type ReportLine,
} from "./bill-intel";
import { buildSample } from "./bill-sample";
import { BillLedger, markBillPaid } from "./bills";
import { AccountOwnerSelect, BucketChip } from "./bucket-ui";
import { BILL_FREQUENCIES, type BillFrequency, type MoneyData, type RecurringCadence, type RecurringFinding, type Scope } from "./types";
import { accountTypeLabel, addDays, frequencyLabel, money, shortDate, today } from "./calc";
import { newId, setMoneyData } from "./store";
import { Card, Empty, Field, buttonClass, ghostButtonClass, inputClass } from "./ui";

/*
 * The Bills tab: briefings (Daily / Week / Month), the recurring-bill review
 * from a 120-day bank-history scan, the bill ledger, and which accounts belong
 * to which owner. Works on your real money data, or on a clearly labeled
 * sample workspace kept only in this browser.
 */

type Update = (fn: (d: MoneyData) => MoneyData) => void;
type Mode = "real" | "sample";
type OwnerView = Bucket | "all";
type View = "briefing" | "recurring" | "ledger" | "accounts";

type SampleState = { generatedOn: string; edited: boolean; data: MoneyData | null };
const sampleStore = createLocalStore<SampleState>("maverick.bills-sample.v1", { generatedOn: "", edited: false, data: null });
// v2: the first version saved nothing useful and treated old hand-made bill rows as real data.
const modeStore = createLocalStore<{ mode: Mode | null }>("maverick.bills-mode.v2", { mode: null });

/**
 * Whether your real data is enough for bill intelligence: bank or imported
 * history from the last 120 days, or bills you've confirmed from a scan.
 * Bills typed in by hand on their own don't count, so the sample opens first.
 */
export function realReadiness(d: MoneyData, t = today()) {
  const from = addDays(t, -SCAN_DAYS);
  const history = d.transactions.filter((x) => !x.transferId && x.date >= from && x.date <= t).length;
  const confirmed = d.recurring.filter((f) => f.status === "confirmed").length + d.bills.filter((b) => b.recurringId).length;
  return { history, confirmed, ready: history >= 10 || confirmed > 0 };
}

function resetSample() {
  sampleStore.set(() => ({ generatedOn: today(), edited: false, data: buildSample() }));
}
const updateSample: Update = (fn) =>
  sampleStore.set((s) => ({ generatedOn: s.generatedOn || today(), edited: true, data: fn(s.data ?? buildSample()) }));

const seg = (on: boolean) =>
  `shrink-0 rounded-md px-3 py-1.5 text-sm ${on ? "bg-surface font-medium text-brand shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"}`;

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
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

const dayLabel = (ymd: string) => {
  const t = today();
  if (ymd === t) return "Today";
  if (ymd === addDays(t, 1)) return "Tomorrow";
  if (ymd < t) return `Past due · ${shortDate(ymd)}`;
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/* ---------------- Entry ---------------- */

export function Bills({ data, categories, goTo }: { data: MoneyData; categories: string[]; goTo?: (tab: "accounts" | "books") => void }) {
  const sample = sampleStore.use();
  const saved = modeStore.use();
  const readiness = realReadiness(data);
  const mode: Mode = saved?.mode ?? (readiness.ready ? "real" : "sample");
  const [owner, setOwner] = useState<OwnerView>("pm");
  const [view, setView] = useState<View>("briefing");
  const [open, setOpen] = useState<{ billId?: string; findingId?: string } | null>(null);

  // Build the sample the first time it's shown, and refresh it each day until you edit it.
  useEffect(() => {
    if (mode === "sample" && sample && (!sample.data || (!sample.edited && sample.generatedOn !== today()))) resetSample();
  }, [mode, sample]);

  const ws = mode === "sample" ? sample?.data : data;
  const update: Update = mode === "sample" ? updateSample : setMoneyData;
  if (!ws) return <Empty>Loading the sample workspace…</Empty>;

  const review = ws.recurring.filter((f) => f.status === "review" && (owner === "all" || effective(f).bucket === owner)).length;
  const buckets: Bucket[] = owner === "all" ? ["pm", "gladiator"] : [owner];

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Data"
          value={mode}
          onChange={(m) => modeStore.set(() => ({ mode: m }))}
          options={[
            { id: "real", label: "Your data" },
            { id: "sample", label: "Sample" },
          ]}
        />
        <Segmented
          label="Owner"
          value={owner}
          onChange={setOwner}
          options={[
            { id: "pm", label: "Personal / Maverick" },
            { id: "gladiator", label: "Gladiator" },
            { id: "all", label: "All entities" },
          ]}
        />
      </div>

      {mode === "sample" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Sample data</span>
          <span className="order-last basis-full sm:order-none sm:min-w-0 sm:flex-1 sm:basis-0">Made-up accounts and bills to show how this works. Not your money. Edits stay in this browser only.</span>
          <button className="underline" onClick={resetSample}>Reset sample</button>
          <button className="font-medium underline" onClick={() => modeStore.set(() => ({ mode: "real" }))}>Use my data</button>
        </div>
      ) : (
        !readiness.ready && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm dark:border-zinc-800" data-testid="real-empty">
            <span className="min-w-0 basis-full font-medium sm:flex-1 sm:basis-0">No connected bank history or confirmed bills yet.</span>
            <span className="basis-full text-zinc-500">
              {data.bills.length > 0 ? `Your ${data.bills.length} hand-entered bill${data.bills.length === 1 ? " is" : "s are"} under Bills. ` : ""}
              Briefings and the 120-day scan need bank or statement history.
            </span>
            <button className="font-medium text-brand underline" onClick={() => modeStore.set(() => ({ mode: "sample" }))}>View sample</button>
            {goTo && <button className="underline" onClick={() => goTo("accounts")}>Connect a bank</button>}
            {goTo && <button className="underline" onClick={() => goTo("books")}>Import statements</button>}
          </div>
        )
      )}

      <Segmented
        label="Bills view"
        value={view}
        onChange={setView}
        options={[
          { id: "briefing", label: "Briefing" },
          { id: "recurring", label: <>Recurring{review > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{review}</span>}</> },
          { id: "ledger", label: "Bills" },
          { id: "accounts", label: "Accounts" },
        ]}
      />

      {view === "briefing" && <Briefing d={ws} buckets={buckets} onOpen={setOpen} onAccounts={() => setView("accounts")} />}
      {view === "recurring" && <Recurring d={ws} owner={owner} update={update} sample={mode === "sample"} onOpen={setOpen} />}
      {view === "ledger" && (
        <BillLedger
          data={owner === "all" ? ws : { ...ws, bills: ws.bills.filter((b) => bucketOf(b.scope) === owner) }}
          categories={categories}
          update={update}
          onOpen={(billId) => setOpen({ billId })}
          defaultScope={owner === "gladiator" ? "gladiator" : "personal"}
        />
      )}
      {view === "accounts" && <Accounts d={ws} buckets={buckets} update={update} sample={mode === "sample"} goTo={goTo} />}

      {open && <Detail d={ws} target={open} update={update} categories={categories} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------- Briefings ---------------- */

function Briefing({ d, buckets, onOpen, onAccounts }: { d: MoneyData; buckets: Bucket[]; onOpen: (t: { billId?: string; findingId?: string }) => void; onAccounts: () => void }) {
  const [kind, setKind] = useState<ReportKind>("day");
  const [copied, setCopied] = useState(false);
  const t = today();
  const w = reportWindow(kind, t);
  const reports = buckets.map((b) => bucketReport(d, b, w.start, w.end, t));
  const both = reports.length > 1;
  const title = kind === "day" ? "Today and tomorrow" : `${shortDate(w.start)} – ${shortDate(w.end)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label="Report"
          value={kind}
          onChange={setKind}
          options={[
            { id: "day", label: "Daily" },
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
          ]}
        />
        <button
          className={`${ghostButtonClass} shrink-0`}
          onClick={() => {
            void navigator.clipboard?.writeText(briefingText(kind, reports, money)).then(() => setCopied(true));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className={`grid gap-3 ${both ? "lg:grid-cols-2" : ""}`}>
        {reports.map((r) => (
          <BucketBriefing key={r.bucket} r={r} kind={kind} title={title} d={d} onOpen={onOpen} onAccounts={onAccounts} wide={!both} />
        ))}
      </div>
      {both && (
        <p className="text-xs text-zinc-500">
          All entities, added together on purpose: bills {money(reports.reduce((s, r) => s + r.outgoing, 0))}
          {reports.every((r) => r.available !== null) && <> · available {money(reports.reduce((s, r) => s + (r.available ?? 0), 0))}</>}
          . Each owner&apos;s money pays only its own bills.
        </p>
      )}
      <p className="text-xs text-zinc-500">
        Bills come from your bill list. Balances come only from banks synced in the last day. Money coming in is counted only after you confirm it as
        recurring. Shown in the app only; nothing is emailed or pushed.
      </p>
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

function Tag({ children, tone }: { children: ReactNode; tone?: "good" | "warn" }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
        tone === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : tone === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
      }`}
    >
      {children}
    </span>
  );
}

/* ---------------- Recurring (scan + review) ---------------- */

const STATUS_LABEL: Record<RecurringFinding["status"], string> = { review: "Needs review", detected: "Detected", confirmed: "Confirmed", dismissed: "Dismissed" };

function Recurring({ d, owner, update, sample, onOpen }: { d: MoneyData; owner: OwnerView; update: Update; sample: boolean; onOpen: (t: { findingId: string }) => void }) {
  const mine = d.recurring.filter((f) => owner === "all" || effective(f).bucket === owner);
  const counts = { review: 0, detected: 0, confirmed: 0, dismissed: 0 };
  for (const f of mine) counts[f.status]++;
  const [status, setStatus] = useState<RecurringFinding["status"]>(counts.review ? "review" : "detected");
  const [note, setNote] = useState("");
  const list = mine
    .filter((f) => f.status === status)
    .sort((a, b) => (effective(a).nextDate ?? "9").localeCompare(effective(b).nextDate ?? "9"));
  const scan = d.billScan;
  const accountName = new Map(d.accounts.map((a) => [a.id, a.name]));

  function runScan() {
    const { found, scan: s } = detectRecurring(d);
    if (s.scanned === 0) {
      setNote(`No transactions dated ${s.windowStart} to ${s.windowEnd}, so there was nothing to scan. Connect a bank on Accounts or import statements under Company books.`);
      return;
    }
    update((x) => applyScan(x, found, s, newId));
    setNote(`Scanned ${s.scanned} transactions from ${s.windowStart} to ${s.windowEnd}: ${s.found} repeating payment${s.found === 1 ? "" : "s"} found.`);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Look back {SCAN_DAYS} days</p>
            <p className="text-xs text-zinc-500">
              {scan
                ? `Last scan ${ago(scan.ranAt)}: ${scan.windowStart} to ${scan.windowEnd}, ${scan.scanned} transactions (${scan.bankFeed} from connected banks, ${scan.statement} from statements or typed in), ${scan.found} found.`
                : "Not scanned yet. The scan reads posted transactions already in Maverick: bank feed and imported statements."}
              {sample && " Sample transactions only."}
            </p>
          </div>
          <button className={buttonClass} onClick={runScan}>
            Scan {SCAN_DAYS} days
          </button>
        </div>
        {note && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{note}</p>}
      </Card>

      <Segmented
        label="Status"
        value={status}
        onChange={setStatus}
        options={(["review", "detected", "confirmed", "dismissed"] as const).map((s) => ({ id: s, label: `${STATUS_LABEL[s]} (${counts[s]})` }))}
      />

      {list.length === 0 ? (
        <Empty>{status === "review" ? "Nothing waiting for review." : `Nothing ${STATUS_LABEL[status].toLowerCase()}.`}</Empty>
      ) : (
        <Card>
          {/* Phone: compact rows */}
          <ul className="divide-y divide-zinc-200 lg:hidden dark:divide-zinc-800">
            {list.map((f) => {
              const e = effective(f);
              return (
                <li key={f.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-center gap-2">
                    <button className="min-w-0 truncate text-left text-sm font-medium" onClick={() => onOpen({ findingId: f.id })}>
                      {e.name}
                    </button>
                    <BucketChip bucket={e.bucket} />
                    {f.direction === "in" && <Tag tone="good">Income</Tag>}
                    <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">{money(e.amount)}</span>
                  </div>
                  <p className="truncate text-xs text-zinc-500">
                    Next {e.nextDate ? shortDate(e.nextDate) : "unknown"} · {cadenceLabel(e.cadence)} · {f.confidence} confidence · last {shortDate(f.lastDate)}
                  </p>
                  <FindingActions f={f} update={update} onOpen={() => onOpen({ findingId: f.id })} />
                </li>
              );
            })}
          </ul>
          {/* Desktop: review table */}
          <table className="hidden w-full text-left text-sm lg:table">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">Payee</th>
                <th className="py-2 pr-3 text-right font-medium">Typical</th>
                <th className="py-2 pr-3 font-medium">How often</th>
                <th className="py-2 pr-3 font-medium">Last paid</th>
                <th className="py-2 pr-3 font-medium">Next</th>
                <th className="py-2 pr-3 font-medium">Confidence</th>
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {list.map((f) => {
                const e = effective(f);
                return (
                  <tr key={f.id} className="align-top">
                    <td className="py-2 pr-3">
                      <button className="font-medium hover:underline" onClick={() => onOpen({ findingId: f.id })}>
                        {e.name}
                      </button>
                      <div className="mt-0.5 flex gap-1">
                        <BucketChip bucket={e.bucket} />
                        {f.direction === "in" && <Tag tone="good">Income</Tag>}
                        {e.edited && <Tag>Edited</Tag>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {money(e.amount)}
                      {f.max - f.min >= 0.01 && <p className="text-xs text-zinc-500">{money(f.min)}–{money(f.max)}</p>}
                    </td>
                    <td className="py-2 pr-3">{cadenceLabel(e.cadence)}</td>
                    <td className="py-2 pr-3 tabular-nums">{shortDate(f.lastDate)}</td>
                    <td className="py-2 pr-3 tabular-nums">{e.nextDate ? shortDate(e.nextDate) : <span className="text-zinc-400">Unknown</span>}</td>
                    <td className="py-2 pr-3 capitalize">{f.confidence}</td>
                    <td className="max-w-[10rem] truncate py-2 pr-3 text-zinc-500">{f.accountIds.map((id) => accountName.get(id) ?? "Removed account").join(", ")}</td>
                    <td className="py-2">
                      <FindingActions f={f} update={update} onOpen={() => onOpen({ findingId: f.id })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
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

function Detail({
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

  // History: the scan's evidence, or for a hand-added bill, matching transactions in the last 120 days.
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

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
            <li>Matched by payee name &quot;{finding.merchant}&quot; on {bucketLabel(bucketOf(finding.scope))} accounts in the last {SCAN_DAYS} days.</li>
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
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Payment history ({history.length})</p>
        {history.length === 0 ? (
          <Empty>No matching bank transactions in the last {SCAN_DAYS} days.</Empty>
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

/** Full-height sheet on phones, a centered panel on bigger screens. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

/* ---------------- Accounts by owner ---------------- */

function Accounts({ d, buckets, update, sample, goTo }: { d: MoneyData; buckets: Bucket[]; update: Update; sample: boolean; goTo?: (tab: "accounts") => void }) {
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
