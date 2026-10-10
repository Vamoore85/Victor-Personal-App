import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbConfigured, readDoc, writeDoc } from "@/lib/db";

/*
 * QuickBooks Online link for Gladiator's books (kept by its bookkeeper).
 *
 * The Intuit app's client ID and secret come from Vercel (QBO_CLIENT_ID,
 * QBO_CLIENT_SECRET, QBO_ENV) or from the form in the Financial Center. Both
 * the keys and the QuickBooks sign-in tokens are stored in the database,
 * sealed with a key derived from APP_PASSWORD, and never reach the browser.
 * The link is read-only: it only asks for reports.
 */

export type QboEnv = "production" | "sandbox";
export type QboKeys = { clientId: string; secret: string; env: QboEnv };
type Tokens = { realmId: string; access: string; accessExpires: number; refresh: string; refreshExpires: number };
type Connection = { sealed: string; companyName: string; connectedAt: string };

export type ReportLine = { label: string; amount: number | null; depth: number; kind: "section" | "line" | "total" };
export type QboReport = {
  year: number;
  fetchedAt: string;
  basis: string;
  companyName: string;
  income: number;
  expenses: number;
  netIncome: number;
  pl: ReportLine[];
  balanceSheet: ReportLine[];
  balanceAsOf: string;
};

const KEYS_DOC = "qbo-keys";
const CONNECTION_DOC = "qbo-connection";
const reportDoc = (year: number) => `qbo-report-${year}`;

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const API: Record<QboEnv, string> = {
  production: "https://quickbooks.api.intuit.com",
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
};
const SCOPE = "com.intuit.quickbooks.accounting";

export class QboError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const sealKey = () => createHash("sha256").update(`maverick-quickbooks:${process.env.APP_PASSWORD}`).digest();

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
async function put(key: string, data: unknown) {
  for (let i = 0; i < 3; i++) {
    const current = await readDoc(key);
    const saved = await writeDoc(key, current?.rev ?? 0, data);
    if (saved.ok) return;
  }
  throw new QboError("Couldn't save to the database. Try again.", 503);
}

function needDb() {
  if (!dbConfigured()) throw new QboError("QuickBooks needs the online database, which isn't set up.", 503);
}

export const keysFromSettings = () => Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);

export async function getKeys(): Promise<QboKeys | null> {
  if (keysFromSettings()) {
    return {
      clientId: process.env.QBO_CLIENT_ID!,
      secret: process.env.QBO_CLIENT_SECRET!,
      env: process.env.QBO_ENV === "sandbox" ? "sandbox" : "production",
    };
  }
  if (!dbConfigured()) return null;
  const doc = await readDoc(KEYS_DOC);
  const sealed = (doc?.data as { sealed?: string } | null)?.sealed;
  if (!sealed) return null;
  try {
    return unseal<QboKeys>(sealed);
  } catch {
    return null; // the site password changed; enter the keys again
  }
}

export async function saveKeys(keys: QboKeys) {
  needDb();
  await put(KEYS_DOC, { sealed: seal(keys), savedAt: new Date().toISOString() });
}

export const redirectUri = (origin: string) => `${origin}/api/quickbooks/callback`;

export function authorizeUrl(keys: QboKeys, origin: string, state: string) {
  const q = new URLSearchParams({
    client_id: keys.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(origin),
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenCall(keys: QboKeys, form: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${keys.clientId}:${keys.secret}`).toString("base64")}`,
    },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === "invalid_client") throw new QboError("Intuit didn't accept the app's client ID or secret. Enter them again.", 400);
    if (json.error === "invalid_grant") throw new QboError("QuickBooks signed this site out. Connect QuickBooks again.", 401);
    throw new QboError(`QuickBooks sign-in failed (${json.error || res.status}).`, 502);
  }
  const now = Date.now();
  return {
    access: String(json.access_token),
    accessExpires: now + (Number(json.expires_in) || 3600) * 1000,
    refresh: String(json.refresh_token),
    refreshExpires: now + (Number(json.x_refresh_token_expires_in) || 100 * 86400) * 1000,
  };
}

async function readConnection(): Promise<{ conn: Connection; tokens: Tokens } | null> {
  if (!dbConfigured()) return null;
  const doc = await readDoc(CONNECTION_DOC);
  const conn = doc?.data as Connection | null;
  if (!conn?.sealed) return null;
  try {
    return { conn, tokens: unseal<Tokens>(conn.sealed) };
  } catch {
    return null;
  }
}

async function saveConnection(tokens: Tokens, companyName: string, connectedAt: string) {
  await put(CONNECTION_DOC, { sealed: seal(tokens), companyName, connectedAt } satisfies Connection);
}

async function apiGet<T>(keys: QboKeys, tokens: Tokens, path: string): Promise<T> {
  const res = await fetch(`${API[keys.env]}/v3/company/${tokens.realmId}${path}${path.includes("?") ? "&" : "?"}minorversion=75`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${tokens.access}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new QboError("QuickBooks signed this site out. Connect QuickBooks again.", 401);
  if (!res.ok) {
    const detail = json?.Fault?.Error?.[0]?.Detail || json?.Fault?.Error?.[0]?.Message || res.status;
    throw new QboError(`QuickBooks returned an error: ${detail}`, 502);
  }
  return json as T;
}

async function companyName(keys: QboKeys, tokens: Tokens) {
  try {
    const json = await apiGet<{ CompanyInfo?: { CompanyName?: string } }>(keys, tokens, `/companyinfo/${tokens.realmId}`);
    return json.CompanyInfo?.CompanyName || "QuickBooks company";
  } catch {
    return "QuickBooks company";
  }
}

/** Finishes the sign-in Intuit redirected back with. */
export async function finishConnect(origin: string, code: string, realmId: string) {
  needDb();
  const keys = await getKeys();
  if (!keys) throw new QboError("Add the Intuit app keys first.");
  const t = await tokenCall(keys, { grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
  const tokens: Tokens = { realmId, ...t };
  await saveConnection(tokens, await companyName(keys, tokens), new Date().toISOString());
}

/** Tokens that are good for at least another minute, refreshing (and saving) them if needed. */
async function freshTokens(keys: QboKeys) {
  const found = await readConnection();
  if (!found) throw new QboError("QuickBooks isn't connected.", 409);
  const { conn, tokens } = found;
  if (tokens.accessExpires - Date.now() > 60_000) return tokens;
  const t = await tokenCall(keys, { grant_type: "refresh_token", refresh_token: tokens.refresh });
  const next: Tokens = { realmId: tokens.realmId, ...t };
  await saveConnection(next, conn.companyName, conn.connectedAt);
  return next;
}

export async function disconnect() {
  const found = await readConnection();
  const keys = await getKeys();
  if (found && keys) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keys.clientId}:${keys.secret}`).toString("base64")}`,
      },
      body: JSON.stringify({ token: found.tokens.refresh }),
    }).catch(() => undefined);
  }
  if (dbConfigured()) await put(CONNECTION_DOC, {});
}

export async function status() {
  const keys = await getKeys();
  const found = await readConnection();
  return {
    database: dbConfigured(),
    keys: Boolean(keys),
    keysFromSettings: keysFromSettings(),
    env: keys?.env ?? null,
    connected: Boolean(found),
    companyName: found?.conn.companyName ?? null,
    connectedAt: found?.conn.connectedAt ?? null,
    refreshExpires: found ? new Date(found.tokens.refreshExpires).toISOString() : null,
  };
}

export async function cachedReport(year: number): Promise<QboReport | null> {
  if (!dbConfigured()) return null;
  const doc = await readDoc(reportDoc(year));
  const r = doc?.data as QboReport | null;
  return r?.pl ? r : null;
}

// --- Reports -------------------------------------------------------------

type ColData = { value?: string };
type QRow = {
  type?: string;
  group?: string;
  Header?: { ColData?: ColData[] };
  ColData?: ColData[];
  Rows?: { Row?: QRow[] };
  Summary?: { ColData?: ColData[] };
};
type QReport = { Header?: { ReportBasis?: string; EndPeriod?: string }; Rows?: { Row?: QRow[] } };

const amountOf = (cols?: ColData[]) => {
  const v = cols?.[cols.length - 1]?.value;
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Turns QuickBooks' nested report rows into a flat list of indented lines. */
export function flatten(rows: QRow[] | undefined, depth = 0, out: ReportLine[] = []): ReportLine[] {
  for (const row of rows ?? []) {
    if (row.Header || row.Rows) {
      const label = row.Header?.ColData?.[0]?.value;
      if (label) out.push({ label, amount: row.Rows?.Row?.length ? null : amountOf(row.Header?.ColData), depth, kind: "section" });
      flatten(row.Rows?.Row, label ? depth + 1 : depth, out);
      if (row.Summary?.ColData) {
        out.push({ label: row.Summary.ColData[0]?.value || "Total", amount: amountOf(row.Summary.ColData), depth, kind: "total" });
      }
    } else if (row.ColData) {
      out.push({ label: row.ColData[0]?.value || "", amount: amountOf(row.ColData), depth, kind: "line" });
    } else if (row.Summary?.ColData) {
      out.push({ label: row.Summary.ColData[0]?.value || "Total", amount: amountOf(row.Summary.ColData), depth, kind: "total" });
    }
  }
  return out;
}

const groupTotal = (rows: QRow[] | undefined, groups: string[]) => {
  let sum = 0;
  for (const row of rows ?? []) if (row.group && groups.includes(row.group)) sum += amountOf(row.Summary?.ColData) ?? 0;
  return sum;
};

export function summarize(pl: QReport, bs: QReport, year: number, company: string): QboReport {
  const rows = pl.Rows?.Row;
  const income = groupTotal(rows, ["Income", "OtherIncome"]);
  const expenses = groupTotal(rows, ["COGS", "Expenses", "OtherExpenses"]);
  const net = rows?.find((r) => r.group === "NetIncome");
  return {
    year,
    fetchedAt: new Date().toISOString(),
    basis: pl.Header?.ReportBasis || "Accrual",
    companyName: company,
    income,
    expenses,
    netIncome: amountOf(net?.Summary?.ColData) ?? income - expenses,
    pl: flatten(rows),
    balanceSheet: flatten(bs.Rows?.Row),
    balanceAsOf: bs.Header?.EndPeriod || "",
  };
}

/** Pulls the year's profit and loss and the balance sheet, and keeps a copy. */
export async function syncReport(year: number, todayIso: string): Promise<QboReport> {
  needDb();
  const keys = await getKeys();
  if (!keys) throw new QboError("Add the Intuit app keys first.");
  const tokens = await freshTokens(keys);
  const thisYear = Number(todayIso.slice(0, 4));
  const end = year >= thisYear ? todayIso : `${year}-12-31`;
  const [pl, bs] = await Promise.all([
    apiGet<QReport>(keys, tokens, `/reports/ProfitAndLoss?start_date=${year}-01-01&end_date=${end}`),
    apiGet<QReport>(keys, tokens, `/reports/BalanceSheet?start_date=${year}-01-01&end_date=${end}`),
  ]);
  const found = await readConnection();
  const report = summarize(pl, bs, year, found?.conn.companyName ?? "QuickBooks company");
  await put(reportDoc(year), report);
  return report;
}
