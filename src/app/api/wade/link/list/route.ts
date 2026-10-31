import { connection } from "next/server";
import { publicLinks } from "@/lib/wade-link";
import { readLinks } from "@/lib/wade-link-store";
import { linkFailure, ownerOnly } from "../handle";

export async function GET(req: Request) {
  await connection();
  const denied = ownerOnly(req, true);
  if (denied) return denied;
  try {
    return Response.json({ links: publicLinks(await readLinks(), Date.now()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return linkFailure(e, "wade link list");
  }
}
