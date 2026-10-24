"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { cloudReady, flushCloud, getMoneyData, reloadFromCloud, setMoneyData, newId, useCloudState } from "./store";
import { useDefaultScope, ScopeBadge, SCOPES } from "./scope";
import type { Scope, BankLink, MoneyData } from "./types";
import { Card, Empty, buttonClass, ghostButtonClass } from "./ui";
import { HISTORY_DONE, saveBriefing } from "./briefing";
import { setMode } from "./intel-shared";
import { assignEntity } from "./accounts-fix";

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

import { applySync, type SyncResult } from "./plaid-apply";
export { applySync, categoryFor, sameCharge } from "./plaid-apply";

export { HISTORY_DONE };

const STALE_MS = 4 * 60 * 60 * 1000; // sync on open when the last sync is older than this

/*
 * Plaid keys typed in below are saved by the server for the whole site, so
 * every view and device uses the same ones. Without the online database they
 * fall back to this browser, sealed by the server with the site password, and
 * are sent along with every bank call.
 */
const KEYS_STORAGE = "maverick-plaid-keys";
type SavedKeys = { keys: string; env: string };
type ServerKeys = { fromSettings: boolean; env: string | null; site: boolean; check?: { ok: boolean; code?: string; error?: string } };
type KeysResult = { keys?: string; env: string; site: boolean };

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

/**
 * Connects a bank straight from anywhere in Money (no trip to Accounts): opens
 * Plaid, saves the connection for `scope`, then brings its history in. Bank
 * accounts already here with the same last 4 digits are taken over, so their
 * history and company stay as they are.
 */
export async function connectBank(scope: Scope): Promise<string> {
  const { linkToken } = await api<{ linkToken: string }>("link-token", {});
  const publicToken = await openLink(linkToken);
  if (!publicToken) return "";
  const id = newId();
  const { itemId, link } = await api<{ itemId: string; link: string }>("exchange", { publicToken, id, scope });
  const bank: BankLink = { id, itemId, institution: "", link, cursor: "", scope, connectedAt: new Date().toISOString() };
  setMoneyData((d) => ({ ...d, bankLinks: [...d.bankLinks, bank] }));
  setMode("real");
  await firstSync(bank, () => {});
  return id;
}

/* ---------------- Syncing ---------------- */

// One sync per bank at a time: a second request while one is running waits for it.
const running = new Map<string, Promise<string | undefined>>();
const syncListeners = new Set<() => void>();
type Activity = { syncing: number; lastRun: { at: string; ok: number; failed: number } | null; problem: { code: string; text: string } | null };
let lastRun: Activity["lastRun"] = null;
// A problem that stops every bank syncing (keys, database), in plain words.
let problem: Activity["problem"] = null;
let snapshot: Activity = { syncing: 0, lastRun, problem };
const notify = () => {
  snapshot = { syncing: running.size, lastRun, problem };
  syncListeners.forEach((l) => l());
};

/** How many banks are syncing right now, how the last sync went, and anything blocking all of them. */
export function useSyncActivity() {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

/** Errors that need you (sign in again, reconnect); syncing again on its own won't fix them. */
export const needsYou = (l: BankLink) =>
  l.errorCode === "BAD_SEAL" || l.errorCode === "ITEM_LOGIN_REQUIRED" || l.errorCode === "PENDING_EXPIRATION" || l.errorCode === "PENDING_DISCONNECT";

type RefreshLink = { id: string; ok: boolean; hasMore: boolean; historyStatus?: string; code?: string; error?: string };
const PROBLEMS: Record<string, string> = {
  NOT_CONFIGURED: "The server has no Plaid keys: PLAID_CLIENT_ID and PLAID_SECRET aren't set in Vercel, and no keys are saved for the site.",
  BAD_KEYS: "The Plaid keys saved for this site can't be opened any more (the site password changed since they were saved).",
  INVALID_API_KEYS: "Plaid refused the server's Plaid keys (INVALID_API_KEYS).",
};

/**
 * Syncs banks on the server, which saves straight into the online money data
 * where the reports read it, then reloads that data here. Big histories take
 * several rounds. Returns each bank's history status, or undefined if it failed;
 * "browser" when there's no online database and this browser must sync itself.
 */
async function refreshOnServer(ids: string[], trigger: "first-sync" | "sync"): Promise<Map<string, string | undefined> | "browser"> {
  const out = new Map<string, string | undefined>();
  let todo = ids;
  try {
    await flushCloud(); // the server works from the saved copy
    for (let round = 0; round < 10 && todo.length; round++) {
      const r = await refreshCall(todo);
      for (const l of r.links) out.set(l.id, l.ok ? l.historyStatus || "OK" : undefined);
      todo = r.links.filter((l) => l.ok && l.hasMore).map((l) => l.id);
      await reloadFromCloud(); // show what's arrived so far
    }
    problem = null;
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "NO_DATABASE") return "browser";
    problem = { code: err.code || "UNREACHABLE", text: PROBLEMS[err.code ?? ""] ?? (err.code === "DB_FAILED" ? err.message : `Bank sync couldn't run: ${err.message}`) };
    for (const id of ids) if (!out.has(id)) out.set(id, undefined);
  }
  // A finished sync refreshes the saved Financial Briefing.
  setMoneyData((d) => saveBriefing(d, trigger));
  return out;
}

const DB_TRIES = 5;

/** One refresh call, tried again with growing waits while the database is busy. */
async function refreshCall(only: string[]): Promise<{ links: RefreshLink[] }> {
  for (let i = 1; ; i++) {
    try {
      const r = await api<{ links: RefreshLink[] }>("refresh", { only });
      if (problem?.code === "DB_RETRY") {
        problem = null;
        notify();
      }
      return r;
    } catch (e) {
      const err = e as Error & { code?: string };
      if ((err.code !== "DB_RETRY" && err.code !== "DB_ERROR") || i >= DB_TRIES) {
        if (err.code === "DB_RETRY" || err.code === "DB_ERROR")
          throw Object.assign(new Error(`Saving to the database failed ${DB_TRIES} times in a row (${err.message}) Nothing was lost; Refresh now tries again.`), { code: "DB_FAILED" });
        throw e;
      }
      problem = { code: "DB_RETRY", text: `Retrying database save (try ${i + 1} of ${DB_TRIES})…` };
      notify();
      await new Promise((res) => setTimeout(res, 1500 * 2 ** (i - 1)));
    }
  }
}

/** Syncs these banks: on the server when the online database is in use, otherwise in this browser. */
function startSync(links: BankLink[], trigger: "first-sync" | "sync") {
  const fresh = links.filter((l) => !running.has(l.id));
  if (fresh.length) {
    const job = cloudReady() ? refreshOnServer(fresh.map((l) => l.id), trigger) : Promise.resolve("browser" as const);
    for (const l of fresh) {
      const one = job
        .then((r) => (r === "browser" ? runSync(l, trigger) : r.get(l.id)))
        .finally(() => {
          running.delete(l.id);
          notify();
        });
      running.set(l.id, one);
    }
    // When this round is done, the sync check looks again.
    void Promise.all(fresh.map((l) => running.get(l.id)!)).then((rs) => {
      const ok = rs.filter((r) => r !== undefined).length;
      lastRun = { at: new Date().toISOString(), ok, failed: rs.length - ok };
      notify();
    });
    notify();
  }
  return links.map((l) => running.get(l.id)!);
}

/**
 * Brings a bank up to date. Returns Plaid's history status, or undefined when
 * the sync failed (the bank's line then says why).
 */
export function syncLink(link: BankLink, trigger: "first-sync" | "sync" = "sync"): Promise<string | undefined> {
  return startSync([link], trigger)[0];
}

/** The same sync, run in this browser: used when there's no online database. */
async function runSync(link: BankLink, trigger: "first-sync" | "sync"): Promise<string | undefined> {
  const fresh = () => getMoneyData()?.bankLinks.find((l) => l.id === link.id) ?? link;
  let cursor = fresh().cursor;
  try {
    for (let round = 0; round < 12; round++) {
      const r = await api<SyncResult>("sync", { link: link.link, cursor });
      cursor = r.cursor;
      setMoneyData((d) => {
        const current = d.bankLinks.find((l) => l.id === link.id);
        return current ? applySync(d, current, r) : d;
      });
      if (!r.hasMore) {
        setMoneyData((d) => saveBriefing(d, trigger));
        return r.updateStatus || "OK";
      }
    }
    setMoneyData((d) => saveBriefing(d, trigger));
    return "MORE";
  } catch (e) {
    const err = e as Error & { code?: string };
    if (PROBLEMS[err.code ?? ""]) {
      problem = { code: err.code!, text: PROBLEMS[err.code!] };
      notify();
    }
    // The saved briefing records the failure too, so it never reads as current.
    setMoneyData((d) => saveBriefing({ ...d, bankLinks: d.bankLinks.map((l) => (l.id === link.id ? { ...l, error: err.message, errorCode: err.code } : l)) }, trigger));
  }
  return undefined;
}

/** Syncs every connected bank that can sync without you. Resolves when all are done. */
export async function syncAll(trigger: "first-sync" | "sync" = "sync") {
  const links = (getMoneyData()?.bankLinks ?? []).filter((l) => !needsYou(l) && !l.duplicateOf);
  const results = await Promise.all(startSync(links, trigger));
  const ok = results.filter((r) => r !== undefined).length;
  return { at: new Date().toISOString(), ok, failed: links.length - ok };
}

/** Right after connecting, Plaid needs a little while to gather history. Check back a few times. */
async function firstSync(link: BankLink, onWait: (n: number) => void) {
  let status = await syncLink(link, "first-sync");
  for (let i = 0; i < 8 && (status === "NOT_READY" || status === undefined); i++) {
    onWait(i + 1);
    await new Promise((res) => setTimeout(res, 5000));
    status = await syncLink(link, "first-sync");
  }
  return status;
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

const RETRY_MS = 10 * 60 * 1000; // banks still loading history, or whose last sync failed

/**
 * Keeps connected banks fresh in this browser: when the Financial Center
 * opens (and when it comes back into view), syncs every bank that's due.
 * Waits for the online copy of your money data first, so a device whose own
 * copy is old or empty still finds and syncs the banks connected elsewhere.
 */
export function useAutoSync(data: MoneyData | null) {
  const cloud = useCloudState();
  const ready = !!data && cloud !== "loading";
  const linkIds = data?.bankLinks.map((l) => l.id).join(",") ?? "";
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const d = getMoneyData();
      if (!d) return;
      const age = (l: BankLink) => (l.lastSync ? Date.now() - new Date(l.lastSync).getTime() : Infinity);
      const due = d.bankLinks.filter((l) => {
        if (needsYou(l) || l.duplicateOf) return false;
        // A failed bank is retried once each time the page opens, not in a loop.
        if (l.error) return !tried.current.has(l.id);
        // A connection whose account is also kept as a leftover copy is synced once per visit, which merges the two.
        const mine = d.accounts.filter((a) => a.plaid?.linkId === l.id && a.last4);
        const twin = d.accounts.some((x) => (!x.plaid || !d.bankLinks.some((k) => k.id === x.plaid!.linkId)) && mine.some((a) => a.last4 === x.last4 && (a.scope ?? "personal") === (x.scope ?? "personal")));
        if (twin && !tried.current.has(l.id)) return true;
        // A connected account with no balance from the bank yet is refreshed once per visit.
        if (!tried.current.has(l.id) && d.accounts.some((a) => a.plaid?.linkId === l.id && !a.bankBalance)) return true;
        return age(l) > (l.historyStatus === HISTORY_DONE ? STALE_MS : RETRY_MS);
      });
      due.forEach((l) => tried.current.add(l.id));
      if (due.length) void startSync(due, "sync");
    };
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, RETRY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [ready, linkIds]);
}

export function BankLinks({ data, onBriefing }: { data: MoneyData; onBriefing?: () => void }) {
  const defaultScope = useDefaultScope();
  const scope: Scope = defaultScope; // only tags the connection; each account's company is assigned separately
  const [waiting, setWaiting] = useState("");
  const [briefingReady, setBriefingReady] = useState(false);
  const [server, setServer] = useState<ServerKeys | null>(null);
  const [local, setLocal] = useState<SavedKeys | null>(null);
  const [editingKeys, setEditingKeys] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLocal(savedKeys());
    fetch("/api/plaid/status?check=1")
      .then((r) => r.json() as Promise<ServerKeys>)
      .then(setServer)
      .catch(() => setServer({ fromSettings: false, env: null, site: false }));
  }, []);

  const shared = !!server && (server.fromSettings || server.site);
  const status = server && {
    configured: shared || !!local,
    env: shared ? (server.env ?? "sandbox") : (local?.env ?? "sandbox"),
  };

  function keepLocal(k: SavedKeys | null) {
    try {
      if (k) localStorage.setItem(KEYS_STORAGE, JSON.stringify(k));
      else localStorage.removeItem(KEYS_STORAGE);
    } catch {
      /* private window: the keys last until the tab closes */
    }
    setLocal(k);
  }

  function keysSaved(r: KeysResult) {
    if (r.site) {
      keepLocal(null); // the site's copy replaces any older one on this device
      setServer({ fromSettings: false, env: r.env, site: true });
    } else if (r.keys) {
      keepLocal({ keys: r.keys, env: r.env });
    }
    setEditingKeys(false);
  }

  async function removeKeys() {
    if (!confirm("Remove the Plaid keys? Connected banks stop syncing until you add them again.")) return;
    setMessage("");
    try {
      if (server?.site) await api("keys", { remove: true });
      keepLocal(null);
      setServer((s) => s && { ...s, env: null, site: false });
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function connect() {
    setMessage("");
    setBusy("new");
    try {
      const { linkToken } = await api<{ linkToken: string }>("link-token", {});
      const publicToken = await openLink(linkToken);
      if (!publicToken) return;
      const id = newId();
      // The server saves the new connection into the online money data straight away.
      const { itemId, link } = await api<{ itemId: string; link: string }>("exchange", { publicToken, id, scope });
      const bank: BankLink = { id, itemId, institution: "", link, cursor: "", scope, connectedAt: new Date().toISOString() };
      setMoneyData((d) => ({ ...d, bankLinks: [...d.bankLinks, bank] }));
      setBusy(bank.id);
      const st = await firstSync(bank, (n) => setWaiting(`Plaid is gathering your history (check ${n} of 8)…`));
      const ready = !!st && st !== "NOT_READY";
      setBriefingReady(ready);
      // Transactions are in: go straight to the briefing.
      if (ready && onBriefing) onBriefing();
      setWaiting(
        st === HISTORY_DONE
          ? ""
          : "Connected. Plaid is still loading older history from the bank; it fills in on its own over the next few minutes to hours, and Sync now picks up what's arrived.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sync(link: BankLink) {
    setMessage("");
    setBusy(link.id);
    const st = await syncLink(link);
    setBusy(null);
    if (st === undefined) return; // the bank's line shows what went wrong
    if (st !== HISTORY_DONE && st !== "OK") setWaiting(`${link.institution || "The bank"}: Plaid is still loading older history.`);
    onBriefing?.();
  }

  async function syncEvery() {
    setMessage("");
    setBusy("all");
    const r = await syncAll();
    setBusy(null);
    if (r.ok > 0 && onBriefing) onBriefing();
    else if (r.failed) setMessage("The sync didn't finish. Each bank below says why.");
  }

  /** Re-opens Plaid for a bank that needs you to sign in again. */
  async function fix(link: BankLink) {
    setMessage("");
    setBusy(link.id);
    try {
      const { linkToken } = await api<{ linkToken: string }>("link-token", { link: link.link });
      if (await openLink(linkToken)) {
        const st = await syncLink({ ...link, error: undefined });
        if (st !== undefined) onBriefing?.();
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Moves a connected account to Personal, Maverick or Gladiator; its transactions re-sort on save. */
  function moveAccount(id: string, to: Scope) {
    setMoneyData((d) => assignEntity(d, id, to));
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
  const { syncing } = useSyncActivity();
  const cloud = useCloudState();
  const online = cloud === "saved" || cloud === "saving";
  const check = server?.check;
  return (
    <Card title="Connected banks">
      <SyncCheck />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <p className="text-xs text-zinc-500">New accounts start as &ldquo;Needs assignment&rdquo;; you pick each one&apos;s company above.</p>
        <button className={buttonClass} onClick={connect} disabled={!status?.configured || busy !== null}>
          {busy === "new" ? "Connecting…" : "Connect bank or card"}
        </button>
      </div>
      {server && (
        <p className="mb-3 text-xs" data-testid="plaid-status">
          {!status?.configured ? (
            <span className="text-rose-600 dark:text-rose-400">Plaid isn&apos;t set up: no keys are saved for this site.</span>
          ) : check?.ok === false ? (
            <span className="text-rose-600 dark:text-rose-400">
              Plaid keys are saved ({status.env === "production" ? "Production" : "Sandbox"}) but Plaid refused them: {check.error}
            </span>
          ) : (
            <span className="text-zinc-500">
              Plaid {status.env === "production" ? "Production (your real banks)" : "Sandbox (test banks)"}
              {check?.ok ? " · keys checked and working" : ""}
              {server.fromSettings ? " · keys from Vercel settings" : server.site ? " · keys saved for your whole site" : " · keys saved on this device"}
            </span>
          )}
        </p>
      )}
      {server && !server.fromSettings && (notReady || editingKeys ? (
        <PlaidKeysForm onSaved={keysSaved} onCancel={local || shared ? () => setEditingKeys(false) : undefined} />
      ) : (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <button className="underline hover:text-brand" onClick={() => setEditingKeys(true)} disabled={busy !== null}>
            Change keys
          </button>
          <button className="underline hover:text-rose-600" onClick={removeKeys} disabled={busy !== null}>
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
      {waiting && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{waiting}</p>}
      {briefingReady && onBriefing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm" data-testid="briefing-ready">
          <span className="min-w-0 flex-1">Your bank is connected and your Financial Briefing is ready.</span>
          <button className={buttonClass} onClick={onBriefing}>
            Open your briefing
          </button>
        </div>
      )}
      {data.bankLinks.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800" data-testid="sync-bar">
          <p className="min-w-0 flex-1 text-xs text-zinc-500">
            {syncing > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">Syncing {syncing} bank{syncing === 1 ? "" : "s"} now…</span>
            ) : (
              "Banks sync on their own when you open Money in this browser."
            )}{" "}
            <span data-testid="link-storage">
              {online
                ? "These connections are saved online, so any device you sign in on can sync them."
                : cloud === "loading"
                  ? ""
                  : "Online saving isn't working right now, so these connections are saved in this browser only. This browser can still sync them."}
            </span>
          </p>
          <button className={buttonClass} onClick={syncEvery} disabled={busy !== null || syncing > 0}>
            {busy === "all" || syncing > 0 ? "Syncing…" : "Sync all now"}
          </button>
        </div>
      )}
      {data.bankLinks.length === 0 ? (
        <Empty>Connect your bank and card accounts to bring in balances and transactions automatically. You sign in to your bank inside Plaid&apos;s own window; Maverick never sees your bank password.</Empty>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.bankLinks.map((l) => {
            const accts = data.accounts.filter((a) => a.plaid?.linkId === l.id);
            const loginNeeded = l.errorCode === "ITEM_LOGIN_REQUIRED" || l.errorCode === "PENDING_EXPIRATION" || l.errorCode === "PENDING_DISCONNECT";
            const badSeal = l.errorCode === "BAD_SEAL";
            return (
              <li key={l.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium">
                    {l.institution || "Bank"}
                    <ScopeBadge item={l} />
                  </p>
                  {l.error && !badSeal && (
                    <button className={ghostButtonClass} onClick={() => fix(l)} disabled={busy !== null}>
                      Sign in again
                    </button>
                  )}
                  <button className={ghostButtonClass} onClick={() => sync(l)} disabled={busy !== null || running.has(l.id)}>
                    {busy === l.id || running.has(l.id) ? "Syncing…" : "Sync now"}
                  </button>
                  <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => disconnect(l)} disabled={busy !== null}>
                    Disconnect
                  </button>
                </div>
                <p className="text-xs text-zinc-500">
                  {l.error ? (
                    <span className="text-rose-600 dark:text-rose-400">
                      {loginNeeded ? "The bank needs you to sign in again. " : badSeal ? "This connection was made with different Plaid keys; disconnect it and connect again. " : "Last sync failed: "}
                      {!loginNeeded && !badSeal && l.error}
                    </span>
                  ) : (
                    <>
                      {timeAgo(l.lastSync)}
                      {l.historyStatus && l.historyStatus !== HISTORY_DONE && " · Plaid is still loading older history"}
                      {l.historyStatus === HISTORY_DONE && " · all the history the bank provides has arrived"}
                    </>
                  )}
                </p>
                {accts.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {accts.map((a) => {
                      const ts = data.transactions.filter((t) => t.accountId === a.id && t.plaidId);
                      const dates = ts.map((t) => t.date).sort();
                      const bb = a.bankBalance;
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-zinc-50 px-2 py-1.5 text-sm dark:bg-zinc-900">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {a.name}
                              {a.last4 && <span className="text-zinc-500"> ··{a.last4}</span>}
                            </span>
                            <span className="block text-xs text-zinc-500">
                              {bb ? `${bb.available !== null ? `${fmtMoney(bb.available)} available` : `${fmtMoney(bb.current ?? 0)} balance`} as of ${new Date(bb.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "No balance yet"}
                              {" · "}
                              {dates.length ? `bank feed ${dates[0]} to ${dates[dates.length - 1]} (${ts.length})` : "no bank-feed transactions yet"}
                            </span>
                          </span>
                          <select
                            aria-label={`Whose is ${a.name}`}
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                            value={a.scope ?? "personal"}
                            onChange={(e) => moveAccount(a.id, e.target.value as Scope)}
                          >
                            {SCOPES.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const fmtMoney = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-ember/50";

/** Where you paste your Plaid keys. They're checked with Plaid, then saved sealed on this device. */
function PlaidKeysForm({ onSaved, onCancel }: { onSaved: (r: KeysResult) => void; onCancel?: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState("production");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      onSaved(await api<KeysResult>("keys", { clientId, secret, env, keys: undefined }));
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
          . They&apos;re checked with Plaid and saved locked for your whole site, so you only enter them once.
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
          <option value="production">Production (your real banks)</option>
          <option value="sandbox">Sandbox (test banks, made-up data)</option>
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

/* ---------------- Sync check ---------------- */

type Health = {
  build: string;
  database: { ok: boolean; code?: string; retry?: boolean; text?: string; rev?: number; sizeKb?: number };
  keys: { source: string; env: string | null; ok?: boolean; code?: string; problem?: string };
  money: { accounts: number; bankAccounts: number; transactions: number; bankTransactions: number } | null;
  links: {
    id: string;
    institution: string;
    lastSync: string | null;
    historyStatus: string | null;
    savedError: string | null;
    accounts: number;
    bankTransactions: number;
    first: string | null;
    last: string | null;
    tokenOk?: boolean;
    bankError?: string | null;
  }[];
};

type Line = { ok: boolean; text: string };

function healthLines(h: Health): Line[] {
  const out: Line[] = [];
  out.push(h.database.ok ? { ok: true, text: "Online database: connected" } : { ok: false, text: h.database.text ?? "The online database isn't reachable." });
  if (h.database.retry) return out; // still checking; the rest waits for the database
  if (h.keys.problem) out.push({ ok: false, text: h.keys.problem });
  else if (h.keys.ok) out.push({ ok: true, text: `Plaid keys: working (${h.keys.env === "production" ? "Production" : "Sandbox"}, ${h.keys.source === "vercel" ? "from Vercel settings" : h.keys.source === "site" ? "saved for the site" : "saved on this device"})` });
  if (h.database.ok && h.links.length === 0) out.push({ ok: false, text: "The online money data has no bank connections saved in it." });
  for (const l of h.links) {
    const name = l.institution || "A bank";
    if (l.tokenOk === false) out.push({ ok: false, text: `${name}: this connection was made with different Plaid keys than the server has now, so Plaid can't be asked for it. It has to be connected again.` });
    else if (l.bankError === "ITEM_LOGIN_REQUIRED" || l.bankError === "PENDING_EXPIRATION")
      out.push({ ok: false, text: `${name}: Plaid says the bank needs you to sign in again (${l.bankError}).` });
    else if (l.bankError) out.push({ ok: false, text: `${name}: Plaid reports ${l.bankError}.` });
    else if (!l.lastSync) out.push({ ok: false, text: `${name}: connected but not synced yet.${h.keys.problem ? " It syncs once the keys problem above is fixed." : " Refresh now syncs it."}` });
    else
      out.push({
        ok: l.bankTransactions > 0,
        text: `${name}: ${l.accounts} account${l.accounts === 1 ? "" : "s"}, ${l.bankTransactions.toLocaleString()} bank transactions${l.first ? ` (${l.first} to ${l.last})` : ""}, synced ${timeAgo(l.lastSync).replace(/^Synced /, "")}${l.historyStatus === "NOT_READY" ? ", Plaid is still preparing the history" : ""}`,
      });
  }
  return out;
}

/** The server's own check of everything the bank sync needs, with Refresh now. */
export function SyncCheck({ compact = false }: { compact?: boolean }) {
  const [h, setH] = useState<Health | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const activity = useSyncActivity();
  const check = useRef(async () => {
    try {
      // A busy database is checked again a few times before it counts as a problem.
      let r = await api<Health>("health", {});
      for (let i = 1; r.database.retry && i < DB_TRIES; i++) {
        setH(r);
        await new Promise((res) => setTimeout(res, 1500 * 2 ** (i - 1)));
        r = await api<Health>("health", {});
      }
      setH(r);
      setFailed("");
    } catch (e) {
      setFailed((e as Error).message);
    }
  });
  useEffect(() => {
    void check.current();
  }, []);
  // Check again after each sync finishes.
  const last = activity.lastRun?.at;
  useEffect(() => {
    if (last) void check.current();
  }, [last]);

  const lines = h ? healthLines(h) : [];
  const bad = lines.filter((l) => !l.ok);
  // The sync's own problem, unless the check already says the same thing about the keys.
  const extra = activity.problem && !(h?.keys.problem && /KEYS|CONFIGURED/.test(activity.problem.code)) ? [{ ok: false, text: activity.problem.text }] : [];
  bad.unshift(...extra);
  if (compact && h && !bad.length && !failed) return null;

  async function refresh() {
    setBusy(true);
    await syncAll();
    await check.current();
    setBusy(false);
  }

  return (
    <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${bad.length || failed ? "border-rose-500/40 bg-rose-500/5" : "border-zinc-200 dark:border-zinc-800"}`} data-testid="sync-check">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">
          {!h && !failed ? "Checking the bank sync…" : bad.length || failed ? "Bank sync needs attention" : "Bank sync check: everything is working"}
        </p>
        <button className={ghostButtonClass} onClick={refresh} disabled={busy || activity.syncing > 0}>
          {busy || activity.syncing > 0 ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
      {failed && <p className="mt-1 text-rose-600 dark:text-rose-400">The check itself couldn&apos;t run: {failed}</p>}
      <ul className="mt-1 flex flex-col gap-0.5">
        {(compact ? bad : [...extra, ...lines]).map((l, i) => (
          <li key={i} className={l.ok ? "text-zinc-500" : "text-rose-600 dark:text-rose-400"}>
            {l.ok ? "✓ " : "✗ "}
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
