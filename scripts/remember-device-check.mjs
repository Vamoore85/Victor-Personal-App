// Real HTTP route checks against a local Next server, using synthetic auth only.
// No live credentials, browser cookie copies, providers or paid model calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { rememberedSessionToken, sessionToken } from "../src/lib/auth.ts";

process.env.APP_PASSWORD = "synthetic-remember-route-test-only";
process.env.MFA_REQUIRED = "1";
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://localhost:3298";
// Refuse to interfere with a service already using the fixture's port.
if (await fetch(base).then(() => true).catch(() => false)) throw new Error("Fixture port 3298 is already in use; no service was stopped.");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3298", "-H", "127.0.0.1"], {
  cwd: root, env: { ...process.env, MFA_SETUP_OPEN: "0" }, stdio: "ignore",
});
const call = (path, { cookie, origin, body, method = body === undefined ? "GET" : "POST" } = {}) => fetch(`${base}${path}`, {
  method, redirect: "manual", headers: {
    ...(cookie ? { cookie: `mp_session=${cookie}` } : {}),
    ...(origin ? { origin } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Fixture server stopped before becoming ready.");
    if (await fetch(`${base}/login`).then((res) => res.ok).catch(() => false)) { ready = true; break; }
    await pause(100);
  }
  assert.equal(ready, true, "Fixture server became ready");
  const full = sessionToken("full");
  const passwordOnly = sessionToken("password");
  const path = "/api/session/remember";
  assert.equal((await call(path)).status, 401, "A new browser remains signed out");
  assert.equal((await call(path, { body: { remember: true }, origin: base })).status, 401);
  assert.equal((await call(path, { cookie: passwordOnly, body: { remember: true }, origin: base })).status, 401);
  for (const origin of [undefined, "https://attacker.example"]) {
    assert.equal((await call(path, { cookie: full, body: { remember: true }, origin })).status, 403);
  }
  for (const body of [{ remember: "true" }, { remember: false }, { remember: true, days: 999 }]) {
    assert.equal((await call(path, { cookie: full, body, origin: base })).status, 400);
  }
  const needCode = await call("/api/login", { body: { password: process.env.APP_PASSWORD, remember: true }, origin: base });
  assert.equal(needCode.headers.get("set-cookie"), null, "Remember cannot skip the first MFA check");
  assert.deepEqual(await needCode.json(), { needCode: true });

  const remembered = await call(path, { cookie: full, body: { remember: true }, origin: base });
  assert.equal(remembered.status, 200);
  assert.equal(remembered.headers.get("cache-control"), "no-store");
  const setCookie = remembered.headers.get("set-cookie");
  assert.match(setCookie, /Max-Age=7776000/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Secure/i);
  const token = setCookie.match(/^mp_session=([^;]+)/)[1];
  const until = (await remembered.json()).rememberedUntil;
  assert.ok(until > Date.now() + 89 * 86_400_000);
  const restored = await call(path, { cookie: token });
  assert.deepEqual(await restored.json(), { rememberedUntil: until });
  assert.equal((await call("/wade", { cookie: token })).status, 200);
  assert.equal((await call(path, { cookie: `${token}x` })).status, 401);
  assert.equal((await call(path, { cookie: rememberedSessionToken(Date.now() - 91 * 86_400_000) })).status, 401);

  const logout = await call("/api/logout", { cookie: token, method: "POST", origin: base });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /^mp_session=;/);
  assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await call(path)).status, 401, "Clearing the cookie ends this browser's sign-in");
  console.log("Remember-device live HTTP checks passed: first MFA, enrollment, origin, expiry, restore, protected route and logout.");
} finally {
  server.kill("SIGTERM");
}
