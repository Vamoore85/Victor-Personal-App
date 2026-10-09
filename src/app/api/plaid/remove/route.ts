import { credsFrom, handle, plaid, unseal } from "@/lib/plaid-server";

// Disconnects a bank at Plaid so it stops being billed and synced.
export const POST = handle(async (body) => {
  const creds = credsFrom(body);
  await plaid(creds, "/item/remove", { access_token: unseal(creds, body.link) });
  return { ok: true };
});
