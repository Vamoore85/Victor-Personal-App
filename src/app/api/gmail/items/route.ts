import { GmailError, review, routeRecurringBills, type ReviewChange } from "@/lib/gmail";
import { today } from "@/lib/dates";
import { handle } from "../handle";

// Your decision on one found email: confirm it with a company, ignore it, fix a field, or link a saved bill.
export const POST = handle(async (body) => {
  if (typeof body.id !== "string" || !body.id) throw new GmailError("Which email?");
  const item = await review(body as unknown as ReviewChange);
  try { await routeRecurringBills(today()); } catch { /* Bills retries routing when opened; the review decision is already saved. */ }
  return { item };
});
