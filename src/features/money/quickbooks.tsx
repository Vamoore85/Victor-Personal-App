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
    if (!window.confirm("Disconnect QuickBooks? The numbers already pulled stay here.")) return;
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
      <Card title="Connect QuickBooks">
        {header}
        <KeysForm redirectUri={status.redirectUri} onSaved={load} />
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
    <div className="flex flex-col gap-6">
      <Card
        title={`From QuickBooks: ${status.companyName ?? "Gladiator"}`}
        action={
          <div className="flex gap-2">
            <button className={ghostButtonClass} onClick={() => refresh()} disabled={busy}>
              {busy ? "Updating…" : "Update now"}
            </button>
            <button className={ghostButtonClass} onClick={disconnect} disabled={busy}>
              Disconnect
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
            <p className="mt-3 text-xs text-zinc-500">
              {report.basis} basis, January 1 to {report.balanceAsOf || "today"}. Updated {new Date(report.fetchedAt).toLocaleString()}. These are
              your bookkeeper&apos;s numbers, so they&apos;re the ones to trust for Gladiator&apos;s taxes.
            </p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">{busy ? `Pulling ${year} from QuickBooks…` : `Press Update now to pull ${year}.`}</p>
        )}
      </Card>
      {report && report.year === year && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ReportTable title={`Profit and loss ${year}`} lines={report.pl} />
          <ReportTable title={`Balance sheet as of ${report.balanceAsOf}`} lines={report.balanceSheet} />
        </div>
      )}
    </div>
  );
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
