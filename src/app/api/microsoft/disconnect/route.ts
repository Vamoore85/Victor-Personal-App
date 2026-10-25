import { disconnect } from "@/lib/microsoft";
import { handle } from "../handle";

export const POST = handle(async () => {
  await disconnect();
  return { ok: true };
});
