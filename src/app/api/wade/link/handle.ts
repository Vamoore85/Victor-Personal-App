import { SESSION_COOKIE, fullSession } from "@/lib/auth";
import { LinkError } from "@/lib/wade-link";

/** Approving or disconnecting Wade needs this site's own page and a full (2-step) sign-in. */
export function ownerOnly(req: Request, read = false) {
  const origin = req.headers.get("origin");
  if (read ? origin !== null && origin !== new URL(req.url).origin : origin !== new URL(req.url).origin)
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!fullSession(cookie)) return Response.json({ error: "Sign in with your code first." }, { status: 401 });
  return null;
}

export function linkFailure(e: unknown, what: string) {
  if (e instanceof LinkError) return Response.json({ error: e.message }, { status: e.status });
  console.error(what, e);
  return Response.json({ error: "Something went wrong saving the Wade link." }, { status: 502 });
}
