import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Server-side Plaid helpers. Plaid's keys live in Vercel environment
// variables and never reach the browser:
//   PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV ("sandbox" or "production").

const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export function plaidEnv() {
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  return HOSTS[env] ? env : "sandbox";
}

export function plaidConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
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

export async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!plaidConfigured()) throw new PlaidError("Plaid keys haven't been added yet.", "NOT_CONFIGURED", 503);
  const res = await fetch(HOSTS[plaidEnv()] + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }),
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
 * only ever holds it sealed (AES-256-GCM) with a key derived from PLAID_SECRET.
 * The sealed value is useless without the server; changing the secret means
 * reconnecting banks.
 */
function sealKey() {
  return createHash("sha256").update(`maverick-plaid-token:${process.env.PLAID_SECRET}`).digest();
}

export function seal(accessToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const data = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: unknown) {
  if (typeof sealed !== "string") throw new PlaidError("Missing bank connection.", "BAD_REQUEST");
  try {
    const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new PlaidError("This bank connection is no longer valid. Disconnect it and connect again.", "BAD_SEAL");
  }
}

/** Only accept calls made from this site's own pages. */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

export function handle(fn: (body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request) => {
    if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
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
