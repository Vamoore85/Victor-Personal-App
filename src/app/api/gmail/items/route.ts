import { GmailError, review, type ReviewChange } from "@/lib/gmail";
import { handle } from "../handle";

// Your decision on one found email: confirm it with a company, ignore it, fix a field, or link a saved bill.
export const POST = handle(async (body) => {
  if (typeof body.id !== "string" || !body.id) throw new GmailError("Which email?");
  return { item: await review(body as unknown as ReviewChange) };
});
