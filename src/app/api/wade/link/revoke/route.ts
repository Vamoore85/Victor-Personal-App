import { publicLinks, revokeLink } from "@/lib/wade-link";
import { updateLinks } from "@/lib/wade-link-store";
import { linkFailure, ownerOnly } from "../handle";

export async function POST(req: Request) {
  const denied = ownerOnly(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string") return Response.json({ error: "Choose a Wade link." }, { status: 400 });
  try {
    const links = await updateLinks((s) => {
      const state = revokeLink(s, body.id as string);
      return { state, value: publicLinks(state, Date.now()) };
    });
    return Response.json({ ok: true, links });
  } catch (e) {
    return linkFailure(e, "wade link revoke");
  }
}
