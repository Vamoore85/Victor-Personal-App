import { createHmac, timingSafeEqual } from "node:crypto";

// A single-owner lock: a password plus a 6-digit code from an authenticator
// app. The password lives in the APP_PASSWORD environment variable in Vercel,
// and the authenticator secret is derived from it, so there's nothing else to
// store. Changing the password signs out every device and resets the
// authenticator, which then has to be scanned again.
//
// The browser keeps a cookie holding an HMAC for one of two levels:
//   "full"     - password and code; opens the whole app.
//   "password" - password only (cookies issued before 2-step sign-in existed);
//                opens just the 2-step setup page, so that device can finish
//                setting up the authenticator.

export const SESSION_COOKIE = "mp_session";
export const SESSION_DAYS = 30;

type Level = "full" | "password";

export function passwordSet() {
  return Boolean(process.env.APP_PASSWORD);
}

const hmac = (label: string) => createHmac("sha256", process.env.APP_PASSWORD ?? "").update(label);

export function sessionToken(level: Level = "full") {
  return hmac(level === "full" ? "maverick-session-v2:full" : "maverick-session-v1").digest("base64url");
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function levelOf(cookie: string | undefined): Level | null {
  if (!passwordSet() || !cookie) return null;
  if (same(cookie, sessionToken("full"))) return "full";
  if (same(cookie, sessionToken("password"))) return "password";
  return null;
}

/** Signed in with password and code. */
export function validSession(cookie: string | undefined) {
  const level = levelOf(cookie);
  return level === "full" || (level === "password" && !codeRequired());
}

/** Allowed on the 2-step setup page: any session, including a password-only one. */
export function setupSession(cookie: string | undefined) {
  return levelOf(cookie) !== null;
}

/**
 * The 6-digit code is off unless MFA_REQUIRED=1 is set in Vercel; until then
 * the password alone signs in fully. Plaid's application says MFA is on, so
 * set it before Plaid reviews the app or before connecting real banks.
 */
export function codeRequired() {
  return process.env.MFA_REQUIRED === "1";
}

/**
 * Recovery for a lost phone: with MFA_SETUP_OPEN=1 in Vercel, the password
 * alone signs in to the setup page so a new authenticator can be scanned.
 */
export function setupOpen() {
  return process.env.MFA_SETUP_OPEN === "1";
}

export function correctPassword(attempt: unknown) {
  return passwordSet() && typeof attempt === "string" && same(attempt, process.env.APP_PASSWORD!);
}

/* ---- Authenticator codes (TOTP, RFC 6238: SHA-1, 30 seconds, 6 digits) ---- */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(buf: Buffer) {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

const totpKey = () => hmac("maverick-totp-v1").digest().subarray(0, 20);

/** The secret to put in an authenticator app, in base32. */
export function totpSecret() {
  return base32(totpKey());
}

export function totpUri() {
  const label = encodeURIComponent("Maverick Personal:Owner");
  return `otpauth://totp/${label}?secret=${totpSecret()}&issuer=${encodeURIComponent("Maverick Personal")}&algorithm=SHA1&digits=6&period=30`;
}

function codeAt(step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", totpKey()).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Accepts the current code and the ones just before and after, for clock drift. */
export function correctCode(attempt: unknown, now = Date.now()) {
  if (!passwordSet() || typeof attempt !== "string") return false;
  const code = attempt.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30_000);
  return [step - 1, step, step + 1].some((s) => same(codeAt(s), code));
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
