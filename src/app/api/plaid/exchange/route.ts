import { credsFrom, handle, plaid, seal } from "@/lib/plaid-server";

// Trades the one-time token from Plaid Link for a lasting connection, returned sealed.
export const POST = handle(async (body) => {
  const creds = credsFrom(body);
  const res = await plaid<{ access_token: string; item_id: string }>(creds, "/item/public_token/exchange", { public_token: body.publicToken });
  return { itemId: res.item_id, link: seal(creds, res.access_token) };
});
