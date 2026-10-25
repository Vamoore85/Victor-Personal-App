import { saveGladiatorLink } from "@/lib/quickbooks";
import { handle } from "../handle";

export const POST = handle(async body => {
  await saveGladiatorLink(typeof body.key === "string" ? body.key.trim() : "");
  return { ok: true };
});
