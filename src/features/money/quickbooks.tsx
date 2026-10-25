"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "./ui";
import { money } from "./calc";

/*
 * Gladiator's books as its bookkeeper keeps them in QuickBooks Online: a
 * read-only link that pulls the profit and loss and balance sheet. The Intuit
 * keys and sign-in tokens stay on the server (src/lib/quickbooks.ts).
 */

type ReportLine = { label: string; amount: number | null; depth: number; kind: "section" | "line" | "total" };
type Report = {
  year: number;
  fetchedAt: string;
  basis: string;
  companyName: string;
  income: number;
  expenses: number;
  netIncome: number;
  pl: ReportLine[];
  balanceSheet: ReportLine[];
  balanceAsOf: string;
  source?: "gladiator-crm";
  accounts?: { id: string; name: string; type: string; currency: string; balance: number | null }[];
  transactions?: { columns: { title: string; type: string }[]; rows: string[][]; currency: string };
  period?: { start: string; end: string };
};
type Status = {
  database: boolean;
  keys: boolean;
  keysFromSettings: boolean;
  env: "production" | "sandbox" | null;
  connected: boolean;
  companyName: string | null;
  connectedAt: string | null;
  refreshExpires: string | null;
  redirectUri: string;
  report: Report | null;
  shared?: boolean;
};

const STALE_MS = 4 * 60 * 60 * 1000;

const NOTICES: Record<string, string> = {
  connected: "QuickBooks is connected.",
  cancelled: "QuickBooks sign-in was cancelled.",
  expired: "That sign-in took too long. Press Connect QuickBooks again.",
  nokeys: "Add the Intuit app keys first.",
  failed: "QuickBooks sign-in didn't finish. Try again.",
};

/** The ?quickbooks= result Intuit's sign-in sends back with, if any. */
export function quickBooksNotice() {
  if (typeof window === "undefined") return null;
  const v = new URL(window.location.href).searchParams.get("quickbooks");
  return v ? (NOTICES[v] ?? v) : null;
}

/** Removes ?quickbooks= from the address bar so a reload doesn't show it again. */
export function clearQuickBooksNotice() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("quickbooks")) return;
  url.searchParams.delete("quickbooks");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/quickbooks/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Couldn't reach QuickBooks.");
  return json as T;
}

export function QuickBooksPanel({ year, notice }: { year: number; notice?: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(notice ?? null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (quiet = false) => {
      setBusy(true);
      if (!quiet) setError(null);
      try {
        const r = await call<{ report: Report }>("sync", { year });
        setReport(r.report);
        setMessage(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [year],
  );

  const load = useCallback(
    () =>
      call<Status>(`status?year=${year}`)
        .then((s) => {
          setStatus(s);
          setReport(s.report);
          const stale = !s.report || Date.now() - new Date(s.report.fetchedAt).getTime() > STALE_MS;
          if (s.connected && stale) void refresh(true);
        })
        .catch((e: Error) => setError(e.message)),
    [year, refresh],
  );

  useEffect(() => {
    let live = true;
    call<Status>(`status?year=${year}`)
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setReport(s.report);
        const stale = !s.report || Date.now() - new Date(s.report.fetchedAt).getTime() > STALE_MS;
        if (s.connected && stale) void refresh(true);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [year, refresh]);

  async function disconnect() {
    if (!window.confirm(status?.shared ? "Remove Gladiator books from Maverick? The connection in Gladiator CRM stays active." : "Disconnect QuickBooks? The numbers already pulled stay here.")) return;
    setBusy(true);
    try {
      await call("disconnect", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <Card title="QuickBooks">
        <p className="text-sm text-zinc-500">{error ?? "Checking QuickBooks…"}</p>
      </Card>
    );
  }

  const header = (
    <>
      {message && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{message}</p>}
      {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">{error}</p>}
    </>
  );

  if (!status.database) {
    return (
      <Card title="QuickBooks">
        {header}
        <p className="text-sm text-zinc-500">QuickBooks needs the online database, which isn&apos;t set up on this site.</p>
      </Card>
    );
  }

  if (!status.keys) {
    return (
      <Card title="Connect Gladiator books">
        {header}
        <GladiatorLinkForm onSaved={load} />
        <details className="mt-5 text-sm"><summary className="cursor-pointer">Separate Intuit connection</summary><div className="mt-4"><KeysForm redirectUri={status.redirectUri} onSaved={load} /></div></details>
      </Card>
    );
  }

  if (!status.connected) {
    return (
      <Card title="Connect QuickBooks">
        {header}
        <p className="mb-4 text-sm text-zinc-500">
          Sign in with the QuickBooks login that can see Gladiator&apos;s books (yours, or your bookkeeper&apos;s) and approve the link. This
          site only reads reports; it can&apos;t change anything in QuickBooks.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a className={buttonClass} href="/api/quickbooks/connect">
            Connect QuickBooks
          </a>
          {!status.keysFromSettings && <ReplaceKeys redirectUri={status.redirectUri} onSaved={load} />}
        </div>
        {status.env === "sandbox" && <p className="mt-3 text-xs text-zinc-500">Using Intuit&apos;s test (sandbox) keys, which only see test companies.</p>}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <Card
        title={`From QuickBooks: ${status.companyName ?? "Gladiator"}`}
        action={
          <div className="flex gap-2">
            <button className={ghostButtonClass} onClick={() => refresh()} disabled={busy}>
              {busy ? "Updating…" : "Update now"}
            </button>
            <button className={ghostButtonClass} onClick={disconnect} disabled={busy}>
              {status.shared ? "Remove this link" : "Disconnect"}
            </button>
          </div>
        }
      >
        {header}
        {report && report.year === year ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label={`Income ${year}`} value={money(report.income)} />
              <Stat label={`Expenses ${year}`} value={money(report.expenses)} />
              <Stat label="Net income" value={money(report.netIncome)} tone={report.netIncome >= 0 ? "good" : "bad"} />
            </div>
            <p className="mt-3 text-sm text-zinc-500">
              {report.basis} basis, January 1 to {report.balanceAsOf || "today"}. Updated {new Date(report.fetchedAt).toLocaleString()}. These are
              Gladiator&apos;s QuickBooks records{status.shared ? ", shared with Gladiator CRM" : ""}.
            </p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">{busy ? `Pulling ${year} from QuickBooks…` : `Press Update now to pull ${year}.`}</p>
        )}
      </Card>
      {report?.year === year && report.accounts && report.transactions && <GladiatorLedger report={report} />}
      {report && report.year === year && (
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><summary className="cursor-pointer font-medium">Financial reports from QuickBooks</summary><div className="mt-4 grid grid-cols-1 gap-4 lg:gap-5 lg:grid-cols-2">
          <ReportTable title={`Profit and loss ${year}`} lines={report.pl} />
          <ReportTable title={`Balance sheet as of ${report.balanceAsOf}`} lines={report.balanceSheet} />
        </div></details>
      )}
    </div>
  );
}

function GladiatorLinkForm({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();setBusy(true);setError("");
    try { await call("gladiator-link", { key });setKey("");onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="grid gap-4">
    <p>Use the same Gladiator QuickBooks books that Jeremy sees. Balances, transactions, and expense categories stay together.</p>
    <Field label="Gladiator connection code"><input className={inputClass} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></Field>
    {error && <p role="alert" className="text-rose-600">{error}</p>}
    <button className={buttonClass} disabled={busy || !key}>{busy ? "Connecting…" : "Connect Gladiator books"}</button>
  </form>;
}

function GladiatorLedger({ report }: { report: Report }) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(0);
  const accounts = report.accounts ?? [], transactions = report.transactions;
  if (!transactions) return null;
  const accountIndex = transactions.columns.findIndex(c => c.title.toLowerCase() === "account");
  const columns = transactions.columns.map((c, index) => ({ ...c, index })).filter(c => !["posting", "num"].includes(c.title.toLowerCase()));
  const rows = transactions.rows.filter(r => (!account || r[accountIndex] === account) && (!query || r.join(" ").toLowerCase().includes(query.toLowerCase())));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1)), start = currentPage * 50;
  const bankAccounts = accounts.filter(a => ["Bank", "Credit Card", "CreditCard"].includes(a.type));
  return <>
    <Card title="Gladiator account balances">
      <p className="mb-3 text-sm text-zinc-500">Current QuickBooks book balances. Bank-available balances and unreviewed bank-feed items may differ.</p>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">{bankAccounts.map(a => <div key={a.id} className="flex justify-between gap-4 py-2"><span>{a.name}</span><strong className="tabular-nums">{a.balance === null ? "Not recorded" : a.balance.toLocaleString("en-US", { style: "currency", currency: a.currency })}</strong></div>)}</div>
    </Card>
    <Card title="Gladiator transactions">
      <p className="mb-3 text-sm text-zinc-500">{report.period?.start} to {report.period?.end} · Categories and amounts from QuickBooks.</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Find a transaction"><input className={inputClass} type="search" placeholder="Name, category, amount…" value={query} onChange={e => { setQuery(e.target.value);setPage(0); }} /></Field>
        <Field label="Account"><select className={inputClass} value={account} onChange={e => { setAccount(e.target.value);setPage(0); }}><option value="">All accounts</option>{accounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</select></Field>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-base"><thead><tr>{columns.map(c => <th key={c.index} scope="col" className="whitespace-nowrap border-b border-zinc-300 px-3 py-2 dark:border-zinc-700">{c.title === "Split" ? "Category / other account" : c.title}</th>)}</tr></thead><tbody>{rows.slice(start, start + 50).map((r, i) => <tr key={start + i} className="border-b border-zinc-100 dark:border-zinc-900">{columns.map(c => <td key={c.index} className="min-w-28 max-w-80 px-3 py-2 align-top break-words">{r[c.index] || "—"}</td>)}</tr>)}</tbody></table></div>
      {!rows.length && <p className="py-4 text-zinc-500">{query || account ? "No matching transactions." : "QuickBooks returned no transactions for this period."}</p>}
      <div className="mt-4 flex items-center justify-between gap-3"><button className={ghostButtonClass} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="text-sm">{rows.length ? `${start + 1}–${Math.min(start + 50, rows.length)} of ${rows.length}` : "0 transactions"}</span><button className={ghostButtonClass} disabled={start + 50 >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </Card>
  </>;
}

function ReportTable({ title, lines }: { title: string; lines: ReportLine[] }) {
  return (
    <Card title={title}>
      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing in QuickBooks for this period.</p>
      ) : (
        <div className="flex flex-col text-sm">
          {lines.map((l, i) => (
            <div
              key={i}
              className={`flex justify-between gap-3 py-1 ${l.kind === "total" ? "border-t border-zinc-200 font-medium dark:border-zinc-800" : ""} ${
                l.kind === "section" ? "pt-3 font-medium" : ""
              }`}
              style={{ paddingLeft: `${l.depth * 0.75}rem` }}
            >
              <span className="min-w-0 break-words">{l.label}</span>
              <span className="shrink-0 tabular-nums">{l.amount === null ? "" : money(l.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function KeysForm({ redirectUri, onSaved }: { redirectUri: string; onSaved: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState<"production" | "sandbox">("production");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("keys", { clientId, secret, env });
      setClientId("");
      setSecret("");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Paste your Intuit app&apos;s keys here (not in chat). They&apos;re locked with your site password and only this site&apos;s server can read
        them.
      </p>
      <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <p className="text-xs text-zinc-500">Redirect URI to paste into your Intuit app</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="break-all">{redirectUri}</code>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              void navigator.clipboard?.writeText(redirectUri).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Client ID">
          <input className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Client secret">
          <input className={inputClass} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Keys type">
          <select className={inputClass} value={env} onChange={(e) => setEnv(e.target.value as "production" | "sandbox")}>
            <option value="production">Production (real books)</option>
            <option value="sandbox">Development (test company)</option>
          </select>
        </Field>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div>
        <button className={buttonClass} disabled={busy || !clientId || !secret}>
          {busy ? "Saving…" : "Save keys"}
        </button>
      </div>
    </form>
  );
}

function ReplaceKeys({ redirectUri, onSaved }: { redirectUri: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className={ghostButtonClass} onClick={() => setOpen(true)}>
        Change keys
      </button>
    );
  }
  return (
    <div className="mt-4 w-full">
      <KeysForm
        redirectUri={redirectUri}
        onSaved={() => {
          setOpen(false);
          onSaved();
        }}
      />
    </div>
  );
}
