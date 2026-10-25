import { scan } from "@/lib/gmail";
import { today } from "@/lib/dates";
import { handle } from "../handle";

export const maxDuration = 60;

// Only runs when you press Scan, for the number of days you picked.
export const POST = handle(async (body) => {
  const days = Number(body.days);
  return { scan: await scan(Number.isFinite(days) && days > 0 ? days : 90, today()) };
});
