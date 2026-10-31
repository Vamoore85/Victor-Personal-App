import { fullSession, rememberedUntil } from "./auth";

/** Enrollment needs both a full existing sign-in and an explicit same-origin request. */
export function mayRememberDevice(req: Request, cookie: string | undefined) {
  return req.headers.get("origin") === new URL(req.url).origin && fullSession(cookie);
}

export function deviceStatus(cookie: string | undefined) {
  return { rememberedUntil: rememberedUntil(cookie) };
}
