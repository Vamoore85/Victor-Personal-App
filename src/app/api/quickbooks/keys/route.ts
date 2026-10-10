import { QboError, saveKeys } from "@/lib/quickbooks";
import { handle } from "../handle";

// Saves the Intuit app's client ID and secret, sealed, in the database.
export const POST = handle(async (body) => {
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  const env = body.env === "sandbox" ? "sandbox" : "production";
  if (!clientId || !secret) throw new QboError("Enter both the client ID and the client secret.");
  await saveKeys({ clientId, secret, env });
  return { ok: true, env };
});
