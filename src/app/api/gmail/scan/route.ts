import { scan } from "@/lib/gmail";
import { today } from "@/lib/dates";
import { handle } from "../handle";

export const maxDuration = 120;

// Only runs when you press Scan, for the number of days you picked.
export const POST = handle(async (body) => {
  const days = Number(body.days);
  const year = body.year === undefined ? undefined : Number(body.year);
  return { scan: await scan(Number.isFinite(days) && days > 0 ? days : 90, today(), { year, restart: body.restart === true }) };
});
