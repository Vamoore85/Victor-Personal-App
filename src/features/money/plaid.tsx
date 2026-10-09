"use client";

import { useEffect, useRef, useState } from "react";
import { setMoneyData, newId } from "./store";
import { useDefaultScope, ScopeBadge } from "./scope";
import type { Account, AccountType, BankLink, MoneyData, Transaction } from "./types";
import { isLiability } from "./calc";
import { Card, Empty, buttonClass, ghostButtonClass } from "./ui";

/*
 * Connect banks and cards through Plaid. Plaid Link (Plaid's own sign-in
 * window) runs in the browser; everything that uses Plaid's keys runs in this
 * site's server code under src/app/api/plaid. Synced accounts and transactions
 * are stored with the rest of the money data in this browser.
 */

type PlaidHandler = { open: () => void; destroy: () => void };
declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit: (err: { display_message?: string; error_message?: string } | null) => void;
      }) => PlaidHandler;
    };
  }
}

type SyncAccount = { id: string; name: string; mask: string | null; type: string; subtype: string | null; current: number | null };
type SyncTxn = { id: string; accountId: string; amount: number; date: string; name: string; pending: boolean; category: string };
type SyncResult = { cursor: string; institution: string; accounts: SyncAccount[]; added: SyncTxn[]; modified: SyncTxn[]; removed: string[] };

const STALE_MS = 4 * 60 * 60 * 1000; // sync on open when the last sync is older than this

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/plaid/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "Couldn't reach the bank connection service."), { code: json.code });
  return json as T;
}

let scriptPromise: Promise<void> | null = null;
function loadPlaidScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load Plaid. Check your internet connection."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Opens Plaid Link and resolves with the public token, or null if closed. */
async function openLink(linkToken: string) {
  await loadPlaidScript();
  return new Promise<string | null>((resolve, reject) => {
    const handler = window.Plaid!.create({
      token: linkToken,
      onSuccess: (publicToken) => {
        handler.destroy();
        resolve(publicToken);
      },
      onExit: (err) => {
        handler.destroy();
        if (err) reject(new Error(err.display_message || err.error_message || "The bank connection didn't finish."));
        else resolve(null);
      },
    });
    handler.open();
  });
}

function accountType(a: SyncAccount): AccountType {
  if (a.type === "credit") return "credit";
  if (a.type === "loan") return "loan";
  if (a.type === "investment" || a.type === "brokerage") return "investment";
  if (a.subtype === "savings" || a.subtype === "money market" || a.subtype === "cd") return "savings";
  return "checking";
}

/** Maps Plaid's spending categories onto the Financial Center's. */
export function categoryFor(plaidCategory: string, income: boolean) {
  const [primary, detailed = ""] = plaidCategory.split("|");
  if (income) return detailed === "INCOME_WAGES" ? "Salary" : "Other income";
  switch (primary) {
    case "FOOD_AND_DRINK":
      return detailed === "FOOD_AND_DRINK_GROCERIES" ? "Groceries" : "Dining";
    case "RENT_AND_UTILITIES":
      return detailed === "RENT_AND_UTILITIES_RENT" ? "Housing" : "Utilities";
    case "HOME_IMPROVEMENT":
      return "Housing";
    case "TRANSPORTATION":
    case "TRAVEL":
      return "Transportation";
    case "MEDICAL":
    case "PERSONAL_CARE":
      return "Health";
    case "GENERAL_MERCHANDISE":
      return "Shopping";
    case "ENTERTAINMENT":
      return "Entertainment";
    case "LOAN_PAYMENTS":
      return "Debt payments";
    case "GENERAL_SERVICES":
      return detailed === "GENERAL_SERVICES_INSURANCE" ? "Insurance" : "Other";
    case "GOVERNMENT_AND_NON_PROFIT":
      return detailed === "GOVERNMENT_AND_NON_PROFIT_DONATIONS" ? "Gifts" : "Other";
    default:
      return "Other";
  }
}

const signed = (t: Transaction) => (t.kind === "income" ? t.amount : -t.amount);

/** Folds one sync result into the money data. Pending transactions wait until they post. */
export function applySync(d: MoneyData, link: BankLink, r: SyncResult): MoneyData {
  const accounts = [...d.accounts];
  const idFor = new Map<string, string>(); // Plaid account id -> our account id
  for (const pa of r.accounts) {
    let acct = accounts.find((a) => a.plaid?.linkId === link.id && a.plaid.accountId === pa.id);
    if (!acct) {
      acct = {
        id: newId(),
        name: pa.name,
        type: accountType(pa),
        openingBalance: 0,
        scope: link.scope,
        last4: pa.mask ?? undefined,
        plaid: { linkId: link.id, accountId: pa.id },
      };
      accounts.push(acct);
    }
    idFor.set(pa.id, acct.id);
  }

  const gone = new Set(r.removed);
  const changed = new Map([...r.added, ...r.modified].map((t) => [t.id, t]));
  const existing = d.transactions.filter((t) => !t.plaidId || (!gone.has(t.plaidId) && !changed.has(t.plaidId)));
  const kept = new Map(d.transactions.filter((t) => t.plaidId && changed.has(t.plaidId)).map((t) => [t.plaidId!, t]));
  const incoming: Transaction[] = [];
  for (const pt of changed.values()) {
    const accountId = idFor.get(pt.accountId);
    if (!accountId || pt.pending) continue;
    const income = pt.amount < 0; // Plaid: positive is money leaving the account
    const prev = kept.get(pt.id);
    incoming.push({
      id: prev?.id ?? newId(),
      date: pt.date,
      description: pt.name,
      amount: Math.abs(pt.amount),
      kind: income ? "income" : "expense",
      // Keep a category you changed by hand.
      category: prev?.category ?? categoryFor(pt.category, income),
      accountId,
      transferId: prev?.transferId,
      plaidId: pt.id,
    });
  }
  const transactions = [...existing, ...incoming];

  // Set each account's starting balance so its balance matches the bank's.
  const balanced = accounts.map((a): Account => {
    const pa = a.plaid?.linkId === link.id ? r.accounts.find((x) => x.id === a.plaid!.accountId) : undefined;
    if (!pa || pa.current === null) return a;
    const net = transactions.filter((t) => t.accountId === a.id).reduce((s, t) => s + signed(t), 0);
    const openingBalance = isLiability(a) ? pa.current + net : pa.current - net;
    return { ...a, openingBalance: Math.round(openingBalance * 100) / 100 };
  });

  return {
    ...d,
    accounts: balanced,
    transactions,
    bankLinks: d.bankLinks.map((l) =>
      l.id === link.id
        ? { ...l, cursor: r.cursor, institution: l.institution || r.institution, lastSync: new Date().toISOString(), error: undefined }
        : l,
    ),
  };
}

async function syncLink(link: BankLink) {
  try {
    const r = await api<SyncResult>("sync", { link: link.link, cursor: link.cursor });
    setMoneyData((d) => {
      const current = d.bankLinks.find((l) => l.id === link.id);
      return current ? applySync(d, current, r) : d;
    });
  } catch (e) {
    const message = (e as Error).message;
    setMoneyData((d) => ({ ...d, bankLinks: d.bankLinks.map((l) => (l.id === link.id ? { ...l, error: message } : l)) }));
  }
}

function timeAgo(iso?: string) {
  if (!iso) return "Not synced yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Synced ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Keeps connected banks fresh: syncs any that are stale when the Financial Center opens. */
export function useAutoSync(data: MoneyData | null) {
  const started = useRef(false);
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    const stale = data.bankLinks.filter((l) => !l.error && (!l.lastSync || Date.now() - new Date(l.lastSync).getTime() > STALE_MS));
    stale.forEach((l) => void syncLink(l));
  }, [data]);
}

export function BankLinks({ data }: { data: MoneyData }) {
  const scope = useDefaultScope();
  const [status, setStatus] = useState<{ configured: boolean; env: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ configured: boolean; env: string }>("status")
      .then(setStatus)
      .catch(() => setStatus({ configured: false, env: "sandbox" }));
  }, []);

  async function connect() {
    setMessage("");
    setBusy("new");
    try {
      const { linkToken } = await api<{ linkToken: string }>("link-token", {});
      const publicToken = await openLink(linkToken);
      if (!publicToken) return;
      const { itemId, link } = await api<{ itemId: string; link: string }>("exchange", { publicToken });
      const bank: BankLink = { id: newId(), itemId, institution: "", link, cursor: "", scope };
      setMoneyData((d) => ({ ...d, bankLinks: [...d.bankLinks, bank] }));
      setBusy(bank.id);
      await syncLink(bank);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sync(link: BankLink) {
    setMessage("");
    setBusy(link.id);
    await syncLink(link);
    setBusy(null);
  }

  /** Re-opens Plaid for a bank that needs you to sign in again. */
  async function fix(link: BankLink) {
    setMessage("");
    setBusy(link.id);
    try {
      const { linkToken } = await api<{ linkToken: string }>("link-token", { link: link.link });
      if (await openLink(linkToken)) await syncLink({ ...link, error: undefined });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(link: BankLink) {
    const accounts = data.accounts.filter((a) => a.plaid?.linkId === link.id);
    const ok = confirm(
      `Disconnect ${link.institution || "this bank"}? Its ${accounts.length} account(s) and their transactions stay here, but stop updating.`,
    );
    if (!ok) return;
    setBusy(link.id);
    await api("remove", { link: link.link }).catch(() => undefined);
    setMoneyData((d) => ({
      ...d,
      bankLinks: d.bankLinks.filter((l) => l.id !== link.id),
      accounts: d.accounts.map((a) => (a.plaid?.linkId === link.id ? { ...a, plaid: undefined } : a)),
    }));
    setBusy(null);
  }

  const notReady = status && !status.configured;
  return (
    <Card
      title="Connected banks"
      action={
        <button className={buttonClass} onClick={connect} disabled={!status?.configured || busy !== null}>
          {busy === "new" ? "Connecting…" : "Connect a bank"}
        </button>
      }
    >
      {notReady && (
        <p className="mb-3 rounded-lg bg-ember/10 px-3 py-2 text-sm text-brand">
          Bank connections are almost ready. Plaid&apos;s keys still need to be added to this site&apos;s settings in Vercel.
        </p>
      )}
      {status?.configured && status.env === "sandbox" && (
        <p className="mb-3 text-xs text-zinc-500">
          Test mode: connect any bank in Plaid&apos;s window and sign in with username <span className="font-mono">user_good</span> and password{" "}
          <span className="font-mono">pass_good</span>. The accounts and transactions are made up.
        </p>
      )}
      {message && <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{message}</p>}
      {data.bankLinks.length === 0 ? (
        <Empty>Connect your bank and card accounts to bring in balances and transactions automatically.</Empty>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.bankLinks.map((l) => {
            const accts = data.accounts.filter((a) => a.plaid?.linkId === l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {l.institution || "Bank"}
                    <ScopeBadge item={l} />
                  </p>
                  <p className="text-xs text-zinc-500">
                    {accts.length} account{accts.length === 1 ? "" : "s"} · {busy === l.id ? "Syncing…" : timeAgo(l.lastSync)}
                  </p>
                  {l.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{l.error}</p>}
                </div>
                <div className="flex gap-2">
                  {l.error && (
                    <button className={ghostButtonClass} onClick={() => fix(l)} disabled={busy !== null}>
                      Sign in again
                    </button>
                  )}
                  <button className={ghostButtonClass} onClick={() => sync(l)} disabled={busy !== null || !status?.configured}>
                    Sync now
                  </button>
                  <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => disconnect(l)} disabled={busy !== null}>
                    Disconnect
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
