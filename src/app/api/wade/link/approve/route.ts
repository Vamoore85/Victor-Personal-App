import { approveLink, normalizeCode, publicLinks } from "@/lib/wade-link";
import { updateLinks } from "@/lib/wade-link-store";
import { linkFailure, ownerOnly } from "../handle";

export async function POST(req: Request) {
  const denied = ownerOnly(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = normalizeCode(body?.code);
  if (!code) return Response.json({ error: "Enter the 8-character code Wade shows." }, { status: 400 });
  try {
    const links = await updateLinks((s) => {
      const r = approveLink(s, code, Date.now());
      return { state: r.state, value: publicLinks(r.state, Date.now()) };
    });
    return Response.json({ ok: true, links });
  } catch (e) {
    return linkFailure(e, "wade link approve");
  }
}
