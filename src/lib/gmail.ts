import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbConfigured, readDoc, writeDoc } from "@/lib/db";
import { extract, mergeFound, RULES, type EmailItem, type EmailStatus, type RawMessage } from "@/features/gmail/parse";
import type { Scope } from "@/features/money/types";

/*
 * Read-only Gmail link that finds bills and receipts.
 *
 * Google's OAuth client ID and secret come from Vercel (GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET) or from the form on the Email bills page. The keys
 * and Google's sign-in tokens are sealed with a key derived from
 * APP_PASSWORD, kept in the database and never sent to the browser.
 *
 * The only permission asked for is gmail.readonly. Nothing here sends,
 * deletes, moves or marks mail. A scan only searches the date range you pick
 * for messages that look like bills or receipts, and keeps only the facts
 * parse.ts pulls out of each one. Nothing from your mail is logged.
 */

export type GoogleKeys = { clientId: string; secret: string };
type Tokens = { access: string; accessExpires: number; refresh: string; scope: string };
type Connection = { sealed: string; email: string; connectedAt: string };
export type ScanInfo = { from: string; to: string; at: string; looked: number; kept: number; added: number; duplicates: number; capped: boolean; rechecked?: number; movedOut?: number };
export type EmailDoc = { items: EmailItem[]; lastScan: ScanInfo | null };

const KEYS_DOC = "gmail-keys";
const CONNECTION_DOC = "gmail-connection";
export const ITEMS_DOC = "gmail-bills";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const MAX_DAYS = 180;
export const MAX_MESSAGES = 400; // emails read per scan; the next scan carries on with the rest
const MAX_LISTED = 3000; // ids are cheap to list, so emails already saved don't use up a scan
const MAX_RECHECK = 150;

export class GmailError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const sealKey = () => createHash("sha256").update(`maverick-gmail:${process.env.APP_PASSWORD}`).digest();

function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function unseal<T>(sealed: string): T {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", sealKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as T;
}

/** Overwrites a small server-only document, retrying if another save landed first. */
async function put(key: string, update: (current: unknown) => unknown) {
  for (let i = 0; i < 3; i++) {
    const current = await readDoc(key);
    const saved = await writeDoc(key, current?.rev ?? 0, update(current?.data ?? null));
    if (saved.ok) return;
  }
  throw new GmailError("Couldn't save to the database. Try again.", 503);
}

function needDb() {
  if (!dbConfigured()) throw new GmailError("Gmail needs the online database, which isn't set up.", 503);
}

export const keysFromSettings = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export async function getKeys(): Promise<GoogleKeys | null> {
  if (keysFromSettings()) return { clientId: process.env.GOOGLE_CLIENT_ID!, secret: process.env.GOOGLE_CLIENT_SECRET! };
  if (!dbConfigured()) return null;
  const sealed = ((await readDoc(KEYS_DOC))?.data as { sealed?: string } | null)?.sealed;
  if (!sealed) return null;
  try {
    return unseal<GoogleKeys>(sealed);
  } catch {
    return null; // the site password changed; enter the keys again
  }
}

export async function saveKeys(keys: GoogleKeys) {
  needDb();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(keys.clientId)) throw new GmailError("That doesn't look like a Google client ID. It ends in .apps.googleusercontent.com.");
  await put(KEYS_DOC, () => ({ sealed: seal(keys), savedAt: new Date().toISOString() }));
}

export const redirectUri = (origin: string) => `${origin}/api/gmail/callback`;

/** A PKCE code challenge for the verifier kept in a cookie during sign-in. */
export const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function authorizeUrl(keys: GoogleKeys, origin: string, state: string, verifier: string) {
  const q = new URLSearchParams({
    client_id: keys.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(origin),
    state,
    access_type: "offline", // a refresh token, so scans work later without signing in again
    prompt: "consent",
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenCall(keys: GoogleKeys, form: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: keys.clientId, client_secret: keys.secret, ...form }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === "invalid_client") throw new GmailError("Google didn't accept the client ID or secret. Enter them again.", 400);
    if (json.error === "invalid_grant") throw new GmailError("Google signed this site out of Gmail. Press Connect Gmail again.", 401);
    throw new GmailError(`Google sign-in failed (${json.error || res.status}).`, 502);
  }
  return {
    access: String(json.access_token),
    accessExpires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    refresh: json.refresh_token ? String(json.refresh_token) : "",
    scope: String(json.scope ?? ""),
  };
}

async function readConnection(): Promise<{ conn: Connection; tokens: Tokens } | null> {
  if (!dbConfigured()) return null;
  const conn = (await readDoc(CONNECTION_DOC))?.data as Connection | null;
  if (!conn?.sealed) return null;
  try {
    return { conn, tokens: unseal<Tokens>(conn.sealed) };
  } catch {
    return null;
  }
}

const saveConnection = (tokens: Tokens, email: string, connectedAt: string) =>
  put(CONNECTION_DOC, () => ({ sealed: seal(tokens), email, connectedAt }) satisfies Connection);

async function api<T>(tokens: Tokens, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${tokens.access}` }, cache: "no-store" });
  if (res.status === 401) throw new GmailError("Google signed this site out of Gmail. Press Connect Gmail again.", 401);
  if (res.status === 403) throw new GmailError("Google refused the request. Check that the Gmail API is turned on for your Google Cloud project.", 403);
  if (!res.ok) throw new GmailError(`Gmail returned an error (${res.status}).`, 502);
  return (await res.json()) as T;
}

/** Finishes the sign-in Google redirected back with. */
export async function finishConnect(origin: string, code: string, verifier: string) {
  needDb();
  const keys = await getKeys();
  if (!keys) throw new GmailError("Add the Google keys first.");
  const t = await tokenCall(keys, { grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), code_verifier: verifier });
  if (!t.scope.split(" ").includes(SCOPE)) throw new GmailError("Google didn't give permission to read Gmail. Press Connect Gmail and tick the Gmail box.");
  if (!t.refresh) throw new GmailError("Google didn't give a lasting sign-in. Press Connect Gmail again.");
  const profile = await api<{ emailAddress?: string }>(t, "/profile");
  await saveConnection(t, profile.emailAddress ?? "", new Date().toISOString());
}

async function freshTokens(keys: GoogleKeys) {
  const found = await readConnection();
  if (!found) throw new GmailError("Gmail isn't connected.", 409);
  const { conn, tokens } = found;
  if (tokens.accessExpires - Date.now() > 60_000) return tokens;
  const t = await tokenCall(keys, { grant_type: "refresh_token", refresh_token: tokens.refresh });
  const next: Tokens = { ...t, refresh: t.refresh || tokens.refresh, scope: t.scope || tokens.scope };
  await saveConnection(next, conn.email, conn.connectedAt);
  return next;
}

/** Revokes Maverick's access at Google and forgets the tokens. Bills already found stay. */
export async function disconnect() {
  const found = await readConnection();
  if (found) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: found.tokens.refresh || found.tokens.access }),
    }).catch(() => undefined);
  }
  if (dbConfigured()) await put(CONNECTION_DOC, () => ({}));
}

/** The Gmail address that's connected, or null. */
export const connectedEmail = async () => (await readConnection().catch(() => null))?.conn.email || null;

export async function readItems(): Promise<EmailDoc> {
  if (!dbConfigured()) return { items: [], lastScan: null };
  const d = (await readDoc(ITEMS_DOC))?.data as Partial<EmailDoc> | null;
  return { items: Array.isArray(d?.items) ? d.items : [], lastScan: d?.lastScan ?? null };
}

export async function status() {
  const [keys, found, doc] = await Promise.all([getKeys(), readConnection(), readItems()]);
  return {
    database: dbConfigured(),
    keys: Boolean(keys),
    keysFromSettings: keysFromSettings(),
    connected: Boolean(found),
    email: found?.conn.email || null,
    connectedAt: found?.conn.connectedAt ?? null,
    lastScan: doc.lastScan,
    counts: {
      review: doc.items.filter((i) => i.status === "review").length,
      confirmed: doc.items.filter((i) => i.status === "confirmed").length,
    },
  };
}

/* ---- Scanning ---- */

const gmailDay = (ymd: string) => ymd.replace(/-/g, "/");
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Gmail's own search narrows the range to likely bills and receipts first;
// parse.ts then drops anything that isn't one. Chats, promotions, social and
// forum mail are never searched.
const WORDS = [
  "bill", "statement", "invoice", "receipt", "payment", "\"amount due\"", "\"total due\"", "\"balance due\"",
  "\"payment due\"", "\"due date\"", "autopay", "\"auto pay\"", "premium", "renewal", "\"order confirmation\"", "charged",
];

export function searchQuery(from: string, to: string) {
  return `after:${gmailDay(from)} before:${gmailDay(addDays(to, 1))} -in:chats -in:spam -in:trash -category:promotions -category:social -category:forums {${WORDS.join(" ")}}`;
}

async function inBatches<T, R>(list: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

/** Searches the last `days` days (ending `today`) for bills and receipts and saves what it finds for review. */
export async function scan(days: number, today: string) {
  needDb();
  const keys = await getKeys();
  if (!keys) throw new GmailError("Add the Google keys first.");
  const span = Math.min(MAX_DAYS, Math.max(1, Math.round(days)));
  const from = addDays(today, -(span - 1));
  const tokens = await freshTokens(keys);
  const saved = await readItems();
  const known = new Set(saved.items.map((i) => i.id));
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ q: searchQuery(from, today), maxResults: "500", ...(page ? { pageToken: page } : {}) });
    const res = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(tokens, `/messages?${q}`);
    ids.push(...(res.messages ?? []).map((m) => m.id));
    page = res.nextPageToken;
  } while (page && ids.length < MAX_LISTED);
  const fresh = ids.filter((id) => !known.has(id));

  // Emails found under older rules are read again: still-unreviewed ones the
  // rules now say aren't bills move to "Not bills", and every one gets the
  // link to its exact message.
  const stale = saved.items.filter((i) => (i.rules ?? 0) < RULES).slice(0, MAX_RECHECK);
  const look = fresh.slice(0, MAX_MESSAGES - stale.length);
  const capped = Boolean(page) || fresh.length > look.length;

  const foundAt = new Date().toISOString();
  const read = (id: string) =>
    api<RawMessage>(tokens, `/messages/${encodeURIComponent(id)}?format=full&fields=id,internalDate,payload`)
      .then((m) => ({ ok: true as const, item: extract(m, foundAt) }))
      .catch((e) => {
        if (e instanceof GmailError && e.status === 401) throw e;
        return { ok: false as const, item: null }; // one unreadable message doesn't stop the scan
      });
  const found = (await inBatches(look, 8, read)).map((r) => r.item).filter((x): x is EmailItem => x !== null);
  const again = new Map((await inBatches(stale, 8, (i) => read(i.id))).flatMap((r, n) => (r.ok ? [[stale[n].id, r.item] as const] : [])));

  let info: ScanInfo | null = null;
  await put(ITEMS_DOC, (current) => {
    const d = (current ?? {}) as Partial<EmailDoc>;
    let movedOut = 0;
    const kept = (Array.isArray(d.items) ? d.items : []).map((i) => {
      if (!again.has(i.id)) return i;
      const now = again.get(i.id) ?? null;
      const next: EmailItem = { ...i, rules: RULES, ...(now?.messageId ? { messageId: now.messageId } : {}) };
      // Only items you haven't touched move; anything you reviewed stays as you left it.
      if (!now && i.status === "review" && !i.scope && !i.billId) {
        movedOut++;
        next.status = "ignored";
        next.flags = [...i.flags, `Maverick's updated rules say this isn't a bill or receipt. Press "It is a bill" if it is one.`];
      }
      return next;
    });
    const merged = mergeFound(kept, found);
    info = { from, to: today, at: foundAt, looked: look.length, kept: found.length, added: merged.added, duplicates: merged.duplicates, capped, rechecked: again.size, movedOut };
    return { items: merged.items, lastScan: info } satisfies EmailDoc;
  });
  console.log(`gmail scan: days=${span} listed=${ids.length} looked=${look.length} kept=${found.length} rechecked=${again.size} capped=${capped}`); // counts only
  return info!;
}

/* ---- Your review ---- */

const SCOPES: Scope[] = ["personal", "business", "gladiator"];
const STATUSES: EmailStatus[] = ["review", "confirmed", "ignored", "duplicate"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type ReviewChange = {
  id: string;
  status?: EmailStatus;
  scope?: Scope | null;
  billId?: string | null;
  merchant?: string;
  amount?: number | null;
  dueDate?: string | null;
  billDate?: string | null;
};

export function applyReview(items: EmailItem[], c: ReviewChange): EmailItem[] {
  const at = items.findIndex((i) => i.id === c.id);
  if (at < 0) throw new GmailError("That email isn't in the list any more.", 404);
  const next: EmailItem = { ...items[at] };
  if (c.status !== undefined) {
    if (!STATUSES.includes(c.status)) throw new GmailError("Unknown status.");
    next.status = c.status;
  }
  if (c.scope !== undefined) {
    if (c.scope !== null && !SCOPES.includes(c.scope)) throw new GmailError("Unknown company.");
    if (c.scope === null) delete next.scope;
    else next.scope = c.scope;
  }
  if (next.status === "confirmed" && !next.scope) throw new GmailError("Pick Personal, Maverick or Gladiator first.");
  if (c.billId !== undefined) {
    if (c.billId === null) delete next.billId;
    else next.billId = String(c.billId).slice(0, 100);
  }
  if (typeof c.merchant === "string" && c.merchant.trim()) next.merchant = c.merchant.trim().slice(0, 80);
  if (c.amount !== undefined) {
    if (c.amount !== null && !(typeof c.amount === "number" && c.amount > 0 && c.amount < 1_000_000)) throw new GmailError("Enter an amount above zero.");
    next.amount = c.amount === null ? null : Math.round(c.amount * 100) / 100;
  }
  for (const k of ["dueDate", "billDate"] as const) {
    const v = c[k];
    if (v === undefined) continue;
    if (v !== null && !YMD.test(v)) throw new GmailError("Dates are YYYY-MM-DD.");
    next[k] = v;
  }
  const out = [...items];
  out[at] = next;
  return out;
}

export async function review(c: ReviewChange) {
  needDb();
  let item: EmailItem | undefined;
  await put(ITEMS_DOC, (current) => {
    const d = (current ?? {}) as Partial<EmailDoc>;
    const items = applyReview(Array.isArray(d.items) ? d.items : [], c);
    item = items.find((i) => i.id === c.id);
    return { items, lastScan: d.lastScan ?? null } satisfies EmailDoc;
  });
  return item!;
}

/* ---- Originals for downloads ---- */

/**
 * A reader for the original emails (as .eml, exactly as Gmail has them), or
 * the reason they can't be read. Only reads; nothing in the mailbox changes.
 */
export async function originalsReader(): Promise<{ read: (id: string) => Promise<Buffer | null> } | { why: string }> {
  const keys = await getKeys().catch(() => null);
  if (!keys) return { why: "Gmail isn't set up, so the original emails aren't included." };
  let tokens: Tokens;
  try {
    tokens = await freshTokens(keys);
  } catch (e) {
    return { why: e instanceof GmailError ? `${e.message} The original emails aren't included.` : "Couldn't reach Gmail, so the original emails aren't included." };
  }
  return {
    read: (id) =>
      api<{ raw?: string }>(tokens, `/messages/${encodeURIComponent(id)}?format=raw&fields=raw`)
        .then((m) => (m.raw ? Buffer.from(m.raw, "base64url") : null))
        .catch(() => null),
  };
}
