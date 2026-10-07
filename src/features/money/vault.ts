"use client";

import { useSyncExternalStore } from "react";

/*
 * Password vault.
 *
 * Logins are encrypted in the browser with AES-256-GCM using a key derived
 * from the master password (PBKDF2-SHA256, 600k iterations, random salt).
 * Only the encrypted blob is written to localStorage or included in backups.
 * The key and the decrypted logins live in memory only while unlocked, and
 * are dropped on lock, auto-lock or page reload. There is no recovery: a
 * forgotten master password means the vault cannot be opened.
 */

const STORAGE_KEY = "maverick.vault.v1";
const ITERATIONS = 600_000;
export const AUTO_LOCK_MINUTES = 5;

export type VaultEntry = {
  id: string;
  institutionId: string;
  label: string; // e.g. "Online banking", "Joint account"
  username: string;
  password: string;
  url: string; // sign-in page, optional
  notes: string; // security questions, PINs, recovery codes
};

export type EncryptedVault = {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 AES-GCM ciphertext of { entries }
};

export type VaultState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "locked" }
  | { status: "unlocked"; entries: VaultEntry[] };

let state: VaultState | null = null;
let key: CryptoKey | null = null;
let salt: Uint8Array | null = null;
let iterations = ITERATIONS;
// A random key, stored inside the encrypted vault, that other private pages
// (Legacy) encrypt with. Changing the master password re-wraps it for free.
let dataKey: CryptoKey | null = null;
let dataKeyRaw = "";

async function loadDataKey(raw?: string) {
  const bytes = raw ? unb64(raw) : crypto.getRandomValues(new Uint8Array(32));
  dataKeyRaw = b64(bytes);
  dataKey = await crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  return !raw; // true when newly created and not yet saved
}
const listeners = new Set<() => void>();

const b64 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readBlob(): EncryptedVault | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EncryptedVault) : null;
  } catch {
    return null;
  }
}

function emit(next: VaultState) {
  state = next;
  listeners.forEach((l) => l());
}

function getSnapshot(): VaultState {
  if (!state) state = readBlob() ? { status: "locked" } : { status: "none" };
  return state;
}

const serverSnapshot: VaultState = { status: "loading" };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVault(): VaultState {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

async function deriveKey(password: string, saltBytes: Uint8Array, iters: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes as BufferSource, iterations: iters },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function writeEntries(entries: VaultEntry[]) {
  if (!key || !salt) throw new Error("Vault is locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ entries, dataKey: dataKeyRaw }));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const blob: EncryptedVault = {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: b64(salt),
    iv: b64(iv),
    data: b64(cipher),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

export async function createVault(password: string) {
  salt = crypto.getRandomValues(new Uint8Array(16));
  iterations = ITERATIONS;
  key = await deriveKey(password, salt, iterations);
  await loadDataKey();
  await writeEntries([]);
  emit({ status: "unlocked", entries: [] });
}

/** Returns false when the master password is wrong. */
export async function unlockVault(password: string): Promise<boolean> {
  const blob = readBlob();
  if (!blob) return false;
  const s = unb64(blob.salt);
  const k = await deriveKey(password, s, blob.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) as BufferSource }, k, unb64(blob.data) as BufferSource);
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as { entries?: VaultEntry[]; dataKey?: string };
    key = k;
    salt = s;
    iterations = blob.iterations;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    if (await loadDataKey(parsed.dataKey)) await writeEntries(entries);
    emit({ status: "unlocked", entries });
    return true;
  } catch {
    return false;
  }
}

export function lockVault() {
  key = null;
  salt = null;
  dataKey = null;
  dataKeyRaw = "";
  if (state?.status === "unlocked") emit({ status: "locked" });
}

export async function saveVaultEntries(update: (prev: VaultEntry[]) => VaultEntry[]) {
  if (state?.status !== "unlocked") return;
  const entries = update(state.entries);
  await writeEntries(entries);
  emit({ status: "unlocked", entries });
}

export async function changeMasterPassword(current: string, next: string): Promise<boolean> {
  const blob = readBlob();
  if (state?.status !== "unlocked" || !blob) return false;
  const entries = state.entries;
  try {
    const k = await deriveKey(current, unb64(blob.salt), blob.iterations);
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) as BufferSource }, k, unb64(blob.data) as BufferSource);
  } catch {
    return false;
  }
  salt = crypto.getRandomValues(new Uint8Array(16));
  iterations = ITERATIONS;
  key = await deriveKey(next, salt, iterations);
  await writeEntries(entries);
  emit({ status: "unlocked", entries });
  return true;
}

/** The still-encrypted vault, for including in a backup file. */
export function exportEncryptedVault(): EncryptedVault | null {
  return readBlob();
}

export function importEncryptedVault(blob: unknown) {
  const v = blob as Partial<EncryptedVault> | null;
  if (!v || typeof v.salt !== "string" || typeof v.iv !== "string" || typeof v.data !== "string") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  key = null;
  salt = null;
  dataKey = null;
  dataKeyRaw = "";
  emit({ status: "locked" });
}

export function generatePassword(length = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?";
  const out: string[] = [];
  const buf = new Uint32Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    // Rejection sampling keeps every character equally likely.
    const limit = Math.floor(0x100000000 / chars.length) * chars.length;
    if (buf[0] < limit) out.push(chars[buf[0] % chars.length]);
  }
  return out.join("");
}

/*
 * General-purpose encryption with the unlocked vault key, for other private
 * pages (Legacy). Output is base64 iv + ciphertext; it needs the same master
 * password to read.
 */
export type Sealed = { iv: string; data: string };

export function isVaultUnlocked() {
  return state?.status === "unlocked" && dataKey !== null;
}

export async function sealJson(value: unknown): Promise<Sealed> {
  if (!dataKey) throw new Error("Vault is locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, new TextEncoder().encode(JSON.stringify(value))));
  return { iv: b64(iv), data: b64(cipher) };
}

export async function openJson<T>(sealed: Sealed): Promise<T> {
  if (!dataKey) throw new Error("Vault is locked");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) as BufferSource }, dataKey, unb64(sealed.data) as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** Encrypts a file: the result is 12 bytes of IV followed by the ciphertext. */
export async function sealBlob(blob: Blob): Promise<Blob> {
  if (!dataKey) throw new Error("Vault is locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, await blob.arrayBuffer());
  return new Blob([iv, cipher], { type: "application/octet-stream" });
}

export async function openBlob(blob: Blob, type: string): Promise<Blob> {
  if (!dataKey) throw new Error("Vault is locked");
  const buf = new Uint8Array(await blob.arrayBuffer());
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, dataKey, buf.slice(12));
  return new Blob([plain], { type });
}
