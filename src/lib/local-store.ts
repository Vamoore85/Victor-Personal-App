"use client";

import { useSyncExternalStore } from "react";

/**
 * A small JSON store kept in this browser's localStorage, shared by every
 * component that reads the same key. Returns null during server render.
 */
export function createLocalStore<T>(key: string, empty: T, normalize: (raw: unknown) => T = (r) => r as T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  function read(): T {
    if (cache) return cache;
    try {
      const raw = window.localStorage.getItem(key);
      cache = raw ? normalize(JSON.parse(raw)) : empty;
    } catch {
      cache = empty;
    }
    return cache;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
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

  function set(update: (prev: T) => T) {
    cache = update(read());
    try {
      window.localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      // Storage full or blocked: keep the in-memory copy for this session.
    }
    listeners.forEach((l) => l());
  }

  function use(): T | null {
    return useSyncExternalStore(subscribe, read, () => null);
  }

  return { use, set, read };
}

export function newId() {
  return crypto.randomUUID();
}
