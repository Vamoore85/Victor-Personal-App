"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_DATA, type MoneyData } from "./types";

// All money data lives in this browser's localStorage. Nothing is sent anywhere.
const STORAGE_KEY = "maverick.money.v1";

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
    bills: Array.isArray(v.bills) ? v.bills : [],
    institutions: Array.isArray(v.institutions) ? v.institutions : [],
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
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

export function setMoneyData(update: (prev: MoneyData) => MoneyData) {
  const next = update(read());
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: keep the in-memory copy for this session.
  }
  listeners.forEach((l) => l());
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
