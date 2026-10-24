import { credsFrom, handle, plaid, unseal } from "@/lib/plaid-server";

// Starts Plaid Link. With an existing connection, opens Link in update mode to
// fix a bank that needs you to sign in again, or (addAccounts) to pick more of
// that login's accounts to share, such as one left unticked when it was connected.
export const POST = handle(async (body) => {
  const started = Date.now();
  const mode = body.link ? (body.addAccounts ? "add-accounts" : "update") : "new";
  const creds = await credsFrom(body);
  const update = body.link
    ? { access_token: unseal(creds, body.link), ...(body.addAccounts ? { update: { account_selection_enabled: true } } : {}) }
    : { products: ["transactions"], transactions: { days_requested: 730 } };
  const res = await plaid<{ link_token: string }>(creds, "/link/token/create", {
    client_name: "Maverick Personal",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: "maverick-owner" },
    ...update,
  }).catch((e) => {
    console.log(`plaid link-token: mode=${mode} ok=false code=${(e as { code?: string }).code ?? "ERROR"} ms=${Date.now() - started}`);
    throw e;
  });
  console.log(`plaid link-token: mode=${mode} ok=true env=${creds.env} ms=${Date.now() - started}`);
  return { linkToken: res.link_token };
});
