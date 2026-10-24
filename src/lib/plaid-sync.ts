import { plaid, PlaidError, type PlaidCreds } from "@/lib/plaid-server";
import type { SyncResult } from "@/features/money/plaid-apply";

// Fetching one bank's changes from Plaid: used by the browser's sync call and
// by the server-side refresh, which saves the result straight to the database.

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null };
};

type PlaidTxn = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  personal_finance_category: { primary: string; detailed: string } | null;
};

type SyncPage = {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status?: string;
};

const slim = (t: PlaidTxn) => ({
  id: t.transaction_id,
  accountId: t.account_id,
  amount: t.amount,
  date: t.date,
  name: t.merchant_name || t.name,
  pending: t.pending,
  category: t.personal_finance_category ? `${t.personal_finance_category.primary}|${t.personal_finance_category.detailed}` : "",
});

/** Balances and transaction changes since `start`, up to `pages` pages of 500. */
export async function pullChanges(creds: PlaidCreds, access_token: string, start: string, pages = 8): Promise<SyncResult> {
  let cursor = start;
  let added: PlaidTxn[] = [];
  let modified: PlaidTxn[] = [];
  let removed: string[] = [];
  let hasMore = false;
  let updateStatus = "";
  // If the bank's data changes while paging, Plaid asks to start again from the same cursor.
  for (let attempt = 0; ; attempt++) {
    try {
      for (let page = 0; page < pages; page++) {
        const res = await plaid<SyncPage>(creds, "/transactions/sync", { access_token, cursor: cursor || undefined, count: 500 });
        added.push(...res.added);
        modified.push(...res.modified);
        removed.push(...res.removed.map((r) => r.transaction_id));
        cursor = res.next_cursor;
        hasMore = res.has_more;
        updateStatus = res.transactions_update_status ?? updateStatus;
        if (!res.has_more) break;
      }
      break;
    } catch (e) {
      if (!(e instanceof PlaidError) || e.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || attempt >= 2) throw e;
      cursor = start;
      added = [];
      modified = [];
      removed = [];
    }
  }
  const accounts = await plaid<{ accounts: PlaidAccount[]; item: { institution_id: string | null } }>(creds, "/accounts/get", { access_token });
  let institution = "";
  if (accounts.item.institution_id) {
    const inst = await plaid<{ institution: { name: string } }>(creds, "/institutions/get_by_id", {
      institution_id: accounts.item.institution_id,
      country_codes: ["US"],
    }).catch(() => null);
    institution = inst?.institution.name ?? "";
  }
  return {
    cursor,
    hasMore,
    updateStatus,
    institution,
    accounts: accounts.accounts.map((a) => ({
      id: a.account_id,
      name: a.official_name || a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current: a.balances.current,
      available: a.balances.available,
    })),
    added: added.map(slim),
    modified: modified.map(slim),
    removed,
  };
}
