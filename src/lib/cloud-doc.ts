"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * A JSON document saved online (/api/docs/<key>) so it's the same on every
 * device, with a copy in this browser so it opens instantly and works offline.
 * When another device saved first, `merge` combines the two copies and the
 * result is saved again, so nothing typed on either device is lost.
 */
export type CloudStatus = "loading" | "saved" | "saving" | "offline" | "local";

export function createCloudDoc<T>(key: string, empty: T, normalize: (raw: unknown) => T, merge: (mine: T, theirs: T) => T) {
  const storageKey = `maverick.${key}.v1`;
  let cache: T | null = null;
  let rev = 0;
  let status: CloudStatus = "loading";
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  const listeners = new Set<() => void>();
  let snap: { data: T; status: CloudStatus } = { data: empty, status };
  const emit = () => {
    snap = { data: read(), status };
    listeners.forEach((l) => l());
  };

  function read(): T {
    if (cache) return cache;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const v = raw ? JSON.parse(raw) : null;
      cache = v ? normalize(v.data) : empty;
      rev = v?.rev ?? 0;
      dirty = !!v?.dirty;
    } catch {
      cache = empty;
    }
    return cache;
  }
  function keepLocal() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ rev, dirty, data: cache }));
    } catch {}
  }

  async function push() {
    timer = null;
    if (status === "local") return keepLocal();
    status = "saving";
    emit();
    try {
      for (let tries = 0; tries < 3; tries++) {
        const res = await fetch(`/api/docs/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev, data: cache }) });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409) {
          cache = merge(read(), normalize(json.data));
          rev = json.rev;
          continue;
        }
        if (!res.ok) throw new Error(json.error);
        if (json.configured === false) {
          status = "local";
          break;
        }
        rev = json.rev;
        dirty = false;
        status = "saved";
        break;
      }
    } catch {
      status = "offline";
    }
    keepLocal();
    emit();
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    read();
    try {
      const res = await fetch(`/api/docs/${key}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (json.configured === false) {
        status = "local";
      } else {
        const theirs = json.data == null ? empty : normalize(json.data);
        if (dirty) {
          // Changes made here while offline: combine them with the online copy and save.
          cache = merge(read(), theirs);
          rev = json.rev;
          void push();
          return;
        }
        cache = theirs;
        rev = json.rev;
        status = "saved";
      }
    } catch {
      status = "offline";
    }
    keepLocal();
    emit();
  }

  function set(update: (prev: T) => T) {
    cache = update(read());
    dirty = true;
    keepLocal();
    emit();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void push(), 600);
  }

  function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  }
  const serverSnap = { data: empty, status: "loading" as CloudStatus };
  function use() {
    useEffect(() => {
      void load();
    }, []);
    return useSyncExternalStore(
      subscribe,
      () => (snap.data === read() && snap.status === status ? snap : (snap = { data: read(), status })),
      () => serverSnap,
    );
  }
  return { use, set };
}
