import { databaseUrl, dbConfigured, readDoc } from "@/lib/db";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { envConfigured, envName, handle, plaid, PlaidError, siteCreds, unseal, type PlaidCreds } from "@/lib/plaid-server";

/*
 * What the bank sync depends on, checked from the server: the database the
 * reports read, the Plaid keys, and each saved bank connection. Answers with
 * yes/no, counts, dates and Plaid's error codes; never keys, tokens, names of
 * transactions or amounts.
 */

export const maxDuration = 30;

export const POST = handle(async (body) => {
  const out: Record<string, unknown> = { build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev", checkedAt: new Date().toISOString() };

  // 1. The database.
  let data = null as ReturnType<typeof asMoney> | null;
  if (!dbConfigured()) out.database = { ok: false, code: "NO_DATABASE_URL", text: "The DATABASE_URL setting is missing in Vercel." };
  else {
    try {
      const doc = await readDoc(MONEY_DOC);
      data = doc ? asMoney(doc.data) : null;
      let host = "";
      try {
        host = new URL(databaseUrl()).hostname.replace(/^[^.]+\./, "…."); // enough to tell which project, not the password
      } catch {
        /* shown as unknown */
      }
      out.database = { ok: true, host, rev: doc?.rev ?? 0, sizeKb: doc ? Math.round(JSON.stringify(doc.data).length / 1024) : 0 };
    } catch (e) {
      out.database = { ok: false, code: "DB_UNREACHABLE", text: `The database didn't answer (${(e as { code?: string }).code ?? "error"}).` };
    }
  }

  // 2. Plaid's keys.
  let creds: PlaidCreds | null = null;
  let source = "none";
  if (envConfigured()) {
    creds = { clientId: process.env.PLAID_CLIENT_ID!, secret: process.env.PLAID_SECRET!, env: envName() };
    source = "vercel";
  } else {
    creds = await siteCreds().catch(() => null);
    if (creds) source = "site";
    else if (typeof body.keys === "string") source = "device";
  }
  const keys: Record<string, unknown> = { source, env: creds?.env ?? null };
  if (!creds && source === "none")
    keys.problem = "No Plaid keys on the server: PLAID_CLIENT_ID and PLAID_SECRET aren't set in Vercel and no keys are saved for the site.";
  if (creds) {
    try {
      await plaid(creds, "/institutions/get", { count: 1, offset: 0, country_codes: ["US"] });
      keys.ok = true;
    } catch (e) {
      keys.ok = false;
      keys.code = e instanceof PlaidError ? e.code : "UNREACHABLE";
      keys.problem = `Plaid refused the ${source === "vercel" ? "Vercel" : "saved"} keys (${keys.code}).`;
    }
  }
  out.keys = keys;

  // 3. Each saved connection.
  const d = data;
  out.money = d
    ? { accounts: d.accounts.length, bankAccounts: d.accounts.filter((a) => a.plaid).length, transactions: d.transactions.length, bankTransactions: d.transactions.filter((t) => t.plaidId).length }
    : null;
  out.links = await Promise.all(
    (d?.bankLinks ?? []).map(async (l) => {
      const accts = d!.accounts.filter((a) => a.plaid?.linkId === l.id);
      const ids = new Set(accts.map((a) => a.id));
      const dates = d!.transactions.filter((t) => t.plaidId && ids.has(t.accountId)).map((t) => t.date).sort();
      const row: Record<string, unknown> = {
        id: l.id,
        institution: l.institution || "",
        connectedAt: l.connectedAt ?? null,
        lastSync: l.lastSync ?? null,
        cursor: !!l.cursor,
        historyStatus: l.historyStatus ?? null,
        savedError: l.errorCode ?? null,
        accounts: accts.length,
        bankTransactions: dates.length,
        first: dates[0] ?? null,
        last: dates[dates.length - 1] ?? null,
      };
      if (!creds) return row;
      let token: string;
      try {
        token = unseal(creds, l.link);
        row.tokenOk = true;
      } catch {
        row.tokenOk = false; // sealed with other Plaid keys
        return row;
      }
      try {
        const item = await plaid<{ item: { error: { error_code: string } | null }; status?: { transactions?: { last_successful_update?: string | null } } }>(creds, "/item/get", { access_token: token });
        row.bankError = item.item.error?.error_code ?? null;
        row.plaidLastUpdate = item.status?.transactions?.last_successful_update ?? null;
      } catch (e) {
        row.bankError = e instanceof PlaidError ? e.code : "UNREACHABLE";
      }
      return row;
    }),
  );
  const links = out.links as Record<string, unknown>[];
  console.log(
    `plaid health: db=${(out.database as { ok: boolean }).ok} keys=${source}/${keys.ok ?? "-"} links=${links.length} tokenBad=${links.filter((l) => l.tokenOk === false).length} bankErrors=${links.map((l) => l.bankError).filter(Boolean).join(",") || "none"} bankTxns=${(out.money as { bankTransactions?: number } | null)?.bankTransactions ?? "-"}`,
  );
  return out;
});
