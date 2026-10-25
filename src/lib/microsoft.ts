import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbConfigured, readDoc, writeDoc } from "@/lib/db";

/*
 * Gladiator's Microsoft 365 account (mail and calendar), one mailbox only.
 *
 * Signs in with Microsoft's delegated OAuth (authorization code + PKCE) as
 * the account below and nobody else: after sign-in the account Microsoft
 * returns must match GLADIATOR_ACCOUNT, or nothing is saved. Permissions are
 * delegated to that one user (no tenant-wide application permissions), and
 * Maverick only ever calls /me, so it can't reach any other mailbox.
 *
 * The Microsoft app's client ID and secret come from Vercel (MS_CLIENT_ID,
 * MS_CLIENT_SECRET, optional MS_TENANT_ID) or the form on the Calendar page.
 * Keys and tokens are sealed with a key derived from APP_PASSWORD, stored in
 * the database and never sent to the browser.
 *
 * Every write (send, reply, create/change/cancel an event) is started by the
 * owner from a preview in the app; nothing writes on a schedule.
 */

export const GLADIATOR_ACCOUNT = (process.env.MS_ACCOUNT || "vic@gladiatoremergence.com").toLowerCase();

/** The least Microsoft Graph needs for reading and writing this one user's mail and calendar. */
export const MS_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"];
export const MS_SCOPE = MS_SCOPES.join(" ");

/*
 * Teams is a separate, optional consent so mail and calendar never wait on it.
 * All delegated (this user only). ChannelMessage.Read.All is the one that
 * needs a Microsoft 365 administrator to approve it for the Gladiator tenant;
 * the rest Victor can approve himself.
 */
export const TEAMS_SCOPES = ["Chat.Read", "ChatMessage.Send", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All", "ChannelMessage.Send"];
export const TEAMS_ADMIN_SCOPES = ["ChannelMessage.Read.All"];
const scopeFor = (teams: boolean) => [...MS_SCOPES, ...(teams ? TEAMS_SCOPES : [])].join(" ");

export const GRAPH = "https://graph.microsoft.com/v1.0";

type Keys = { clientId: string; secret: string };
type Tokens = { access: string; accessExpires: number; refresh: string; scope: string };
type Connection = { sealed: string; email: string; name: string; connectedAt: string; scope: string; teams?: boolean };

const KEYS_DOC = "microsoft-keys";
const CONNECTION_DOC = "microsoft-connection";

export class MicrosoftError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const tenant = () => (process.env.MS_TENANT_ID || "organizations").trim();
const authBase = () => `https://login.microsoftonline.com/${encodeURIComponent(tenant())}/oauth2/v2.0`;

const sealKey = () => createHash("sha256").update(`maverick-microsoft:${process.env.APP_PASSWORD}`).digest();

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

async function put(key: string, data: unknown) {
  for (let i = 0; i < 3; i++) {
    const current = await readDoc(key);
    if ((await writeDoc(key, current?.rev ?? 0, data)).ok) return;
  }
  throw new MicrosoftError("Couldn't save to the database. Try again.", 503);
}

function needDb() {
  if (!dbConfigured()) throw new MicrosoftError("Microsoft 365 needs the online database, which isn't set up.", 503);
}

export const keysFromSettings = () => Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);

export async function getKeys(): Promise<Keys | null> {
  if (keysFromSettings()) return { clientId: process.env.MS_CLIENT_ID!, secret: process.env.MS_CLIENT_SECRET! };
  if (!dbConfigured()) return null;
  const sealed = ((await readDoc(KEYS_DOC))?.data as { sealed?: string } | null)?.sealed;
  if (!sealed) return null;
  try {
    return unseal<Keys>(sealed);
  } catch {
    return null; // the site password changed; enter the keys again
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveKeys(keys: Keys) {
  needDb();
  const clientId = String(keys.clientId ?? "").trim();
  const secret = String(keys.secret ?? "").trim();
  if (!GUID.test(clientId)) throw new MicrosoftError("That doesn't look like a Microsoft Application (client) ID. It looks like 1a2b3c4d-….");
  if (secret.length < 10 || GUID.test(secret)) throw new MicrosoftError("Paste the client secret's Value, not its Secret ID.");
  await put(KEYS_DOC, { sealed: seal({ clientId, secret } satisfies Keys), savedAt: new Date().toISOString() });
}

export const redirectUri = (origin: string) => `${origin}/api/microsoft/callback`;
export const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function authorizeUrl(keys: Keys, origin: string, state: string, verifier: string, teams = false) {
  const q = new URLSearchParams({
    client_id: keys.clientId,
    response_type: "code",
    response_mode: "query",
    scope: scopeFor(teams),
    redirect_uri: redirectUri(origin),
    state,
    login_hint: GLADIATOR_ACCOUNT,
    prompt: "select_account",
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
  });
  return `${authBase()}/authorize?${q}`;
}

async function tokenCall(keys: Keys, form: Record<string, string>, teams = false): Promise<Tokens> {
  const res = await fetch(`${authBase()}/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: keys.clientId, client_secret: keys.secret, scope: scopeFor(teams), ...form }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.error ?? res.status);
    if (code === "invalid_client") throw new MicrosoftError("Microsoft didn't accept the app keys. Enter them again.", 400);
    if (code === "invalid_grant" || code === "interaction_required") throw new MicrosoftError("Microsoft signed Maverick out of Gladiator 365. Press Connect again.", 401);
    throw new MicrosoftError(`Microsoft sign-in failed (${code}).`, 502);
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

const saveConnection = (tokens: Tokens, c: Omit<Connection, "sealed">) => put(CONNECTION_DOC, { ...c, sealed: seal(tokens) } satisfies Connection);

/** Which of the wanted permissions Microsoft didn't grant. */
export function missingScopes(granted: string, wanted: string[] = MS_SCOPES) {
  const have = new Set(granted.toLowerCase().split(/\s+/).map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//, "")));
  return wanted.filter((s) => s !== "offline_access" && !have.has(s.toLowerCase()));
}

/** True when the signed-in Microsoft account is Gladiator's, by mail or sign-in name. */
export function isGladiatorAccount(me: { mail?: string | null; userPrincipalName?: string | null }) {
  return [me.mail, me.userPrincipalName].some((v) => (v ?? "").toLowerCase() === GLADIATOR_ACCOUNT);
}

async function rawGraph<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; json: T | null }> {
  const res = await fetch(path.startsWith("https://") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as T) : null };
}

/** Finishes Microsoft's redirect: only Gladiator's account is accepted. */
export async function finishConnect(origin: string, code: string, verifier: string, teams = false) {
  needDb();
  const keys = await getKeys();
  if (!keys) throw new MicrosoftError("Add the Microsoft app keys first.");
  const t = await tokenCall(keys, { grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), code_verifier: verifier }, teams);
  if (!t.refresh) throw new MicrosoftError("Microsoft didn't give a lasting sign-in. Press Connect again.");
  const missing = missingScopes(t.scope);
  if (missing.length) throw new MicrosoftError(`Microsoft didn't grant ${missing.join(", ")}. Press Connect again and accept.`);
  const me = await rawGraph<{ mail?: string; userPrincipalName?: string; displayName?: string }>(t.access, "/me?$select=mail,userPrincipalName,displayName");
  if (me.status !== 200 || !me.json) throw new MicrosoftError("Microsoft didn't say which account signed in. Press Connect again.", 502);
  if (!isGladiatorAccount(me.json)) {
    throw new MicrosoftError(`That was ${me.json.mail || me.json.userPrincipalName || "another account"}. Sign in as ${GLADIATOR_ACCOUNT}.`, 403);
  }
  // Teams is optional: keep it on only if Microsoft granted every Teams permission.
  const teamsOn = teams && missingScopes(t.scope, TEAMS_SCOPES).length === 0;
  await saveConnection(t, { email: (me.json.mail || me.json.userPrincipalName || GLADIATOR_ACCOUNT).toLowerCase(), name: me.json.displayName ?? "", connectedAt: new Date().toISOString(), scope: t.scope, teams: teamsOn });
}

async function freshTokens() {
  const keys = await getKeys();
  if (!keys) throw new MicrosoftError("Gladiator 365 isn't set up.", 409);
  const found = await readConnection();
  if (!found) throw new MicrosoftError("Gladiator 365 isn't connected.", 409);
  const { conn, tokens } = found;
  if (tokens.accessExpires - Date.now() > 60_000) return tokens;
  const t = await tokenCall(keys, { grant_type: "refresh_token", refresh_token: tokens.refresh }, Boolean(conn.teams));
  // Microsoft rotates refresh tokens; keep the new one.
  const next: Tokens = { ...t, refresh: t.refresh || tokens.refresh, scope: t.scope || tokens.scope };
  await saveConnection(next, { email: conn.email, name: conn.name, connectedAt: conn.connectedAt, scope: next.scope, teams: conn.teams });
  return next;
}

/**
 * Only the signed-in user's own data: /me (mail, calendar, joined teams), and
 * chats or teams Microsoft lets this user see. A path for another user is refused.
 */
export function allowedPath(path: string) {
  const p = path.startsWith(GRAPH) ? path.slice(GRAPH.length) : path;
  if (p.startsWith("https://")) return false;
  return /^\/me(\/|\?|$)/.test(p) || /^\/chats\/[^/?]+\/messages(\/|\?|$)/.test(p) || /^\/teams\/[^/?]+\/channels(\/|\?|$)/.test(p);
}

/** Calls Microsoft Graph as Gladiator's account. */
export async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!allowedPath(path)) throw new MicrosoftError("Only the signed-in Gladiator account's own mail, calendar and Teams can be used.", 400);
  const t = await freshTokens();
  for (let attempt = 0; ; attempt++) {
    const r = await rawGraph<T & { error?: { code?: string; message?: string } }>(t.access, path, init);
    if (r.status >= 200 && r.status < 300) return (r.json ?? ({} as T)) as T;
    if ((r.status === 429 || r.status === 503 || r.status === 504) && attempt < 2 && (init.method ?? "GET") === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (r.status === 401) throw new MicrosoftError("Microsoft signed Maverick out of Gladiator 365. Press Connect again.", 401);
    if (r.status === 403) throw new MicrosoftError("Microsoft refused that for Gladiator 365. Connect again and accept the permissions.", 403);
    if (r.status === 404) throw new MicrosoftError("Microsoft couldn't find that item. It may have been moved or deleted.", 404);
    if (r.status === 400) throw new MicrosoftError(`Microsoft didn't accept that (${r.json?.error?.code ?? "bad request"}).`, 400);
    throw new MicrosoftError(`Microsoft didn't answer (${r.status}). Try again.`, 502);
  }
}

/** Forgets Maverick's Gladiator 365 sign-in. To remove consent entirely, use myapps.microsoft.com. */
export async function disconnect() {
  if (dbConfigured()) await put(CONNECTION_DOC, {});
}

export async function status() {
  const [keys, found] = await Promise.all([getKeys().catch(() => null), readConnection().catch(() => null)]);
  return {
    database: dbConfigured(),
    account: GLADIATOR_ACCOUNT,
    keys: Boolean(keys),
    keysFromSettings: keysFromSettings(),
    connected: Boolean(found),
    email: found?.conn.email ?? null,
    name: found?.conn.name ?? null,
    connectedAt: found?.conn.connectedAt ?? null,
    missing: found ? missingScopes(found.conn.scope || found.tokens.scope) : [],
    teams: Boolean(found?.conn.teams),
  };
}
