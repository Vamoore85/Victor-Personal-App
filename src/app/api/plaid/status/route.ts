import { connection } from "next/server";
import { envConfigured, envName, plaid, PlaidError, signedIn, siteCreds, type PlaidCreds } from "@/lib/plaid-server";

// Where Plaid's keys come from, and with ?check=1 whether Plaid accepts them right now.
export async function GET(req: Request) {
  await connection(); // check the keys on every request, not once at build time
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  const check = new URL(req.url).searchParams.get("check") === "1";
  let creds: PlaidCreds | null = null;
  let out: { fromSettings: boolean; env: string | null; site: boolean };
  if (envConfigured()) {
    creds = { clientId: process.env.PLAID_CLIENT_ID!, secret: process.env.PLAID_SECRET!, env: envName() };
    out = { fromSettings: true, env: envName(), site: false };
  } else {
    creds = await siteCreds().catch(() => null);
    out = { fromSettings: false, env: creds?.env ?? null, site: Boolean(creds) };
  }
  if (!check || !creds) return Response.json(out);
  try {
    await plaid(creds, "/institutions/get", { count: 1, offset: 0, country_codes: ["US"] });
    return Response.json({ ...out, check: { ok: true } });
  } catch (e) {
    const err = e instanceof PlaidError ? e : null;
    return Response.json({ ...out, check: { ok: false, code: err?.code ?? "UNREACHABLE", error: err?.message ?? "Couldn't reach Plaid." } });
  }
}
