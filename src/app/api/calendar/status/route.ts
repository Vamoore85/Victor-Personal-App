import { connection } from "next/server";
import { googleRedirectUri, status } from "@/lib/calendar";
import { redirectUri as microsoftRedirect } from "@/lib/microsoft";
import { handle } from "../../microsoft/handle";

export async function GET(req: Request) {
  await connection();
  return handle(async (_body, r) => {
    const origin = new URL(r.url).origin;
    return { ...(await status()), googleRedirectUri: googleRedirectUri(origin), microsoftRedirectUri: microsoftRedirect(origin) };
  })(req);
}
