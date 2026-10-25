import { routeRecurringBills } from "@/lib/gmail";
import { today } from "@/lib/dates";
import { handle } from "../handle";

export const POST = handle(async () => routeRecurringBills(today()));
