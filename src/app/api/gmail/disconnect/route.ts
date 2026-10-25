import { disconnect } from "@/lib/gmail";
import { handle } from "../handle";

export const POST = handle(async () => {
  await disconnect();
  return { ok: true };
});
