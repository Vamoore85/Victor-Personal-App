import { routeRecurringBills, scan } from "@/lib/gmail";
import { today } from "@/lib/dates";
import { handle } from "../handle";

export const maxDuration = 120;

// Only runs when you press Scan, for the number of days you picked.
export const POST = handle(async (body) => {
  const days = Number(body.days);
  const year = body.year === undefined ? undefined : Number(body.year);
  const result = await scan(Number.isFinite(days) && days > 0 ? days : 90, today(), { year, restart: body.restart === true });
  try {
    const routed = await routeRecurringBills(today());
    return { scan: result, bills: { added: routed.added, linked: routed.linked } };
  } catch {
    // Email progress remains saved even if a separate Bills save needs a retry.
    return { scan: result, billsError: "The email scan was saved. Open Bills to retry routing recurring bills." };
  }
});
