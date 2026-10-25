import { historyImportStatus, runHistoryImport, setHistoryImport } from "@/lib/gmail-history";
import { GmailError } from "@/lib/gmail";
import { handle } from "../handle";

export const maxDuration = 120;
export const GET = handle(async()=>({history:await historyImportStatus()}));
export const POST = handle(async body=> {
  if (body.checkNow === true) return {result:await runHistoryImport(),history:await historyImportStatus()};
  if (typeof body.enabled !== "boolean") throw new GmailError("Choose whether the history import should run.");
  return {history:await setHistoryImport(body.enabled)};
});
