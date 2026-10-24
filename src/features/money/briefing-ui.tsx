"use client";

import { useState, type ReactNode } from "react";
import { bucketLabel } from "./bill-intel";
import { BucketChip } from "./bucket-ui";
import { money, shortDate } from "./calc";
import { buildBriefing, briefingPlainText, saveBriefing, FRESHNESS_LABEL, type Briefing, type Freshness, type OwnerBriefing } from "./briefing";
import { Card, Empty, ghostButtonClass } from "./ui";
import { RealEmpty, SampleBanner, Tag, ago, useWorkspace } from "./intel-shared";
import type { MoneyData } from "./types";

/*
 * The Briefing tab: what Money opens to once a bank is connected. Built fresh
 * from the latest synced data each time; a copy is saved after every sync.
 */

const TONE: Record<Freshness, "good" | "warn" | "bad" | undefined> = { current: "good", partial: "warn", stale: "warn", failed: "bad", "no-bank": undefined };

export function BriefingView({ data, goTo }: { data: MoneyData; goTo: (tab: string) => void }) {
  const { mode, ws, update, readiness } = useWorkspace(data);
  const [copied, setCopied] = useState(false);
  if (!ws) return <Empty>Loading…</Empty>;
  const b = buildBriefing(ws);
  const text = briefingPlainText(b);

  function download() {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maverick-briefing-${b.date}${mode === "sample" ? "-SAMPLE" : ""}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function print() {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const pre = w.document.createElement("pre");
    pre.style.cssText = "font: 12px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; padding: 24px";
    pre.textContent = (mode === "sample" ? "SAMPLE DATA, NOT REAL FINANCES\n\n" : "") + text;
    w.document.title = `Maverick briefing ${b.date}`;
    w.document.body.appendChild(pre);
    w.print();
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4" data-testid="briefing">
      {mode === "sample" ? <SampleBanner /> : !readiness.ready && <RealEmpty bills={data.bills.length} goTo={goTo} />}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-zinc-200 bg-surface p-3 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Financial briefing</span>
            <Tag tone={TONE[b.freshness]}>{FRESHNESS_LABEL[b.freshness]}</Tag>
          </p>
          <p className="text-xs text-zinc-500" data-testid="briefing-status">
            {b.freshnessText}
            {b.lastSync && ` Last bank sync ${ago(b.lastSync)}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={ghostButtonClass}
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => setCopied(true));
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button className={ghostButtonClass} onClick={print}>Print</button>
          <button className={ghostButtonClass} onClick={download}>Download</button>
          {mode === "real" && data.bankLinks.length > 0 && (
            <button className={ghostButtonClass} onClick={() => goTo("accounts")}>Sync banks</button>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {b.owners.map((o) => (
          <OwnerCard key={o.bucket} o={o} goTo={goTo} />
        ))}
      </div>

      <History d={ws} b={b} onSave={() => update((x) => saveBriefing(x, "manual"))} />
      <p className="text-xs text-zinc-500">
        Made from your money data in the app, with bank-feed rows first. Only bills you&apos;ve confirmed count toward totals; predicted ones are marked. Nothing is emailed or sent anywhere.
      </p>
    </div>
  );
}

function OwnerCard({ o, goTo }: { o: OwnerBriefing; goTo: (tab: string) => void }) {
  const tone = o.month.alert === "short" ? "text-rose-600 dark:text-rose-400" : o.month.alert === "tight" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-surface p-3 sm:p-4 dark:border-zinc-800" data-testid={`owner-${o.bucket}`}>
      <div className="flex items-center justify-between gap-2">
        <BucketChip bucket={o.bucket} />
        <span className="text-xs text-zinc-500">{bucketLabel(o.bucket)}</span>
      </div>

      {o.flags.length > 0 && (
        <ul className="flex flex-col gap-1">
          {o.flags.map((f) => (
            <li
              key={f.text}
              className={`rounded-lg px-2.5 py-1.5 text-xs ${
                f.tone === "bad" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : f.tone === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {f.text}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Big label="Available now" value={o.available === null ? "No current balance" : money(o.available)} muted={o.available === null} />
        <Big label="After 30 days of bills" value={o.month.projected === null ? "—" : money(o.month.projected)} className={o.month.projected === null ? "" : tone} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Small label="Due today" value={money(o.today.outgoing)} />
        <Small label="This week" value={money(o.week.outgoing)} />
        <Small label="Next 30 days" value={money(o.month.outgoing)} />
      </div>

      <Block title="Next withdrawals" action={<button className="text-xs underline" onClick={() => goTo("bills")}>Bills</button>}>
        {o.next.length === 0 ? (
          <Empty>Nothing expected in the next 30 days.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {o.next.map((n, i) => (
              <li key={`${n.name}-${i}`} className="flex items-center gap-2">
                <span className="w-14 shrink-0 tabular-nums text-zinc-500">{shortDate(n.date)}</span>
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                {!n.confirmed && <Tag>Predicted</Tag>}
                <span className="shrink-0 tabular-nums">{money(n.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={`Spent this year: ${money(o.ytd.total)}`} action={<button className="text-xs underline" onClick={() => goTo("spending")}>Spending</button>}>
        <p className="mb-1.5 text-xs text-zinc-500">
          {o.ytd.cover.first ? `History ${o.ytd.cover.first} to ${o.ytd.cover.last}` : "No history this year"} · about {money(o.ytd.perMonth)} a month
        </p>
        <ul className="flex flex-col gap-1.5">
          {o.ytd.byMerchant.slice(0, 5).map((g) => (
            <li key={g.id}>
              <span className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="shrink-0 tabular-nums">{money(g.amount)}</span>
              </span>
              <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <span className="block h-full rounded-full bg-ember" style={{ width: `${Math.max(2, g.share * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </Block>

      {o.highlights.length > 0 && (
        <ul className="list-disc pl-4 text-sm text-zinc-700 dark:text-zinc-300">
          {o.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer select-none">Accounts and balances ({o.cash.length + o.cards.length})</summary>
        <ul className="mt-1.5 flex flex-col gap-1">
          {o.cash.map((c) => (
            <li key={c.account.id} className="flex flex-wrap justify-between gap-x-2">
              <span className="min-w-0 truncate">{c.account.name}</span>
              <span className="tabular-nums">
                {c.status === "live" ? `${money(c.balance ?? 0)} ${c.kind} · ${ago(c.asOf)}` : c.status === "unlinked" ? "Not linked · not counted" : c.status === "reconnect" ? "Reconnect needed · not counted" : `Not current (${ago(c.asOf)}) · not counted`}
              </span>
            </li>
          ))}
          {o.cards.map((c) => (
            <li key={c.name} className="flex flex-wrap justify-between gap-x-2">
              <span className="min-w-0 truncate">{c.name}</span>
              <span className="tabular-nums">{c.owed === null ? "No balance" : `${money(c.owed)} owed${c.asOf ? ` · ${ago(c.asOf)}` : ""}`}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function History({ d, b, onSave }: { d: MoneyData; b: Briefing; onSave: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Saved briefings" action={<button className="text-xs underline" onClick={onSave}>Save this one now</button>}>
      {d.briefings.length === 0 ? (
        <Empty>A copy is saved automatically after each bank sync. None yet.</Empty>
      ) : (
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {d.briefings.slice(0, 20).map((s) => (
            <li key={s.id} className="py-1.5">
              <button className="flex w-full flex-wrap items-center gap-x-2 text-left" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                <span className="tabular-nums">{new Date(s.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <Tag tone={TONE[s.freshness]}>{FRESHNESS_LABEL[s.freshness]}</Tag>
                <span className="text-xs text-zinc-500">{s.trigger === "first-sync" ? "after connecting" : s.trigger === "sync" ? "after sync" : "saved by you"}</span>
                <span className="ml-auto text-xs text-zinc-500">
                  {s.owners.map((o) => `${o.bucket === "pm" ? "P/M" : "Gladiator"} ${o.available === null ? "—" : money(o.available)}`).join(" · ")}
                </span>
              </button>
              {open === s.id && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{s.text}</pre>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-zinc-500">Saved copies are for looking back. The briefing above is always rebuilt from the latest data ({b.date}).</p>
    </Card>
  );
}

function Big({ label, value, muted, className = "" }: { label: string; value: string; muted?: boolean; className?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
      <p className="truncate text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`truncate font-semibold tabular-nums ${muted ? "text-sm text-zinc-400" : "text-xl"} ${className}`}>{value}</p>
    </div>
  );
}
function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 px-1.5 py-1.5 dark:border-zinc-800">
      <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="truncate text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}
