import { handle, plaid, PlaidError, sealCreds } from "@/lib/plaid-server";

// Checks Plaid keys typed into the Financial Center and hands them back sealed,
// so the browser can keep them without being able to read them.
export const POST = handle(async (body) => {
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  const env = body.env === "production" ? "production" : "sandbox";
  if (!clientId || !secret) throw new PlaidError("Enter both the client ID and the secret.", "BAD_REQUEST");
  const creds = { clientId, secret, env };
  await plaid(creds, "/institutions/get", { count: 1, offset: 0, country_codes: ["US"] }).catch((e) => {
    throw new PlaidError(
      e instanceof PlaidError && e.status < 500 ? `Plaid didn't accept those keys for ${env === "sandbox" ? "Sandbox" : "Production"}: ${e.message}` : "Couldn't reach Plaid to check the keys.",
      "BAD_KEYS",
    );
  });
  return { keys: sealCreds(creds), env };
});
