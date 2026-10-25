import { GmailError, saveKeys } from "@/lib/gmail";
import { handle } from "../handle";

// Saves Google's OAuth client ID and secret, sealed, in the database.
export const POST = handle(async (body) => {
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!clientId || !secret) throw new GmailError("Enter both the client ID and the client secret.");
  await saveKeys({ clientId, secret });
  return { ok: true };
});
