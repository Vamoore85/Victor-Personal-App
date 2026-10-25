import { connection } from "next/server";
import { redirectUri, status, MS_SCOPES, TEAMS_SCOPES, TEAMS_ADMIN_SCOPES } from "@/lib/microsoft";
import { handle } from "../handle";

export async function GET(req: Request) {
  await connection();
  return handle(async (_body, r) => ({ ...(await status()), redirectUri: redirectUri(new URL(r.url).origin), scopes: MS_SCOPES, teamsScopes: TEAMS_SCOPES, teamsAdminScopes: TEAMS_ADMIN_SCOPES }))(req);
}
