import { createHmac, timingSafeEqual } from "node:crypto";

// A single-owner password lock. The password lives in the APP_PASSWORD
// environment variable in Vercel; the browser keeps a cookie holding an HMAC
// of it, so changing the password signs out every device.

export const SESSION_COOKIE = "mp_session";
export const SESSION_DAYS = 30;

export function passwordSet() {
  return Boolean(process.env.APP_PASSWORD);
}

export function sessionToken() {
  return createHmac("sha256", process.env.APP_PASSWORD ?? "").update("maverick-session-v1").digest("base64url");
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function validSession(cookie: string | undefined) {
  return passwordSet() && !!cookie && same(cookie, sessionToken());
}

export function correctPassword(attempt: unknown) {
  return passwordSet() && typeof attempt === "string" && same(attempt, process.env.APP_PASSWORD!);
}
