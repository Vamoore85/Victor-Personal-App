import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE, validSession } from "@/lib/auth";

// Server-side Plaid helpers. Plaid's keys come from one of two places:
//   1. Vercel environment variables PLAID_CLIENT_ID, PLAID_SECRET and
//      PLAID_ENV ("sandbox" or "production"), which win when set; or
//   2. keys typed into the Financial Center, which the browser only ever holds
//      sealed with a key derived from APP_PASSWORD and sends with each call.

const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export type PlaidCreds = { clientId: string; secret: string; env: string };

const pickEnv = (env: unknown) => {
  const e = String(env || "sandbox").toLowerCase();
  return HOSTS[e] ? e : "sandbox";
};

/** True when the keys are set in Vercel, so the in-app keys box isn't needed. */
export function envConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function envName() {
  return pickEnv(process.env.PLAID_ENV);
}

export class PlaidError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
  }
}

function encrypt(key: Buffer, text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function decrypt(key: Buffer, sealed: string) {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// Keys typed into the app are sealed with the site password, so the sealed
// copy in the browser is useless on its own. Changing the password means
// entering the keys again.
const keysKey = () => createHash("sha256").update(`maverick-plaid-keys:${process.env.APP_PASSWORD}`).digest();

export function sealCreds(creds: PlaidCreds) {
  return encrypt(keysKey(), JSON.stringify(creds));
}

/** The keys for this request: Vercel's if set, otherwise the sealed keys the browser sent. */
export function credsFrom(body: Record<string, unknown>): PlaidCreds {
  if (envConfigured()) return { clientId: process.env.PLAID_CLIENT_ID!, secret: process.env.PLAID_SECRET!, env: envName() };
  if (typeof body.keys !== "string") throw new PlaidError("Add your Plaid keys first.", "NOT_CONFIGURED", 503);
  try {
    const c = JSON.parse(decrypt(keysKey(), body.keys)) as PlaidCreds;
    return { clientId: c.clientId, secret: c.secret, env: pickEnv(c.env) };
  } catch {
    throw new PlaidError("Your saved Plaid keys no longer work. Enter them again.", "BAD_KEYS", 400);
  }
}

export async function plaid<T>(creds: PlaidCreds, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HOSTS[creds.env] + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PlaidError(json.display_message || json.error_message || "Plaid request failed.", json.error_code || "PLAID_ERROR", res.status);
  }
  return json as T;
}

/*
 * A bank connection's access token is the key to that account, so the browser
 * only ever holds it sealed (AES-256-GCM) with a key derived from the Plaid
 * secret. The sealed value is useless without the server; changing the secret
 * means reconnecting banks.
 */
const tokenKey = (creds: PlaidCreds) => createHash("sha256").update(`maverick-plaid-token:${creds.secret}`).digest();

export function seal(creds: PlaidCreds, accessToken: string) {
  return encrypt(tokenKey(creds), accessToken);
}

export function unseal(creds: PlaidCreds, sealed: unknown) {
  if (typeof sealed !== "string") throw new PlaidError("Missing bank connection.", "BAD_REQUEST");
  try {
    return decrypt(tokenKey(creds), sealed);
  } catch {
    throw new PlaidError("This bank connection is no longer valid. Disconnect it and connect again.", "BAD_SEAL");
  }
}

/** Checked here as well as in the proxy, so a matcher change can't open these routes. */
export function signedIn(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return validSession(cookie);
}

/** Only accept calls made from this site's own pages. */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

export function handle(fn: (body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request) => {
    if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      return Response.json(await fn(body));
    } catch (e) {
      const err = e instanceof PlaidError ? e : new PlaidError("Something went wrong talking to Plaid.", "SERVER_ERROR", 500);
      if (!(e instanceof PlaidError)) console.error(e);
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
  };
}
