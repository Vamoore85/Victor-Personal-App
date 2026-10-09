import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSession } from "@/lib/auth";

// Everything except the sign-in page, the public privacy page and static
// files needs the owner's password.
export function proxy(request: NextRequest) {
  if (validSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|trust|api/login|_next/|maverick-logo.png|favicon.ico|icon.png|apple-icon.png|robots.txt).*)"],
};
