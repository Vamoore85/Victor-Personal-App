import { connection } from "next/server";
import { plaidConfigured, plaidEnv } from "@/lib/plaid-server";

export async function GET() {
  await connection(); // check the keys on every request, not once at build time
  return Response.json({ configured: plaidConfigured(), env: plaidEnv() });
}
