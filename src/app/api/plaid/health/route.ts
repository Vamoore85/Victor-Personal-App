import { databaseUrl, dbConfigured, isRetryable, readDoc } from "@/lib/db";
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
      const code = (e as { code?: string }).code ?? "error";
      out.database = isRetryable(e)
        ? { ok: false, code: "DB_RETRY", retry: true, text: `The database was busy (${code}). Checking again…` }
        : { ok: false, code: "DB_UNREACHABLE", text: `The database didn't answer (${code}).` };
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
        // Which accounts the bank itself reports, and whether it sent a balance for each (yes/no only).
        const live = await plaid<{ accounts: { account_id: string; mask: string | null; type: string; balances: { current: number | null; available: number | null } }[] }>(creds, "/accounts/get", { access_token: token });
        row.bankAccounts = live.accounts.map((a) => ({
          last4: a.mask,
          type: a.type,
          balance: a.balances.current !== null || a.balances.available !== null,
          inApp: d!.accounts.some((x) => x.plaid?.linkId === l.id && x.plaid.accountId === a.account_id),
        }));
      } catch (e) {
        row.bankAccounts = e instanceof PlaidError ? e.code : "UNREACHABLE";
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
  // Every account the app shows: its entity, whether a live bank connection feeds it, and its balance's age. No amounts.
  const liveLinks = new Map((d?.bankLinks ?? []).map((l) => [l.id, l]));
  out.accounts = (d?.accounts ?? []).map((a) => {
    const link = a.plaid ? liveLinks.get(a.plaid.linkId) : undefined;
    const bb = a.bankBalance;
    return {
      last4: a.last4 ?? null,
      entity: a.scope ?? "personal",
      type: a.type,
      feed: !a.plaid ? "none" : link ? "live" : "removed-link",
      balance: !bb ? "none" : bb.current === null && bb.available === null ? "empty" : "ok",
      balanceAgeH: bb ? Math.round((Date.now() - new Date(bb.asOf).getTime()) / 36e5) : null,
      bankTxns: d!.transactions.filter((t) => t.accountId === a.id && t.plaidId).length,
      otherTxns: d!.transactions.filter((t) => t.accountId === a.id && !t.plaidId).length,
    };
  });
  const links = out.links as Record<string, unknown>[];
  console.log(
    `plaid health: db=${(out.database as { ok: boolean }).ok} keys=${source}/${keys.ok ?? "-"} links=${links.length} tokenBad=${links.filter((l) => l.tokenOk === false).length} bankErrors=${links.map((l) => l.bankError).filter(Boolean).join(",") || "none"} bankTxns=${(out.money as { bankTransactions?: number } | null)?.bankTransactions ?? "-"}`,
  );
  console.log(
    `plaid health accounts: ${(out.accounts as Record<string, unknown>[]).map((a) => `${a.last4 ?? "----"}/${a.entity}/${a.type}/feed=${a.feed}/bal=${a.balance}${a.balanceAgeH !== null ? `@${a.balanceAgeH}h` : ""}/tx=${a.bankTxns}+${a.otherTxns}`).join(" ")} | bank reports: ${links
      .map((l) => (Array.isArray(l.bankAccounts) ? (l.bankAccounts as { last4: string | null; type: string; balance: boolean; inApp: boolean }[]).map((b) => `${b.last4 ?? "----"}/${b.type}/bal=${b.balance}/inApp=${b.inApp}`).join(" ") : String(l.bankAccounts ?? "-")))
      .join(" ; ")}`,
  );
  return out;
});
