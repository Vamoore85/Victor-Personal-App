import { cronAuthorized } from "@/features/gmail/automatic";
import { runAutomaticMail } from "@/lib/gmail-automatic";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"),process.env.CRON_SECRET)) return Response.json({error:"Unauthorized"},{status:401});
  try {
    return Response.json(await runAutomaticMail(),{headers:{"Cache-Control":"no-store"}});
  } catch {
    // The signed-in status panel has the useful error; cron responses never include mail contents.
    return Response.json({error:"Email check failed; retry on the next schedule."},{status:503});
  }
}
