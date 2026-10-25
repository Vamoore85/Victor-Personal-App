import { events } from "@/lib/calendar";
import { handle } from "../../microsoft/handle";

export const POST = handle(async (body) => events(String(body.from ?? ""), String(body.to ?? "")));
