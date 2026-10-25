"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { money } from "@/features/money/calc";
import { newId, setMoneyData, useMoneyData } from "@/features/money/store";
import type { Bill, MoneyData, Scope } from "@/features/money/types";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";
import { prettyDate, today } from "@/lib/dates";
import { gmailLink, suggestBill, suggestScope } from "./match";
import type { EmailItem } from "./parse";
import { SCAN_BATCH_SIZE, scanRange } from "./scan-history";
import { ReceiptFolders } from "@/features/receipts/ReceiptFolders";

/*
 * Email bills: a read-only Gmail link that finds bills and receipts in a date
 * range you pick and lists them for you to review. What an email says is due
 * or paid is kept apart from your bank: it never fills in "Date taken out".
 * The Google keys and sign-in tokens stay on the server (src/lib/gmail.ts).
 */

type ScanInfo = { from: string; to: string; at: string; looked: number; kept: number; added: number; duplicates: number; capped: boolean; rechecked?: number; movedOut?: number; totalLooked?: number; totalKept?: number; failed?: number };
type Status = {
  database: boolean;
  keys: boolean;
  keysFromSettings: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  lastScan: ScanInfo | null;
  maxDays: number;
  redirectUri: string;
  items: EmailItem[];
};

const COMPANY: Record<Scope, string> = { personal: "Personal", business: "Maverick", gladiator: "Gladiator" };
const PILL: Record<Scope, string> = {
  business: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  personal: "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  gladiator: "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
};
const RANGES = [30, 60, 90, 180];

const NOTICES: Record<string, string> = {
  connected: "Gmail is connected. Press Scan to look for bills.",
  cancelled: "Google sign-in was cancelled. Nothing was connected.",
  expired: "That sign-in took too long. Press Connect Gmail again.",
  nokeys: "Add the Google keys first.",
  failed: "Google sign-in didn't finish. Try again.",
};

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/gmail/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Couldn't reach Gmail.");
  return json as T;
}

const short = (ymd: string) => prettyDate(ymd, { month: "short", day: "numeric", year: "numeric" });

export function EmailBillsScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setStatus(await call<Status>("status"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("gmail");
    if (v) {
      url.searchParams.delete("gmail");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    call<Status>("status")
      .then((st) => {
        setStatus(st);
        if (v) setNotice(NOTICES[v] ?? v);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const onItem = useCallback((item: EmailItem) => setStatus((s) => s && { ...s, items: s.items.map((i) => (i.id === item.id ? item : i)) }), []);

  return (
    <div className="flex flex-col gap-4" data-testid="email-bills">
      {notice && <p className="rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-3 text-sm dark:bg-emerald-950/40">{notice}</p>}
      {error && <p className="rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/40">{error}</p>}
      <ScopeNote />
      {!status ? (
        !error && <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <Connection status={status} reload={load} />
          {status.connected && <Scan status={status} reload={load} onYearChange={setYearFilter} />}
          <ReceiptFolders selectedYear={yearFilter} onYearChange={setYearFilter} refreshKey={status.lastScan?.at} />
          {status.items.length > 0 && <Review status={status} reload={load} onItem={onItem} year={yearFilter} />}
        </>
      )}
    </div>
  );
}

function ScopeNote() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-surface p-4 text-sm dark:border-zinc-800" data-testid="gmail-scope">
      <h2 className="font-medium">What Maverick reads in your Gmail</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
        <li>Only when you press Scan, and only the period you pick. A scan continues in batches while this page stays open; Pause stops after the current batch.</li>
        <li>Only emails that look like bills or receipts. Chats, promotions, social and forum mail are skipped, and an email that isn&apos;t a bill or receipt is dropped without saving anything from it.</li>
        <li>A scan saves the sender, subject, amount, dates and source reference. Download ZIP on Receipt folders reads the original emails, attachments included, and keeps a private encrypted copy of the ones you&apos;ve filed under a company.</li>
        <li>Read-only. It can&apos;t send, delete, move or mark email, and it never asks for your Google password: Google&apos;s own screen does the sign-in.</li>
        <li>Disconnect any time below, or at your Google account&apos;s Third-party connections page.</li>
      </ul>
    </section>
  );
}

function Connection({ status, reload }: { status: Status; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.database) return <Card title="Gmail">The online database isn&apos;t set up, so Gmail can&apos;t be connected.</Card>;
  if (!status.keys) {
    return (
      <Card title="Set up Gmail (one time)">
        <Setup redirectUri={status.redirectUri} onSaved={reload} />
      </Card>
    );
  }
  if (!status.connected) {
    return (
      <Card title="Gmail">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Not connected. Google will show its own screen asking to let Maverick <b>read</b> your email. Approve it there; nothing is connected until you do.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/gmail/connect" className={buttonClass} data-testid="gmail-connect">
            Connect Gmail
          </a>
          {!status.keysFromSettings && <ReplaceKeys redirectUri={status.redirectUri} onSaved={reload} />}
        </div>
      </Card>
    );
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Gmail? Maverick's access is revoked at Google. Bills you already found stay here.")) return;
    setBusy(true);
    setError(null);
    try {
      await call("disconnect", {});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Gmail">
      <p className="text-sm">
        Connected{status.email ? <> as <b>{status.email}</b></> : null}
        {status.connectedAt ? ` since ${short(status.connectedAt.slice(0, 10))}` : ""}. Read-only.
      </p>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-3">
        <button className={ghostButtonClass} onClick={disconnect} disabled={busy}>
          {busy ? "Disconnecting…" : "Disconnect Gmail"}
        </button>
      </div>
    </Card>
  );
}

// Your Google Cloud project for this site. The other project, Maverick Life OS, isn't used.
const GOOGLE_PROJECT = "tonal-plasma-512713-h4";
const cloud = (page: string) => `https://console.cloud.google.com/${page}?project=${GOOGLE_PROJECT}`;

function Setup({ redirectUri, onSaved }: { redirectUri: string; onSaved: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">Google needs to know about your site once before it will show its sign-in screen. These links open your Google Cloud project named Maverick ({GOOGLE_PROJECT}), not Maverick Life OS:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <a className="text-brand underline" href={cloud("apis/library/gmail.googleapis.com")} target="_blank" rel="noreferrer">
            Turn on the Gmail API
          </a>
          .
        </li>
        <li>
          <a className="text-brand underline" href={cloud("auth/overview")} target="_blank" rel="noreferrer">
            Set up the sign-in screen
          </a>
          : app name Maverick, audience External, and under Audience add your Gmail address as a test user.
        </li>
        <li>
          <a className="text-brand underline" href={cloud("auth/clients/create")} target="_blank" rel="noreferrer">
            Create a client
          </a>
          : type Web application, and add this as the authorized redirect URI:
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            <code className="break-all">{redirectUri}</code>
            <button type="button" className={ghostButtonClass} onClick={() => void navigator.clipboard?.writeText(redirectUri).then(() => setCopied(true))}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </li>
        <li>Paste the client ID and secret Google shows you below.</li>
      </ol>
      <KeysForm onSaved={onSaved} />
    </div>
  );
}

function KeysForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("keys", { clientId, secret });
      setClientId("");
      setSecret("");
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">Paste them here, not in chat. They&apos;re locked with your site password and only this site&apos;s server can read them.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client ID">
          <input className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} placeholder="….apps.googleusercontent.com" />
        </Field>
        <Field label="Client secret">
          <input className={inputClass} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
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

function ReplaceKeys({ redirectUri, onSaved }: { redirectUri: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className={ghostButtonClass} onClick={() => setOpen(true)}>
        Change keys
      </button>
    );
  return (
    <div className="mt-2 w-full">
      <Setup redirectUri={redirectUri} onSaved={async () => (await onSaved(), setOpen(false))} />
    </div>
  );
}

function Scan({ status, reload, onYearChange }: { status: Status; reload: () => Promise<void>; onYearChange: (year: string | undefined) => void }) {
  const [period, setPeriod] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchNote, setBatchNote] = useState("");
  const paused = useRef(false);
  useEffect(() => () => { paused.current = true; }, []);
  const now = today();
  const selectedYear = period.startsWith("year:") ? Number(period.slice(5)) : undefined;
  const { from, to } = scanRange(Number(period) || 90, now, selectedYear);
  const last = status.lastScan;
  const samePeriod = last?.from === from && last?.to === to;
  async function run(restart = false) {
    paused.current = false;
    setBusy(true);
    setError(null);
    try {
      let more = true;
      let batches = 0;
      while (more && !paused.current && batches < 200) {
        const result = await call<{ scan: ScanInfo }>("scan", { days: Number(period) || 90, ...(selectedYear ? { year: selectedYear } : {}), restart: restart && batches === 0 });
        batches++;
        setBatchNote(`${result.scan.totalLooked ?? result.scan.looked} emails examined in this period`);
        await reload();
        more = result.scan.capped;
        if (result.scan.failed) break; // show failed reads for a deliberate retry rather than spinning
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Scan for bills and receipts">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Period">
          <select className={inputClass} value={period} disabled={busy} onChange={(e) => { setPeriod(e.target.value); setBatchNote(""); onYearChange(e.target.value.startsWith("year:") ? e.target.value.slice(5) : undefined); }} data-testid="gmail-range">
            {RANGES.filter((d) => d <= status.maxDays).map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
            <optgroup label="Earlier years">
              {Array.from({ length: Number(now.slice(0, 4)) - 2003 }, (_, i) => Number(now.slice(0, 4)) - i).map(year => <option key={year} value={`year:${year}`}>{year}{year === Number(now.slice(0, 4)) ? " · year to date" : " · full year"}</option>)}
            </optgroup>
          </select>
        </Field>
        <button className={buttonClass} onClick={() => void run()} disabled={busy} data-testid="gmail-scan">
          {busy ? "Scanning…" : samePeriod && last.capped ? "Continue scan" : "Scan"}
        </button>
        {busy ? <button className={ghostButtonClass} onClick={() => { paused.current = true; setBatchNote("Pausing after the current batch…"); }}>Pause</button> : samePeriod && last.capped ? <button className={ghostButtonClass} onClick={() => void run(true)}>Restart period</button> : null}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Searches email from {short(from)} to {short(to)}. Up to {SCAN_BATCH_SIZE} messages per batch; saved progress continues into older results.
      </p>
      {batchNote && <p role="status" className="mt-2 text-sm">{batchNote}</p>}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      {last && (
        <p className="mt-2 text-sm" data-testid="gmail-last-scan">
          Last scan {short(last.from)} to {short(last.to)}: looked at {last.looked} emails, kept {last.kept} bills and receipts ({last.added} new
          {last.duplicates ? `, ${last.duplicates} repeats` : ""}).
          {last.movedOut ? ` Rechecked ${last.rechecked} earlier finds and moved ${last.movedOut} to Not bills.` : ""}
          {last.totalLooked !== undefined && ` Total examined in this period: ${last.totalLooked}.`}
          {last.capped ? " More remains in this period. Continue scan resumes saved progress." : " This period is finished."}
          {last.failed ? ` ${last.failed} emails could not be read; continue to retry them.` : ""}
        </p>
      )}
    </Card>
  );
}

type Tab = "review" | "confirmed" | "ignored" | "duplicate";
const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "To review" },
  { id: "confirmed", label: "Confirmed" },
  { id: "duplicate", label: "Repeats" },
  { id: "ignored", label: "Not bills" },
];

function Review({ status, reload, onItem, year }: { status: Status; reload: () => Promise<void>; onItem: (item: EmailItem) => void; year?: string }) {
  const data = useMoneyData();
  const [tab, setTab] = useState<Tab>("review");
  const items = year ? status.items.filter(item => (item.billDate ?? item.emailDate).slice(0, 4) === year) : status.items;
  const byId = useMemo(() => new Map(status.items.map((i) => [i.id, i])), [status.items]);
  const shown = items.filter((i) => i.status === tab);

  async function change(id: string, c: Record<string, unknown>) {
    const { item } = await call<{ item: EmailItem }>("items", { id, ...c });
    onItem(item);
  }

  return (
    <Card title="Found in your email">
      <p className="mb-3 text-xs text-zinc-500">
        What an email says is due or paid. These are not bank payments: the date money actually came out only ever comes from your bank, on{" "}
        <Link href="/logins" className="underline">
          Logins
        </Link>{" "}
        and Transactions.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => {
          const n = items.filter((i) => i.status === t.id).length;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1 text-sm ${tab === t.id ? "bg-brand text-on-brand" : "border border-zinc-300 dark:border-zinc-700"}`}
            >
              {t.label} ({n})
            </button>
          );
        })}
        <button className="ml-auto text-xs text-zinc-500 underline" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">{tab === "review" ? "Nothing left to review." : "None."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {shown.map((i) => (
            <ItemRow key={i.id} item={i} first={i.duplicateOf ? byId.get(i.duplicateOf) : undefined} email={status.email} data={data} change={change} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemRow({
  item,
  first,
  email,
  data,
  change,
}: {
  item: EmailItem;
  first?: EmailItem;
  email: string | null;
  data: MoneyData | null;
  change: (id: string, c: Record<string, unknown>) => Promise<void>;
}) {
  const hint = useMemo(() => (data ? suggestScope(item, data.institutions, data.bills) : null), [item, data]);
  const [scope, setScope] = useState<Scope | "">(item.scope ?? hint?.scope ?? "");
  const [editing, setEditing] = useState(false);
  const [merchant, setMerchant] = useState(item.merchant);
  const [amount, setAmount] = useState(item.amount === null ? "" : String(item.amount));
  const [due, setDue] = useState(item.dueDate ?? "");
  const [receiptDate, setReceiptDate] = useState(item.billDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(c: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await change(item.id, c);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const edits = () => ({
    merchant,
    amount: amount.trim() === "" ? null : Number(amount),
    ...(item.kind === "bill" ? { dueDate: due || null } : { billDate: receiptDate || null }),
  });

  const linked = item.billId ? data?.bills.find((b) => b.id === item.billId) : undefined;
  const match = item.status === "confirmed" && item.scope && !item.billId && data ? suggestBill(item, item.scope, data.bills) : null;

  function addAsBill() {
    if (!item.scope || item.amount === null || !item.dueDate) return;
    const bill: Bill = {
      id: newId(),
      name: item.merchant,
      amount: item.amount,
      category: "Bills",
      frequency: "monthly",
      nextDue: item.dueDate,
      dueDay: Number(item.dueDate.slice(8, 10)),
      accountId: "",
      autopay: false,
      scope: item.scope,
      note: "Added from an email bill (what the email said was due, not a bank payment).",
    };
    setMoneyData((d) => ({ ...d, bills: [...d.bills, bill] }));
    void act({ billId: bill.id });
  }

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="gmail-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {item.merchant}{" "}
            <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {item.kind === "bill" ? "Bill (expected)" : "Receipt (per email)"}
            </span>
            {item.status === "confirmed" && item.scope && <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs ${PILL[item.scope]}`}>{COMPANY[item.scope]}</span>}
          </p>
          <p className="truncate text-xs text-zinc-500">{item.subject}</p>
        </div>
        <p className="text-lg font-semibold tabular-nums">{item.amount === null ? "No amount" : item.currency === "USD" ? money(item.amount) : `${item.amount.toFixed(2)} ${item.currency}`}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
        {item.kind === "bill" && (
          <div>
            <dt className="text-zinc-500">Due date (email)</dt>
            <dd>{item.dueDate ? short(item.dueDate) : "Not in email"}</dd>
          </div>
        )}
        <div>
          <dt className="text-zinc-500">{item.kind === "bill" ? "Bill date (email)" : "Receipt date (email)"}</dt>
          <dd>{item.billDate ? short(item.billDate) : "Not in email"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Email received</dt>
          <dd>{short(item.emailDate)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Source</dt>
          <dd>
            <a href={gmailLink(item, email)} target="_blank" rel="noreferrer" className="text-brand underline">
              Open in Gmail
            </a>
          </dd>
        </div>
      </dl>
      {item.evidence && <p className="truncate text-xs text-zinc-500">“{item.evidence}”</p>}
      {item.flags.length > 0 && item.status !== "confirmed" && (
        <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
          {item.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {item.status === "duplicate" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          Looks like a repeat of the {first ? `${first.merchant} email from ${short(first.emailDate)}` : "email above"}.
          <button className={ghostButtonClass} disabled={busy} onClick={() => void act({ status: "review" })}>
            Not a repeat
          </button>
        </div>
      )}

      {item.status === "review" && (
        <div className="flex flex-col gap-2">
          {editing && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Company name">
                <input className={inputClass} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
              </Field>
              <Field label="Amount">
                <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {item.kind === "bill" && (
                <Field label="Due date">
                  <input className={inputClass} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </Field>
              )}
              {item.kind === "receipt" && (
                <Field label="Receipt date">
                  <input className={inputClass} type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
                </Field>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Company">
              <select className={inputClass} value={scope} onChange={(e) => setScope(e.target.value as Scope | "")} data-testid="gmail-company">
                <option value="">Pick one…</option>
                <option value="personal">Personal</option>
                <option value="business">Maverick</option>
                <option value="gladiator">Gladiator</option>
              </select>
            </Field>
            <button className={buttonClass} disabled={busy || !scope} onClick={() => void act({ status: "confirmed", scope, ...(editing ? edits() : {}) })}>
              Confirm
            </button>
            <button className={ghostButtonClass} disabled={busy} onClick={() => (editing ? void act(edits()) : setEditing(true))}>
              {editing ? "Save changes" : "Fix details"}
            </button>
            <button className={ghostButtonClass} disabled={busy} onClick={() => void act({ status: "ignored" })}>
              Not a bill
            </button>
          </div>
          {hint && <p className="text-xs text-zinc-500">{hint.scope ? `Suggested ${COMPANY[hint.scope]}: ${hint.why}. Check it before confirming.` : hint.why}</p>}
        </div>
      )}

      {item.status === "confirmed" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {linked ? (
            <span className="text-zinc-600 dark:text-zinc-400">Saved bill: {linked.name}</span>
          ) : match ? (
            <button className={ghostButtonClass} disabled={busy} onClick={() => void act({ billId: match.id })}>
              Link to saved bill {match.name}
            </button>
          ) : item.kind === "bill" && item.amount !== null && item.dueDate ? (
            <button className={ghostButtonClass} disabled={busy || !data} onClick={addAsBill}>
              Add as a saved monthly bill
            </button>
          ) : null}
          {item.billId && (
            <button className="text-zinc-500 underline" disabled={busy} onClick={() => void act({ billId: null })}>
              Unlink
            </button>
          )}
          <button className="text-zinc-500 underline" disabled={busy} onClick={() => void act({ status: "review" })}>
            Back to review
          </button>
        </div>
      )}

      {item.status === "ignored" && (
        <div>
          <button className={ghostButtonClass} disabled={busy} onClick={() => void act({ status: "review" })}>
            It is a bill
          </button>
        </div>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </li>
  );
}
