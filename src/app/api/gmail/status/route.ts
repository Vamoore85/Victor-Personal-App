import { connection } from "next/server";
import { MAX_DAYS, readItems, redirectUri, status } from "@/lib/gmail";
import { handle } from "../handle";

export async function GET(req: Request) {
  await connection();
  return handle(async (_body, r) => {
    const [s, doc] = await Promise.all([status(), readItems()]);
    return { ...s, maxDays: MAX_DAYS, redirectUri: redirectUri(new URL(r.url).origin), items: doc.items };
  })(req);
}
