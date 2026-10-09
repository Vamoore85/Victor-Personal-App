import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, setupSession, validSession } from "@/lib/auth";

// Everything except the sign-in page, the public privacy page and static
// files needs the owner's password and authenticator code. A device signed in
// with the password alone (from before 2-step sign-in) is sent to finish setup.
export function proxy(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (validSession(cookie)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const setupPath = pathname === "/security" || pathname === "/api/2fa/verify";
  if (setupPath && setupSession(cookie)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (setupSession(cookie)) return NextResponse.redirect(new URL("/security", request.url));
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|trust|api/login|_next/|maverick-logo.png|favicon.ico|icon.png|apple-icon.png|robots.txt).*)"],
};
