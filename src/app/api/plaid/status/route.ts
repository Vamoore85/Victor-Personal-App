import { connection } from "next/server";
import { plaidConfigured, plaidEnv, signedIn } from "@/lib/plaid-server";

export async function GET(req: Request) {
  await connection(); // check the keys on every request, not once at build time
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ configured: plaidConfigured(), env: plaidEnv() });
}
