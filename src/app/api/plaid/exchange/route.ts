import { dbConfigured } from "@/lib/db";
import { updateMoney } from "@/lib/money-doc";
import { credsFrom, handle, plaid, seal } from "@/lib/plaid-server";
import type { BankLink, Scope } from "@/features/money/types";

// Trades the one-time token from Plaid Link for a lasting connection, returned
// sealed. With the online database, the connection is saved there at once, so
// it can't be lost by a browser that hasn't finished saving.
export const POST = handle(async (body) => {
  const creds = await credsFrom(body);
  const res = await plaid<{ access_token: string; item_id: string }>(creds, "/item/public_token/exchange", { public_token: body.publicToken });
  const link = seal(creds, res.access_token);
  let saved = false;
  if (dbConfigured() && typeof body.id === "string") {
    const bank: BankLink = {
      id: body.id,
      itemId: res.item_id,
      institution: "",
      link,
      cursor: "",
      scope: typeof body.scope === "string" ? (body.scope as Scope) : undefined,
      connectedAt: new Date().toISOString(),
    };
    // If saving fails the browser still has the connection and saves it with the rest.
    saved = await updateMoney((d) => (d.bankLinks.some((l) => l.id === bank.id) ? d : { ...d, bankLinks: [...d.bankLinks, bank] }))
      .then(() => true)
      .catch(() => false);
  }
  return { itemId: res.item_id, link, saved };
});
