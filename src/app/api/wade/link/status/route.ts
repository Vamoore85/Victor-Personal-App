import { connection } from "next/server";
import { dbConfigured } from "@/lib/db";
import { bearer, findByToken, linkStatus, ownerToken } from "@/lib/wade-link";
import { readLinks } from "@/lib/wade-link-store";

// Wade polls this with its own token while Victor approves in Maverick.
export async function GET(req: Request) {
  await connection();
  const token = bearer(req.headers.get("authorization"));
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (ownerToken(token)) return Response.json({ status: "approved", expires_at: null }, { headers: { "Cache-Control": "no-store" } });
  if (!dbConfigured()) return Response.json({ error: "Maverick's database isn't set up." }, { status: 503 });
  try {
    const link = findByToken(await readLinks(), token);
    const status = linkStatus(link, Date.now());
    return Response.json({ status, expires_at: link && status === "approved" ? new Date(link.expiresAt).toISOString() : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("wade link status", e);
    return Response.json({ error: "Couldn't check the Wade link." }, { status: 502 });
  }
}
