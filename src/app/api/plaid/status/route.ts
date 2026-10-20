import { connection } from "next/server";
import { envConfigured, envName, signedIn, siteCreds } from "@/lib/plaid-server";

export async function GET(req: Request) {
  await connection(); // check the keys on every request, not once at build time
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (envConfigured()) return Response.json({ fromSettings: true, env: envName(), site: false });
  const site = await siteCreds().catch(() => null);
  return Response.json({ fromSettings: false, env: site?.env ?? null, site: Boolean(site) });
}
