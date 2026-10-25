"use client";

import { useSyncExternalStore } from "react";
import { autoSort } from "./books";
import { EMPTY_DATA, type MoneyData } from "./types";

// Money data is saved in the app's database (/api/money) so every device sees
// the same books, and kept in this browser's localStorage as a working copy
// for fast loading and for when the database isn't set up or reachable.
const STORAGE_KEY = "maverick.money.v1";
const REV_KEY = "maverick.money.rev"; // database revision the local copy is based on

let cache: MoneyData | null = null;
const listeners = new Set<() => void>();

function read(): MoneyData {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? normalize(JSON.parse(raw)) : EMPTY_DATA;
  } catch {
    cache = EMPTY_DATA;
  }
  return cache;
}

function normalize(value: unknown): MoneyData {
  const v = (value ?? {}) as Partial<MoneyData>;
  return {
    version: 1,
    accounts: Array.isArray(v.accounts) ? v.accounts : [],
    transactions: Array.isArray(v.transactions) ? v.transactions : [],
    budgets: Array.isArray(v.budgets) ? v.budgets : [],
    rules: Array.isArray(v.rules) ? v.rules : [],
    bills: Array.isArray(v.bills) ? v.bills : [],
    institutions: Array.isArray(v.institutions) ? v.institutions : [],
    bankLinks: Array.isArray(v.bankLinks) ? v.bankLinks : [],
    receipts: Array.isArray(v.receipts) ? v.receipts : [],
    taxDocs: Array.isArray(v.taxDocs) ? v.taxDocs : [],
    recurring: Array.isArray(v.recurring) ? v.recurring : [],
    billScan: v.billScan && typeof v.billScan === "object" ? v.billScan : undefined,
    // Which account clean-up rules already ran (accounts-fix.ts); dropping it would rerun them on every save.
    accountRules: typeof v.accountRules === "number" ? v.accountRules : undefined,
    // Bills already added from your workbook (lib/pending-bills.ts); dropping it would bring deleted ones back.
    billImports: Array.isArray(v.billImports) ? v.billImports : undefined,
    emailBillImports: Array.isArray(v.emailBillImports) ? v.emailBillImports : undefined,
    siteImports: Array.isArray(v.siteImports) ? v.siteImports : undefined,
    siteCostRules: typeof v.siteCostRules === "number" ? v.siteCostRules : undefined,
    docImports: Array.isArray(v.docImports) ? v.docImports : [],
    briefings: Array.isArray(v.briefings) ? v.briefings : [],
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startCloud();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function save(next: MoneyData) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: keep the in-memory copy for this session.
  }
  listeners.forEach((l) => l());
}

export function setMoneyData(update: (prev: MoneyData) => MoneyData) {
  save(autoSort(update(read())));
  schedulePush();
}

/* ---------------- Cloud sync ---------------- */

export type CloudState = "off" | "loading" | "saving" | "saved" | "error";
let cloud: CloudState = "loading";
let cloudError = ""; // why the last save failed, from the server
let rev = 0;
let started = false;
let loaded = false; // the database's copy has been read
let dirty = false; // local changes not yet in the database
let pushing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const cloudListeners = new Set<() => void>();

function setCloud(state: CloudState) {
  cloud = state;
  cloudListeners.forEach((l) => l());
}

function storedRev() {
  try {
    return Number(window.localStorage.getItem(REV_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setRev(n: number) {
  rev = n;
  try {
    window.localStorage.setItem(REV_KEY, String(n));
  } catch {
    /* fine */
  }
}

/**
 * Bank connections can't be recreated without signing in to the bank again,
 * so when the database's copy wins, any connection only this browser has (with
 * its accounts and transactions) is kept and saved back rather than dropped.
 */
function keepLocalLinks(server: MoneyData, local: MoneyData): { data: MoneyData; added: boolean } {
  const known = new Set(server.bankLinks.map((l) => l.id));
  const extra = local.bankLinks.filter((l) => !known.has(l.id));
  if (!extra.length) return { data: server, added: false };
  const ids = new Set(extra.map((l) => l.id));
  const haveAccounts = new Set(server.accounts.map((a) => a.id));
  const accounts = local.accounts.filter((a) => a.plaid && ids.has(a.plaid.linkId) && !haveAccounts.has(a.id));
  const acctIds = new Set(accounts.map((a) => a.id));
  const haveTxns = new Set(server.transactions.map((t) => t.id));
  const transactions = local.transactions.filter((t) => acctIds.has(t.accountId) && !haveTxns.has(t.id));
  return {
    data: { ...server, bankLinks: [...server.bankLinks, ...extra], accounts: [...server.accounts, ...accounts], transactions: [...server.transactions, ...transactions] },
    added: true,
  };
}

/** The request body, gzipped when the browser can: a few years of bank history is several megabytes as JSON. */
async function packBody(text: string): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  if (typeof CompressionStream === "undefined" || text.length < 100_000) return { body: text, headers: { "Content-Type": "application/json" } };
  const zipped = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return { body: zipped, headers: { "Content-Type": "application/octet-stream", "X-Body-Encoding": "gzip" } };
}

const hasContent = (d: MoneyData) => d.accounts.length + d.transactions.length + d.bills.length + d.institutions.length > 0;

async function startCloud() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const res = await fetch("/api/money", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      cloudError = json.error ?? "";
      throw new Error(json.error);
    }
    if (!json.configured) return setCloud("off");
    const local = read();
    loaded = true;
    if (json.data === null) {
      // Nothing in the database yet: this device's data becomes the first copy.
      setRev(0);
      if (hasContent(local)) {
        dirty = true;
        await push();
      } else setCloud("saved");
      return;
    }
    if (dirty && storedRev() === json.rev) {
      // Edited here before the database answered, and nothing changed there since.
      setRev(json.rev);
      await push();
      return;
    }
    // The database is the source of truth.
    setRev(json.rev);
    const fromDb = normalize(json.data);
    const kept = keepLocalLinks(fromDb, local);
    const sorted = autoSort(kept.data);
    save(sorted);
    dirty = false;
    setCloud("saved");
    if (sorted !== fromDb) schedulePush(); // save the newly sorted categories (or kept connections) back
  } catch {
    started = false; // retry on the next change
    loaded = false;
    setCloud("error");
  }
}

function schedulePush() {
  dirty = true;
  if (cloud === "off") return;
  clearTimeout(timer);
  timer = setTimeout(() => void push(), 800);
}

let pushJob: Promise<void> | null = null;

function push(): Promise<void> {
  if (pushing && pushJob) return pushJob;
  pushJob = pushNow().finally(() => (pushJob = null));
  return pushJob;
}

/** Saves anything waiting, now. Resolves once the database has it (or saving failed). */
export async function flushCloud() {
  clearTimeout(timer);
  if (pushJob) await pushJob;
  if (dirty && loaded && cloud !== "off") await push();
}

/**
 * Reads the database's copy again, after the server changed it (a bank sync
 * runs there). Anything still unsaved here is saved first.
 */
export async function reloadFromCloud(): Promise<boolean> {
  await flushCloud();
  try {
    const res = await fetch("/api/money", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.configured || json.data === null) return false;
    setRev(json.rev);
    const kept = keepLocalLinks(normalize(json.data), read());
    save(autoSort(kept.data));
    loaded = true;
    dirty = kept.added;
    setCloud(dirty ? "saving" : "saved");
    if (dirty) schedulePush();
    return true;
  } catch {
    return false;
  }
}

/** True once this page has the database's copy, so the server and this browser agree. */
export const cloudReady = () => loaded && cloud !== "off";

async function pushNow() {
  if (pushing || !dirty) return;
  if (!loaded) return void startCloud(); // pushed once the database's copy is in
  pushing = true;
  dirty = false;
  setCloud("saving");
  try {
    const packed = await packBody(JSON.stringify({ rev, data: read() }));
    const res = await fetch("/api/money", { method: "PUT", ...packed });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409) {
      // Saved from another device first: take that version, keeping any bank connection only this browser has.
      setRev(json.rev);
      const kept = keepLocalLinks(normalize(json.data), read());
      save(kept.data);
      if (kept.added) dirty = true;
      setCloud(kept.added ? "saving" : "saved");
    } else if (!res.ok) {
      cloudError = json.error ?? (res.status === 413 ? "Your money data is too large to save in one go." : `The server answered ${res.status}.`);
      dirty = true;
      setCloud("error");
    } else {
      setRev(json.rev);
      setCloud(dirty ? "saving" : "saved");
    }
  } catch {
    dirty = true;
    setCloud("error");
  } finally {
    pushing = false;
    if (dirty && cloud !== "error") schedulePush();
  }
}

/** The current money data outside React (null before the browser is ready). */
export function getMoneyData(): MoneyData | null {
  return typeof window === "undefined" ? null : read();
}

/** Changes made here that the database hasn't got yet; a reload now would lose them. */
export const hasUnsavedChanges = () => dirty || pushing;

/** Why saving online failed, when the server said. */
export const cloudErrorMessage = () => cloudError;

/** Saving status for the header: off (no database), saving, saved or error. */
export function useCloudState(): CloudState {
  return useSyncExternalStore(
    (l) => {
      cloudListeners.add(l);
      return () => cloudListeners.delete(l);
    },
    () => cloud,
    () => "loading",
  );
}

export function retryCloud() {
  if (!started) void startCloud();
  else {
    dirty = true;
    void push();
  }
}

export function importMoneyData(json: string) {
  const parsed = normalize(JSON.parse(json));
  setMoneyData(() => parsed);
}

/** Returns null during server render, before localStorage is readable. */
export function useMoneyData(): MoneyData | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function newId() {
  return crypto.randomUUID();
}
