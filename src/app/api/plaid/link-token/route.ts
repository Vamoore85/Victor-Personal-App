import { handle, plaid, unseal } from "@/lib/plaid-server";

// Starts Plaid Link. With an existing connection, opens Link in update mode to
// fix a bank that needs you to sign in again.
export const POST = handle(async (body) => {
  const update = body.link ? { access_token: unseal(body.link) } : { products: ["transactions"], transactions: { days_requested: 730 } };
  const res = await plaid<{ link_token: string }>("/link/token/create", {
    client_name: "Maverick Personal",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: "maverick-owner" },
    ...update,
  });
  return { linkToken: res.link_token };
});
