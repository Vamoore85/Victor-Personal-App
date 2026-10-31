// Browser check of Maverick's Wade page against a stand-in for Wade's local frame.
// It never talks to the real Wade: it serves its own fake on 127.0.0.1:8790, so stop
// Wade first if it's running on this machine. Needs a built Maverick on BASE
// (default http://localhost:3123) signed in with APP_PASSWORD.
//   APP_PASSWORD=x npx next start -p 3123 &   then   APP_PASSWORD=x node scripts/wade-embed-e2e.mjs
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // the machine-wide Playwright, not a package dependency

const BASE = process.env.BASE || "http://localhost:3123";
const PARENT = new URL(BASE).origin;
let mode = "ready"; // ready | silent | noack | wrongorigin
const received = [];

const fake = http.createServer((req, res) => {
  if (req.url === "/log" && req.method === "POST") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { received.push(JSON.parse(b)); res.end(); });
    return;
  }
  if (!req.url.startsWith("/embed/maverick")) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><body>fake wade (${mode})<script>
    const P = ${JSON.stringify(PARENT)}, mode = ${JSON.stringify(mode)};
    if (mode === "ready" || mode === "noack") parent.postMessage({type:"wade-local-state", state:"ready"}, P);
    if (mode === "wrongorigin") parent.postMessage({type:"wade-local-state", state:"ready", chat:"secret"}, P);
    addEventListener("message", e => {
      fetch("/log", {method:"POST", body: JSON.stringify({origin: e.origin, data: e.data})});
      if (mode === "ready" && e.origin === P && e.data && e.data.type === "wade-local-disconnect")
        parent.postMessage({type:"wade-local-state", state:"disconnected"}, P);
    });
  </script></body>`);
});
await new Promise((r) => fake.listen(8790, "127.0.0.1", r));

const browser = await chromium.launch();
const page = await browser.newPage();
const state = () => page.getAttribute("[data-testid=wade-panel]", "data-wade-state");
const waitState = (s, ms = 10000) => page.waitForSelector(`[data-testid=wade-panel][data-wade-state="${s}"]`, { timeout: ms });

await page.goto(`${BASE}/login`);
assert.equal(await page.evaluate(async (pw) => (await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) })).status, process.env.APP_PASSWORD), 200);

// 1. Nothing loads until a real click; then Wade reports ready.
await page.goto(`${BASE}/wade`);
assert.equal(await state(), "off");
assert.equal(await page.locator("iframe").count(), 0);
const headers = (await page.request.get(`${BASE}/wade`)).headers();
assert.match(headers["content-security-policy"], /frame-src 'self' http:\/\/127\.0\.0\.1:8790/);
await page.getByRole("button", { name: "Show Wade here" }).click();
await waitState("ready");
console.log("ok connected");

// 2. A forged message from Maverick's own window is ignored; Hide keeps the session.
await page.evaluate(() => postMessage({ type: "wade-local-state", state: "needs-connection" }, "*"));
await page.waitForTimeout(300);
assert.equal(await state(), "ready");
await page.getByRole("button", { name: "Hide (stays connected)" }).click();
assert.equal(await state(), "ready");
assert.equal(await page.locator("iframe").count(), 1);
console.log("ok forged message ignored, hide keeps session");

// 3. Disconnect sends only the bare command to Wade and shows Wade's confirmation.
await page.getByRole("button", { name: "Disconnect Maverick from Wade" }).click();
await waitState("disconnected");
assert.equal(await page.locator("iframe").count(), 0);
assert.deepEqual(received.at(-1), { origin: PARENT, data: { type: "wade-local-disconnect" } });
assert.equal(received.length, 1, "nothing else was sent into the frame");
console.log("ok disconnect confirmed");

// 4. No answer from Wade: honest unavailable.
mode = "silent";
await page.getByRole("button", { name: "Show Wade here" }).click();
await waitState("unavailable", 12000);
console.log("ok unavailable");

// 5. Wade doesn't confirm: sign-out isn't claimed.
mode = "noack";
await page.getByRole("button", { name: "Try again" }).click();
await waitState("ready");
await page.getByRole("button", { name: "Disconnect Maverick from Wade" }).click();
await waitState("disconnect-unconfirmed", 6000);
console.log("ok unconfirmed shown");

// 6. Extra fields (a chat payload) make the status message invalid.
mode = "wrongorigin";
await page.getByRole("button", { name: "Show Wade here" }).click();
await waitState("unavailable", 12000);
console.log("ok payload-carrying message ignored");

// 7. Signing out of Maverick disconnects Wade first.
mode = "ready";
received.length = 0;
await page.getByRole("button", { name: "Try again" }).click();
await waitState("ready");
await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true))); // the account menu
await page.getByRole("button", { name: "Sign out" }).first().click();
await page.waitForURL(/\/login/);
assert.deepEqual(received.map((r) => r.data), [{ type: "wade-local-disconnect" }]);
console.log("ok sign-out disconnects Wade first");

await browser.close();
fake.close();
