import { credsFrom, handle, unseal } from "@/lib/plaid-server";
import { pullChanges } from "@/lib/plaid-sync";

// A first sync can bring in two years of history, a few thousand rows a call.
export const maxDuration = 60;

// Fetches balances and every transaction change since the last sync (the browser saves them).
export const POST = handle(async (body) => {
  const creds = await credsFrom(body);
  const access_token = unseal(creds, body.link);
  return pullChanges(creds, access_token, typeof body.cursor === "string" ? body.cursor : "");
});
