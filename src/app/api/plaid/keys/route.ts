import { handle, plaid, PlaidError, saveSiteCreds, sealCreds } from "@/lib/plaid-server";

// Checks Plaid keys typed into the Financial Center and saves them, sealed,
// for the whole site so they're entered once. Without the online database the
// sealed copy goes back to the browser to keep on that device.
export const POST = handle(async (body) => {
  if (body.remove === true) {
    await saveSiteCreds(null);
    return { removed: true };
  }
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
  const site = await saveSiteCreds(creds);
  return { keys: site ? undefined : sealCreds(creds), env, site };
});
