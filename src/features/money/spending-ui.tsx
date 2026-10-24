"use client";

import { useState, type ReactNode } from "react";
import { bucketLabel, cadenceLabel, effective, type Bucket } from "./bill-intel";
import { BUSINESS_CATEGORY_NAMES, learnCategory } from "./books";
import { BucketChip } from "./bucket-ui";
import { money, shortDate } from "./calc";
import { newId } from "./store";
import { DEFAULT_CATEGORIES, type MoneyData } from "./types";
import { Card, Empty, Field, inputClass } from "./ui";
import {
  ControlBar,
  CoverageNote,
  DataSourceField,
  RealEmpty,
  SampleBanner,
  Sheet,
  Tag,
  fmtDate,
  setPrefs,
  usePrefs,
  useWorkspace,
  type Chip,
  type OwnerView,
  type SpendView,
  type Update,
} from "./intel-shared";
import { DEFAULT_SPEND_OPTIONS, LEFT_LABEL, RANGES, spendCsv, spendReport, type Group, type RangeId, type SpendOptions, type SpendReport, type SpendRow } from "./spend";

/*
 * The Spending tab: "what did I spend, and where?" Year to date by default,
 * one owner at a time (or both side by side), with every total one tap away
 * from the transactions behind it.
 */

const VIEWS: { id: SpendView; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "categories", label: "Categories" },
  { id: "payees", label: "Payees" },
  { id: "transactions", label: "Transactions" },
];

type Drill = { title: string; rows: SpendRow[]; group?: Group };

const md = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

export function Spending({ data, goTo, initialEntity }: { data: MoneyData; goTo?: (tab: "accounts" | "books") => void; initialEntity?: OwnerView }) {
  const { mode, ws, update, readiness } = useWorkspace(data);
  const prefs = usePrefs();
  const p = prefs.spend;
  const o = p.opts;
  const owner: OwnerView = prefs.entity ?? initialEntity ?? "all";
  const [drill, setDrill] = useState<Drill | null>(null);
  const setSpend = (patch: Partial<typeof p>) => setPrefs((x) => ({ ...x, spend: { ...x.spend, ...patch } }));
  const setOpt = (patch: Partial<SpendOptions>) => setPrefs((x) => ({ ...x, spend: { ...x.spend, opts: { ...x.spend.opts, ...patch } } }));

  if (!ws) return <Empty>Loading the sample workspace…</Empty>;

  // All entities is one combined report; each row still says whose it is.
  const reports = [spendReport(ws, owner, p.range, o, undefined, p.custom)];
  const accounts = ws.accounts.filter((a) => owner === "all" || (owner === "gladiator" ? a.scope === "gladiator" : a.scope !== "gladiator"));
  const accountName = (id: string) => ws.accounts.find((a) => a.id === id)?.name ?? "Removed account";
  const categories = [...new Set(reports.flatMap((r) => r.byCategory.map((g) => g.name)))].sort();
  const payees = [...new Map(reports.flatMap((r) => r.byMerchant.map((g) => [g.id, g.name] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const chips: Chip[] = [];
  if (o.accountId) chips.push({ label: `Account: ${accountName(o.accountId)}`, clear: () => setOpt({ accountId: "" }) });
  if (o.category) chips.push({ label: `Category: ${o.category}`, clear: () => setOpt({ category: "" }) });
  if (o.merchant) chips.push({ label: `Payee: ${payees.find(([id]) => id === o.merchant)?.[1] ?? o.merchant}`, clear: () => setOpt({ merchant: "" }) });
  if (o.min || o.max) chips.push({ label: `Amount ${o.min ? `≥ $${o.min}` : ""}${o.min && o.max ? " and " : ""}${o.max ? `≤ $${o.max}` : ""}`, clear: () => setOpt({ min: "", max: "" }) });
  if (o.query) chips.push({ label: `Search: ${o.query}`, clear: () => setOpt({ query: "" }) });
  if (o.includeTransfers) chips.push({ label: "Counting own-account moves", clear: () => setOpt({ includeTransfers: false }) });
  if (o.includeCardPayments) chips.push({ label: "Counting card payments", clear: () => setOpt({ includeCardPayments: false }) });
  if (o.netRefunds) chips.push({ label: "Refunds subtracted", clear: () => setOpt({ netRefunds: false }) });

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <ControlBar
        views={VIEWS}
        view={p.view}
        onView={(view) => setSpend({ view })}
        ranges={RANGES}
        range={p.range}
        onRange={(range) => setSpend({ range: range as RangeId })}
        entity={owner}
        onEntity={(entity) => setPrefs((x) => ({ ...x, entity }))}
        chips={chips}
        filterTitle="Spending filters"
        filters={
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Account">
                <select className={inputClass} value={o.accountId} onChange={(e) => setOpt({ accountId: e.target.value })}>
                  <option value="">Every account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select className={inputClass} value={o.category} onChange={(e) => setOpt({ category: e.target.value })}>
                  <option value="">Every category</option>
                  {[...new Set([o.category, ...categories].filter(Boolean))].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Payee">
                <select className={inputClass} value={o.merchant} onChange={(e) => setOpt({ merchant: e.target.value })}>
                  <option value="">Every payee</option>
                  {payees.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Search description">
                <input className={inputClass} value={o.query} placeholder="e.g. fuel" onChange={(e) => setOpt({ query: e.target.value })} />
              </Field>
              <Field label="Amount at least">
                <input className={inputClass} inputMode="decimal" value={o.min} onChange={(e) => setOpt({ min: e.target.value.replace(/[^0-9.]/g, "") })} />
              </Field>
              <Field label="Amount at most">
                <input className={inputClass} inputMode="decimal" value={o.max} onChange={(e) => setOpt({ max: e.target.value.replace(/[^0-9.]/g, "") })} />
              </Field>
            </div>
            <fieldset className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <legend className="px-1 text-xs text-zinc-500">What counts as spending</legend>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={o.includeTransfers} onChange={(e) => setOpt({ includeTransfers: e.target.checked })} />
                <span>Count moves between your own accounts and owner draws</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={o.includeCardPayments} onChange={(e) => setOpt({ includeCardPayments: e.target.checked })} />
                <span>Count card and loan payoffs (the purchases are already counted on the card)</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={o.netRefunds} onChange={(e) => setOpt({ netRefunds: e.target.checked })} />
                <span>Subtract refunds and returns</span>
              </label>
              <p className="text-xs text-zinc-500">Money coming in (pay, sales, deposits) is never counted as spending.</p>
            </fieldset>
            <DataSourceField mode={mode} />
            <button className="self-start text-xs underline" onClick={() => setOpt(DEFAULT_SPEND_OPTIONS)}>
              Clear filters
            </button>
          </div>
        }
      />

      {p.range === "custom" && (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <Field label="From">
            <input type="date" className={inputClass} value={reports[0].range.start} onChange={(e) => setSpend({ custom: { ...p.custom, start: e.target.value } })} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={reports[0].range.end} onChange={(e) => setSpend({ custom: { ...p.custom, end: e.target.value } })} />
          </Field>
        </div>
      )}

      {mode === "sample" ? <SampleBanner /> : !readiness.ready && <RealEmpty bills={data.bills.length} goTo={goTo} />}

      <div className={`grid gap-3 ${reports.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {reports.map((r) => (
          <div key={r.bucket} className="flex min-w-0 flex-col gap-3">
            {p.view === "summary" && <Summary r={r} both={reports.length > 1} onDrill={setDrill} />}
            {p.view === "categories" && <Groups r={r} kind="categories" both={reports.length > 1} onDrill={setDrill} />}
            {p.view === "payees" && <Groups r={r} kind="payees" both={reports.length > 1} onDrill={setDrill} />}
            {p.view === "transactions" && <Transactions r={r} both={reports.length > 1} accountName={accountName} onDrill={setDrill} />}
            <CoverageNote cover={r.cover} start={r.range.start} end={r.range.end} label={bucketLabel(r.bucket as Bucket)} />
          </div>
        ))}
      </div>
      {reports.length > 1 && <p className="text-xs text-zinc-500">Shown side by side; the two owners are never added together here.</p>}

      {drill && <DrillSheet drill={drill} d={ws} update={update} accountName={accountName} onClose={() => setDrill(null)} />}
    </div>
  );
}

/* ---------------- Summary ---------------- */

function Summary({ r, both, onDrill }: { r: SpendReport; both: boolean; onDrill: (d: Drill) => void }) {
  const bucket = r.bucket as Bucket;
  const left = r.left.filter((l) => l.kind !== "spending" && l.amount > 0);
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-surface p-3 sm:p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <BucketChip bucket={bucket} />
        <span className="truncate text-xs text-zinc-500">
          {r.range.label} · {shortDate(r.range.start)} – {shortDate(r.range.end)}
        </span>
      </div>
      <button className="text-left" onClick={() => onDrill({ title: `${bucketLabel(bucket)} · all spending`, rows: r.rows })}>
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Total spent</p>
        <p className="text-3xl font-semibold tabular-nums" data-testid="spend-total">{money(r.total)}</p>
        <p className="text-xs text-zinc-500">
          {r.count.toLocaleString()} transactions · about {money(r.perWeek)} a week, {money(r.perMonth)} a month
          {r.paceDays < 28 && " (short range, rough pace)"}
        </p>
      </button>
      {r.compare ? (
        <p className="text-sm">
          {r.compare.change === null ? (
            `Nothing spent in ${r.compare.prior.label}.`
          ) : (
            <>
              <span className={r.compare.change > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>
                {r.compare.change > 0 ? "▲" : "▼"} {pct(Math.abs(r.compare.change))}
              </span>{" "}
              vs {r.compare.prior.label} ({money(r.compare.total)})
            </>
          )}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">No comparison: the history here doesn&apos;t reach back to the earlier period.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          className="min-w-0 rounded-lg bg-zinc-50 p-2 text-left dark:bg-zinc-900"
          onClick={() => onDrill({ title: `${bucketLabel(bucket)} · recurring bills`, rows: r.rows.filter((x) => x.obligation) })}
        >
          <p className="truncate text-[11px] uppercase tracking-wide text-zinc-500">Recurring bills</p>
          <p className="truncate font-semibold tabular-nums">{money(r.obligations)}</p>
          <p className="text-xs text-zinc-500">{r.total > 0 ? pct(r.obligations / r.total) : "0%"} of spending</p>
        </button>
        <button
          className="min-w-0 rounded-lg bg-zinc-50 p-2 text-left dark:bg-zinc-900"
          onClick={() => onDrill({ title: `${bucketLabel(bucket)} · everyday spending`, rows: r.rows.filter((x) => !x.obligation) })}
        >
          <p className="truncate text-[11px] uppercase tracking-wide text-zinc-500">Everyday</p>
          <p className="truncate font-semibold tabular-nums">{money(r.everyday)}</p>
          <p className="text-xs text-zinc-500">{r.total > 0 ? pct(r.everyday / r.total) : "0%"} of spending</p>
        </button>
      </div>

      <div className={`grid gap-3 ${both ? "" : "md:grid-cols-2"}`}>
        <TopList title="Where it went" groups={r.byMerchant.slice(0, 5)} total={r.total} onDrill={(g) => onDrill({ title: g.name, rows: g.rows, group: g })} />
        <TopList title="Top categories" groups={r.byCategory.slice(0, 5)} total={r.total} onDrill={(g) => onDrill({ title: g.name, rows: g.rows, group: g })} />
      </div>

      {left.length > 0 && (
        <p className="text-xs text-zinc-500">
          Not counted: {left.map((l) => `${money(l.amount)} ${LEFT_LABEL[l.kind].toLowerCase()} (${l.count})`).join(", ")}. Change this in Filters.
        </p>
      )}
    </section>
  );
}

function TopList({ title, groups, total, onDrill }: { title: string; groups: Group[]; total: number; onDrill: (g: Group) => void }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      {groups.length === 0 ? (
        <Empty>Nothing spent in this range.</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {groups.map((g) => (
            <li key={g.id}>
              <button className="w-full min-w-0 text-left" onClick={() => onDrill(g)}>
                <span className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  {g.obligation > 0 && <Tag>Bill</Tag>}
                  <span className="shrink-0 tabular-nums">{money(g.amount)}</span>
                </span>
                <span className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span className="block h-full rounded-full bg-ember" style={{ width: `${total > 0 ? Math.max(2, (g.amount / total) * 100) : 0}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Categories and payees ---------------- */

function Groups({ r, kind, both, onDrill }: { r: SpendReport; kind: "categories" | "payees"; both: boolean; onDrill: (d: Drill) => void }) {
  const [split, setSplit] = useState<"all" | "bills" | "everyday">("all");
  const bucket = r.bucket as Bucket;
  const base = kind === "categories" ? r.byCategory : r.byMerchant;
  const groups = base
    .map((g) => {
      const rows = split === "all" ? g.rows : g.rows.filter((x) => (split === "bills" ? x.obligation : !x.obligation));
      const amount = rows.reduce((s, x) => s + x.amount, 0);
      return { ...g, rows, amount, count: rows.length };
    })
    .filter((g) => g.count > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = groups.reduce((s, g) => s + g.amount, 0);
  const label = kind === "categories" ? "Category" : "Payee";
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BucketChip bucket={bucket} />
        <span className="text-sm font-medium tabular-nums">{money(total)}</span>
        <div className="ml-auto flex gap-1 text-xs" role="group" aria-label="Bills or everyday">
          {(["all", "bills", "everyday"] as const).map((s) => (
            <button key={s} aria-pressed={split === s} onClick={() => setSplit(s)} className={`rounded-full px-2 py-0.5 ${split === s ? "bg-brand text-on-brand" : "bg-zinc-100 dark:bg-zinc-800"}`}>
              {s === "all" ? "All" : s === "bills" ? "Bills" : "Everyday"}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 ? (
        <Empty>Nothing spent in this range.</Empty>
      ) : (
        <>
          <ul className={`divide-y divide-zinc-100 dark:divide-zinc-800 ${both ? "" : "md:hidden"}`}>
            {groups.map((g) => (
              <li key={g.id}>
                <button className="flex w-full min-w-0 flex-col gap-0.5 py-2 text-left" onClick={() => onDrill({ title: g.name, rows: g.rows, group: g })}>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                    <span className="shrink-0 tabular-nums">{money(g.amount)}</span>
                  </span>
                  <span className="truncate text-xs text-zinc-500">
                    {g.count}× · {pct(total > 0 ? g.amount / total : 0)}
                    {kind === "payees" && g.finding && ` · ${cadenceLabel(effective(g.finding).cadence)} · next ${effective(g.finding).nextDate ? shortDate(effective(g.finding).nextDate!) : "unknown"}`}
                    {kind === "payees" && ` · last ${shortDate(g.last)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!both && (
            <table className="hidden w-full text-left text-sm md:table">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">{label}</th>
                  {kind === "payees" && <th className="py-2 pr-3 font-medium">How often</th>}
                  {kind === "payees" && <th className="py-2 pr-3 font-medium">Last paid</th>}
                  {kind === "payees" && <th className="py-2 pr-3 font-medium">Next expected</th>}
                  <th className="py-2 pr-3 text-right font-medium">Count</th>
                  <th className="w-40 py-2 pr-3 font-medium">Share</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {groups.map((g) => {
                  const e = g.finding ? effective(g.finding) : null;
                  return (
                    <tr key={g.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900" onClick={() => onDrill({ title: g.name, rows: g.rows, group: g })}>
                      <td className="py-1.5 pr-3">
                        <button className="font-medium hover:underline">{g.name}</button>
                        {g.obligation > 0 && <span className="ml-2"><Tag>Bill</Tag></span>}
                      </td>
                      {kind === "payees" && <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">{e ? cadenceLabel(e.cadence) : "—"}</td>}
                      {kind === "payees" && <td className="py-1.5 pr-3 tabular-nums">{shortDate(g.last)}</td>}
                      {kind === "payees" && <td className="py-1.5 pr-3 tabular-nums">{e?.nextDate ? `${shortDate(e.nextDate)} (predicted)` : "—"}</td>}
                      <td className="py-1.5 pr-3 text-right tabular-nums">{g.count}</td>
                      <td className="py-1.5 pr-3">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <span className="block h-full rounded-full bg-ember" style={{ width: `${total > 0 ? Math.max(2, (g.amount / total) * 100) : 0}%` }} />
                          </span>
                          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{pct(total > 0 ? g.amount / total : 0)}</span>
                        </span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{money(g.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}

/* ---------------- Transactions ---------------- */

function Transactions({ r, both, accountName, onDrill }: { r: SpendReport; both: boolean; accountName: (id: string) => string; onDrill: (d: Drill) => void }) {
  const [shown, setShown] = useState(100);
  const bucket = r.bucket as Bucket;
  function download() {
    const blob = new Blob([spendCsv(r.rows, accountName)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spending-${bucket === "gladiator" ? "gladiator" : "personal-maverick"}-${r.range.start}-to-${r.range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BucketChip bucket={bucket} />
        <span className="text-sm tabular-nums">
          {r.count.toLocaleString()} · {money(r.total)}
        </span>
        <button className="ml-auto text-xs underline" onClick={download}>
          Download CSV
        </button>
      </div>
      {r.rows.length === 0 ? (
        <Empty>No spending in this range.</Empty>
      ) : (
        <>
          <RowList rows={r.rows.slice(0, shown)} accountName={accountName} onOpen={(x) => onDrill({ title: x.merchant, rows: [x] })} dense={!both} />
          {r.rows.length > shown && (
            <button className="mt-2 text-sm text-brand underline" onClick={() => setShown((n) => n + 200)}>
              Show more ({(r.rows.length - shown).toLocaleString()} left)
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function RowList({ rows, accountName, onOpen, dense }: { rows: SpendRow[]; accountName: (id: string) => string; onOpen?: (r: SpendRow) => void; dense?: boolean }) {
  return (
    <>
      <ul className={`divide-y divide-zinc-100 dark:divide-zinc-800 ${dense ? "md:hidden" : ""}`}>
        {rows.map((x) => (
          <li key={x.t.id}>
            <button className="flex w-full min-w-0 flex-col py-1.5 text-left" onClick={() => onOpen?.(x)} disabled={!onOpen}>
              <span className="flex items-center gap-2 text-sm">
                <span className="w-14 shrink-0 tabular-nums text-zinc-500">{md(x.t.date)}</span>
                <span className="min-w-0 flex-1 truncate">{x.merchant}</span>
                <span className={`shrink-0 tabular-nums ${x.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{money(x.amount)}</span>
              </span>
              <span className="truncate pl-16 text-xs text-zinc-500">
                {x.t.category || "Uncategorized"}
                {x.suggestion && ` · maybe ${x.suggestion}?`} · {accountName(x.t.accountId)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {dense && (
        <table className="hidden w-full text-left text-sm md:table">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 font-medium">Account</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((x) => (
              <tr key={x.t.id} className={onOpen ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900" : ""} onClick={() => onOpen?.(x)}>
                <td className="py-1.5 pr-3 tabular-nums text-zinc-500">{shortDate(x.t.date)}</td>
                <td className="max-w-[18rem] truncate py-1.5 pr-3">
                  {x.t.description}
                  {x.obligation && <span className="ml-2"><Tag>Bill</Tag></span>}
                </td>
                <td className="py-1.5 pr-3">
                  {x.t.category || "Uncategorized"}
                  {x.suggestion && <span className="ml-1 text-xs text-zinc-500">(maybe {x.suggestion}?)</span>}
                </td>
                <td className="max-w-[12rem] truncate py-1.5 pr-3 text-zinc-500">{accountName(x.t.accountId)}</td>
                <td className={`py-1.5 text-right tabular-nums ${x.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{money(x.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ---------------- Drill-down ---------------- */

function DrillSheet({ drill, d, update, accountName, onClose }: { drill: Drill; d: MoneyData; update: Update; accountName: (id: string) => string; onClose: () => void }) {
  const live = drill.rows.map((x) => ({ ...x, t: d.transactions.find((t) => t.id === x.t.id) ?? x.t }));
  const total = live.reduce((s, x) => s + x.amount, 0);
  const g = drill.group;
  const e = g?.finding ? effective(g.finding) : null;
  const single = live.length === 1 ? live[0] : null;

  function recategorize(x: SpendRow, category: string) {
    const scope = d.accounts.find((a) => a.id === x.t.accountId)?.scope ?? "personal";
    update((m) => learnCategory(m, x.t, category, scope, newId));
  }

  return (
    <Sheet title={drill.title} onClose={onClose}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Fact label="Total">{money(total)}</Fact>
        <Fact label="Transactions">{live.length}</Fact>
        <Fact label="First">{live.length ? fmtDate(live[live.length - 1].t.date) : "—"}</Fact>
        <Fact label="Last">{live.length ? fmtDate(live[0].t.date) : "—"}</Fact>
        {e && <Fact label="How often">{cadenceLabel(e.cadence)}</Fact>}
        {e && <Fact label="Next expected">{e.nextDate ? `${shortDate(e.nextDate)} (predicted)` : "Unknown"}</Fact>}
        {live[0] && <Fact label="Owner">{bucketLabel(live[0].bucket)}</Fact>}
      </dl>

      {single && <CategoryEditor x={single} d={d} onPick={(c) => recategorize(single, c)} />}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Transactions</p>
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {live.slice(0, 300).map((x) => (
            <li key={x.t.id} className="flex flex-col gap-0.5 py-1.5">
              <span className="flex items-center gap-2">
                <span className="w-24 shrink-0 tabular-nums text-zinc-500">{fmtDate(x.t.date)}</span>
                <span className="min-w-0 flex-1 truncate">{x.t.description}</span>
                <span className={`shrink-0 tabular-nums ${x.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{money(x.amount)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 sm:pl-26">
                <span className="truncate">{accountName(x.t.accountId)}</span>
                <span>·</span>
                <span>{x.t.plaidId ? "Bank feed (Plaid)" : x.t.docId ? `Uploaded document: ${d.docImports.find((doc) => doc.id === x.t.docId)?.name ?? "removed"}` : "Statement or typed in"}</span>
                <span>·</span>
                <span>{x.t.category || "Uncategorized"}</span>
                <span className="text-zinc-400">({x.categorySource === "you" ? "set by you" : "automatic"})</span>
                {x.suggestion && (
                  <button className="text-brand underline" onClick={() => recategorize(x, x.suggestion!)}>
                    Maybe {x.suggestion}? Use it
                  </button>
                )}
                {x.obligation && <Tag>Recurring bill</Tag>}
              </span>
            </li>
          ))}
        </ul>
        {live.length > 300 && <p className="mt-1 text-xs text-zinc-500">Showing the latest 300. Use Transactions and Download CSV for all of them.</p>}
      </div>
      <p className="text-xs text-zinc-500">
        Categories come from your bank feed, your saved rules or the statement import. &quot;Maybe…&quot; is only a guess from the description; nothing changes until you
        use it. A category you pick is remembered for others described the same way.
      </p>
    </Sheet>
  );
}

function CategoryEditor({ x, d, onPick }: { x: SpendRow; d: MoneyData; onPick: (c: string) => void }) {
  const scope = d.accounts.find((a) => a.id === x.t.accountId)?.scope ?? "personal";
  const options = [...new Set([x.t.category, ...(scope === "personal" ? DEFAULT_CATEGORIES : BUSINESS_CATEGORY_NAMES)].filter(Boolean))];
  return (
    <Field label="Category (remembered for others described the same way)">
      <select className={inputClass} value={x.t.category} onChange={(e) => onPick(e.target.value)}>
        {options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </Field>
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
