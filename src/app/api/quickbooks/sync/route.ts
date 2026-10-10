import { syncReport } from "@/lib/quickbooks";
import { today } from "@/lib/dates";
import { handle } from "../handle";

export const POST = handle(async (body) => {
  const thisYear = Number(today().slice(0, 4));
  const year = Number(body.year);
  return { report: await syncReport(Number.isInteger(year) && year > 2000 && year <= thisYear ? year : thisYear, today()) };
});
