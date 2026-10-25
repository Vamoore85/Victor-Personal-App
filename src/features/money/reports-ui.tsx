"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCloudState, useMoneyData, reloadFromCloud } from "./store";
import { buildReport, reportCsv, reportText, type ReportPeriod } from "./reports";
import { ENTITIES } from "./outlook";
import { money, today } from "./calc";
import { Card, buttonClass, ghostButtonClass } from "./ui";
import type { Scope } from "./types";

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsPage() {
  const data = useMoneyData();
  const cloud = useCloudState();
  const [entity, setEntity] = useState<Scope>("personal");
  const [period, setPeriod] = useState<ReportPeriod>("ytd");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  // The day is part of the key, so a page left open past midnight moves to the new period. Read only once data has loaded in the browser.
  const day = data ? today() : "";
  const report = useMemo(() => data ? buildReport(data, entity, period, day) : null, [data, entity, period, day]);
  if (!report) return <p role="status">Loading your report…</p>;
  const base = `maverick-${entity}-${report.period.start}-${report.period.end}`;
  return <div className="report-page mx-auto flex max-w-5xl flex-col gap-6 text-base leading-relaxed">
    <div className="report-controls flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">Whose report
        <select className="min-h-11 rounded-xl border border-zinc-300 bg-surface px-4 text-base dark:border-zinc-700" value={entity} onChange={(e) => setEntity(e.target.value as Scope)}>
          {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">Period
        <select className="min-h-11 rounded-xl border border-zinc-300 bg-surface px-4 text-base dark:border-zinc-700" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
          <option value="ytd">Year to date</option><option value="12m">Trailing 12 months</option><option value="30d">Last 30 days</option>
        </select>
      </label>
      <button className={`${buttonClass} min-h-11`} disabled={refreshing || cloud === "loading"} onClick={async () => {
        setRefreshing(true); setNotice("");
        try { const ok = await reloadFromCloud(); setNotice(ok ? "Report refreshed from saved app data." : "Could not refresh. Showing the available local copy."); }
        finally { setRefreshing(false); }
      }}>{refreshing ? "Refreshing…" : "Refresh report"}</button>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {cloud !== "saved" && <p role="status" className="rounded-xl bg-amber-500/10 p-4 text-sm">{cloud === "loading" ? "Loading your saved data. This report may change." : cloud === "saving" ? "Changes are still saving." : "Online data is not confirmed. This report uses the copy available on this device."}</p>}
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <div><h2 className="text-2xl font-semibold">{report.label} financial report</h2><p className="mt-1 text-zinc-600 dark:text-zinc-400">{report.period.start} – {report.period.end}</p><p className="mt-1 text-sm text-zinc-500">Built from saved transactions. Refresh does not initiate a bank sync.</p></div>
      <div className="report-controls flex flex-wrap gap-2">
        <button className={`${ghostButtonClass} min-h-11`} onClick={() => download(reportText(report), `${base}.txt`, "text/plain;charset=utf-8")}>Download report</button>
        <details className="relative"><summary className={`${ghostButtonClass} min-h-11 cursor-pointer`}>Export options</summary><div className="absolute right-0 z-10 mt-2 flex w-56 flex-col gap-2 rounded-xl border border-zinc-200 bg-surface p-3 shadow-lg dark:border-zinc-700">
          <button className="p-2 text-left text-sm" onClick={() => download(reportCsv(report), `${base}-transactions.csv`, "text/csv;charset=utf-8")}>Transactions CSV</button>
          <button className="p-2 text-left text-sm" onClick={() => download(JSON.stringify(report, null, 2), `${base}.json`, "application/json;charset=utf-8")}>Structured report JSON</button>
          <button className="p-2 text-left text-sm" onClick={() => window.print()}>Print / Save PDF</button>
        </div></details>
      </div>
    </header>
    <div className="grid gap-4 sm:grid-cols-3">
      {[ ["Cash available now", report.available === null ? "Unavailable" : money(report.available)], ["Spent in this period", money(report.spent)], ["Confirmed bills · next 30 days", money(report.confirmedBills)] ].map(([label, value]) => <section key={label} className="rounded-2xl border border-zinc-200 bg-surface p-5 dark:border-zinc-800"><p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p><p className="mt-3 break-words text-2xl font-semibold tabular-nums">{value}</p></section>)}
    </div>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Balances as of {report.balanceAsOf ? new Date(report.balanceAsOf).toLocaleString() : "unavailable"}. Transfers are excluded from spending and income. Predicted bills total {money(report.predictedBills)} separately.</p>
    {report.warnings.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5"><h3 className="font-semibold">Needs attention</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul><Link href="/money?tab=accounts" className="report-controls mt-3 inline-block text-sm font-medium underline">Review bank connections</Link></section>}
    <div className="grid gap-5 md:grid-cols-2">
      <ReportList title="Where your money went" rows={report.merchants} />
      <ReportList title="Spending by category" rows={report.categories} />
    </div>
    <Card title="Coming out in the next 30 days">
      {!report.bills.length ? <p className="text-zinc-500">No upcoming bills found in the saved data.</p> : <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">{report.bills.map((b) => <li key={b.key} className="flex items-start justify-between gap-4 py-4"><div className="min-w-0"><p className="break-words font-medium">{b.name}</p><p className="text-sm text-zinc-500">{b.date} · {b.account || "No account assigned"} · {b.predicted ? "Predicted" : "Confirmed"}</p></div><span className="shrink-0 font-medium tabular-nums">{money(b.amount)}</span></li>)}</ul>}
    </Card>
    <details className="rounded-2xl border border-zinc-200 bg-surface p-5 dark:border-zinc-800"><summary className="cursor-pointer font-medium">Data coverage · {report.transactions.length} transactions</summary><p className="mt-3 text-sm text-zinc-500">These are observed transaction dates, not a guarantee of complete history. Downloads include the full selected period.</p><ul className="mt-3 space-y-3">{report.coverage.map((c, i) => <li key={`${c.account}-${i}`}><p className="font-medium">{c.account}</p><p className="text-sm text-zinc-500">{c.first ?? "No history"} – {c.last ?? "No history"} · {c.count} rows</p></li>)}</ul></details>
    <Link href="/money?tab=briefing" className="report-controls text-sm text-brand underline">Saved briefings and earlier snapshots</Link>
  </div>;
}

function ReportList({ title, rows }: { title: string; rows: { name: string; amount: number }[] }) {
  return <Card title={title}>{!rows.length ? <p className="text-zinc-500">No recorded spending in this period.</p> : <><ul className="divide-y divide-zinc-200 dark:divide-zinc-800">{rows.slice(0, 8).map((r) => <li key={r.name} className="flex items-start justify-between gap-4 py-3"><span className="min-w-0 break-words">{r.name}</span><span className="shrink-0 tabular-nums">{money(r.amount)}</span></li>)}</ul>{rows.length > 8 && <details className="mt-3"><summary className="cursor-pointer text-sm text-brand">Show all {rows.length}</summary><ul>{rows.slice(8).map((r) => <li key={r.name} className="flex items-start justify-between gap-4 py-3"><span className="min-w-0 break-words">{r.name}</span><span className="shrink-0 tabular-nums">{money(r.amount)}</span></li>)}</ul></details>}</>}</Card>;
}
