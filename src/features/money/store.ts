"use client";

import { useSyncExternalStore } from "react";
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
  save(update(read()));
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
    save(normalize(json.data));
    dirty = false;
    setCloud("saved");
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

async function push() {
  if (pushing || !dirty) return;
  if (!loaded) return void startCloud(); // pushed once the database's copy is in
  pushing = true;
  dirty = false;
  setCloud("saving");
  try {
    const res = await fetch("/api/money", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rev, data: read() }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409) {
      // Saved from another device first: take that version.
      setRev(json.rev);
      save(normalize(json.data));
      setCloud("saved");
    } else if (!res.ok) {
      cloudError = json.error ?? "";
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
