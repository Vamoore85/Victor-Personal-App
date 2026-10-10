import { connection } from "next/server";
import { cachedReport, redirectUri, status } from "@/lib/quickbooks";
import { handle } from "../handle";

export async function GET(req: Request) {
  await connection();
  return handle(async (_body, r) => {
    const year = Number(new URL(r.url).searchParams.get("year")) || new Date().getFullYear();
    return { ...(await status()), redirectUri: redirectUri(new URL(r.url).origin), report: await cachedReport(year) };
  })(req);
}
