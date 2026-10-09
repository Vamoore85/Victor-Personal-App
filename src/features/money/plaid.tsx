"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { setMoneyData, newId } from "./store";
import { useDefaultScope, ScopeBadge } from "./scope";
import type { Account, AccountType, BankLink, MoneyData, Transaction } from "./types";
import { isLiability } from "./calc";
import { Card, Empty, buttonClass, ghostButtonClass } from "./ui";
import { businessCategoryFor, ruleCategory } from "./books";

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

/*
 * Plaid keys typed in below are kept in this browser only in sealed form
 * (sealed by the server with the site password), next to which environment
 * they're for. They're sent along with every bank call.
 */
const KEYS_STORAGE = "maverick-plaid-keys";
type SavedKeys = { keys: string; env: string };

function savedKeys(): SavedKeys | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS_STORAGE) || "null");
    return v && typeof v.keys === "string" ? v : null;
  } catch {
    return null;
  }
}

async function api<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const payload = body === undefined ? undefined : { keys: savedKeys()?.keys, ...body };
  const res = await fetch(`/api/plaid/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
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
  const scope = link.scope ?? "personal";
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
      // Keep a category already set; otherwise a learned rule, then Plaid's guess.
      category:
        prev?.category ??
        ruleCategory(d.rules, pt.name, scope) ??
        (scope === "business" ? businessCategoryFor(pt.category, income) : categoryFor(pt.category, income)),
      categoryLocked: prev?.categoryLocked,
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
  const [server, setServer] = useState<{ fromSettings: boolean; env: string } | null>(null);
  const [local, setLocal] = useState<SavedKeys | null>(null);
  const [editingKeys, setEditingKeys] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLocal(savedKeys());
    api<{ fromSettings: boolean; env: string }>("status")
      .then(setServer)
      .catch(() => setServer({ fromSettings: false, env: "sandbox" }));
  }, []);

  const status = server && {
    configured: server.fromSettings || !!local,
    env: server.fromSettings ? server.env : (local?.env ?? "sandbox"),
  };

  function keysSaved(k: SavedKeys | null) {
    try {
      if (k) localStorage.setItem(KEYS_STORAGE, JSON.stringify(k));
      else localStorage.removeItem(KEYS_STORAGE);
    } catch {
      /* private window: the keys last until the tab closes */
    }
    setLocal(k);
    setEditingKeys(false);
  }

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
      {server && !server.fromSettings && (notReady || editingKeys ? (
        <PlaidKeysForm onSaved={keysSaved} onCancel={local ? () => setEditingKeys(false) : undefined} />
      ) : (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>Plaid keys saved on this device ({status?.env === "production" ? "Live banks" : "Test mode"}).</span>
          <button className="underline hover:text-brand" onClick={() => setEditingKeys(true)} disabled={busy !== null}>
            Change keys
          </button>
          <button
            className="underline hover:text-rose-600"
            onClick={() => confirm("Remove the Plaid keys from this device? Connected banks stop syncing here until you add them again.") && keysSaved(null)}
            disabled={busy !== null}
          >
            Remove keys
          </button>
        </p>
      ))}
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

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-ember/50";

/** Where you paste your Plaid keys. They're checked with Plaid, then saved sealed on this device. */
function PlaidKeysForm({ onSaved, onCancel }: { onSaved: (k: SavedKeys) => void; onCancel?: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState("sandbox");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      onSaved(await api<SavedKeys>("keys", { clientId, secret, env, keys: undefined }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mb-4 space-y-3 rounded-lg border border-ember/30 bg-ember/5 p-4">
      <div>
        <p className="font-medium">Add your Plaid keys</p>
        <p className="text-xs text-zinc-500">
          Find them in your Plaid dashboard under{" "}
          <a className="underline hover:text-brand" href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer">
            Developers, then Keys
          </a>
          . They&apos;re checked with Plaid and saved locked on this device; enter them once on each device you use.
        </p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-zinc-600 dark:text-zinc-400">client_id</span>
        <input className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} required />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Secret</span>
        <input className={inputClass} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" required />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Which keys are these?</span>
        <select className={inputClass} value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="sandbox">Sandbox (test banks, made-up data)</option>
          <option value="production">Production (your real banks)</option>
        </select>
      </label>
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button className={buttonClass} disabled={saving}>
          {saving ? "Checking…" : "Save keys"}
        </button>
        {onCancel && (
          <button type="button" className={ghostButtonClass} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
