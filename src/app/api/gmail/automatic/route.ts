import { automaticStatus, runAutomaticMail, setAutomaticMail } from "@/lib/gmail-automatic";
import { GmailError } from "@/lib/gmail";
import { handle } from "../handle";

export const maxDuration = 120;
export const GET = handle(async () => ({automatic:await automaticStatus()}));
export const POST = handle(async body => {
  if (body.checkNow === true) return {result:await runAutomaticMail(),automatic:await automaticStatus()};
  if (typeof body.enabled !== "boolean") throw new GmailError("Choose whether automatic email checks should be on.");
  return {automatic:await setAutomaticMail(body.enabled)};
});
