import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { REMEMBER_DAYS, cookieOptions, fullSession, rememberedSessionToken, rememberedUntil, sessionToken, setupSession, validSession } from "./auth";
import { deviceStatus, mayRememberDevice } from "./remember-device";

const originalPassword = process.env.APP_PASSWORD;
const originalMfa = process.env.MFA_REQUIRED;
afterEach(() => {
  if (originalPassword === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = originalPassword;
  if (originalMfa === undefined) delete process.env.MFA_REQUIRED; else process.env.MFA_REQUIRED = originalMfa;
});
function fixture() { process.env.APP_PASSWORD = "synthetic-remember-test-only"; process.env.MFA_REQUIRED = "1"; }
const request = (origin?: string) => new Request("https://maverick.example/api/session/remember", { method: "POST", headers: origin ? { origin } : {} });

test("remembered sessions survive reopening but expire at the fixed server deadline", () => {
  fixture();
  const now = Date.now();
  const token = rememberedSessionToken(now);
  const expires = now + REMEMBER_DAYS * 86_400_000;
  assert.equal(rememberedUntil(token, expires - 1), expires);
  assert.equal(rememberedUntil(token, expires), null);
  assert.equal(rememberedUntil(token, now - 1), null);
  assert.equal(validSession(token), true);
  assert.equal(setupSession(token), true);
  assert.deepEqual(deviceStatus(token), { rememberedUntil: expires });
  assert.deepEqual(cookieOptions(REMEMBER_DAYS), { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 90 * 86_400 });
});

test("new devices receive unique sessions and forged, malformed or changed tokens fail closed", () => {
  fixture();
  const token = rememberedSessionToken();
  assert.notEqual(token, rememberedSessionToken());
  const parts = token.split(".");
  const modified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  modified.expiresAt += 86_400_000;
  const changedPayload = `r1.${Buffer.from(JSON.stringify(modified)).toString("base64url")}.${parts[2]}`;
  for (const value of [undefined, "", "r1", `${token}.extra`, `${token}x`, changedPayload, "r1.bad.bad", "a".repeat(1024)]) {
    assert.equal(rememberedUntil(value), null);
    assert.equal(validSession(value), false);
  }
});

test("a password-only cookie cannot enroll itself, with or without MFA enabled", () => {
  fixture();
  const cookie = sessionToken("password");
  assert.equal(mayRememberDevice(request("https://maverick.example"), cookie), false);
  process.env.MFA_REQUIRED = "0";
  assert.equal(fullSession(cookie), false);
  assert.equal(mayRememberDevice(request("https://maverick.example"), cookie), false);
});

test("remember enrollment requires full sign-in and an explicit exact-origin request", () => {
  fixture();
  const token = sessionToken("full");
  assert.equal(mayRememberDevice(request("https://maverick.example"), token), true);
  for (const origin of [undefined, "null", "https://other.example", "https://maverick.example.attacker.test"]) {
    assert.equal(mayRememberDevice(request(origin), token), false);
  }
  assert.equal(mayRememberDevice(request("https://maverick.example"), undefined), false);
  assert.equal(mayRememberDevice(request("https://maverick.example"), rememberedSessionToken()), true);
});

test("password rotation and cookie removal invalidate the remembered session", () => {
  fixture();
  const token = rememberedSessionToken();
  assert.equal(validSession(token), true);
  process.env.APP_PASSWORD = "changed-synthetic-test-only";
  assert.equal(validSession(token), false);
  assert.equal(validSession(undefined), false);
  delete process.env.APP_PASSWORD;
  assert.equal(validSession(token), false);
});

test("standard existing full sessions still work without silently remembering the device", () => {
  fixture();
  const token = sessionToken("full");
  assert.equal(validSession(token), true);
  assert.equal(fullSession(token), true);
  assert.deepEqual(deviceStatus(token), { rememberedUntil: null });
  assert.equal(cookieOptions().maxAge, 30 * 86_400);
});
