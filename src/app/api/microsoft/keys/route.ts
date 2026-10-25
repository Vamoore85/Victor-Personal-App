import { saveKeys } from "@/lib/microsoft";
import { handle } from "../handle";

export const POST = handle(async (body) => {
  await saveKeys({ clientId: String(body.clientId ?? ""), secret: String(body.secret ?? "") });
  return { ok: true };
});
