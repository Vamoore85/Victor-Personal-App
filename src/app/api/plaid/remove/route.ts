import { handle, plaid, unseal } from "@/lib/plaid-server";

// Disconnects a bank at Plaid so it stops being billed and synced.
export const POST = handle(async (body) => {
  await plaid("/item/remove", { access_token: unseal(body.link) });
  return { ok: true };
});
