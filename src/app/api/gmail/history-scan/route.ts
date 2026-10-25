import { cronAuthorized } from "@/features/gmail/automatic";
import { runHistoryImport } from "@/lib/gmail-history";

export const maxDuration = 120;
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"),process.env.CRON_SECRET)) return Response.json({error:"Unauthorized"},{status:401});
  try {return Response.json(await runHistoryImport(),{headers:{"Cache-Control":"no-store"}});}
  catch {return Response.json({error:"History import failed; saved progress will retry."},{status:503});}
}
