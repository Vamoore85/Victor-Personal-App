import { credsFrom, handle, plaid, unseal } from "@/lib/plaid-server";

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

// Fetches balances and every transaction change since the last sync.
export const POST = handle(async (body) => {
  const creds = credsFrom(body);
  const access_token = unseal(creds, body.link);
  let cursor = typeof body.cursor === "string" ? body.cursor : "";
  const added: PlaidTxn[] = [];
  const modified: PlaidTxn[] = [];
  const removed: string[] = [];
  for (let page = 0; page < 50; page++) {
    const res = await plaid<SyncPage>(creds, "/transactions/sync", { access_token, cursor: cursor || undefined, count: 500 });
    added.push(...res.added);
    modified.push(...res.modified);
    removed.push(...res.removed.map((r) => r.transaction_id));
    cursor = res.next_cursor;
    if (!res.has_more) break;
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
    institution,
    accounts: accounts.accounts.map((a) => ({
      id: a.account_id,
      name: a.official_name || a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current: a.balances.current,
    })),
    added: added.map(slim),
    modified: modified.map(slim),
    removed,
  };
});
