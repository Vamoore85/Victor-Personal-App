import { disconnect } from "@/lib/quickbooks";
import { handle } from "../handle";

export const POST = handle(async () => {
  await disconnect();
  return { ok: true };
});
