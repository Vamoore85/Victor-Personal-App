import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPicked, LinkFailure, runLink, type LinkMeta, type PlaidFactory } from "./plaid-link";

/** A stand-in for Plaid's script: records calls and plays back what the real one does. */
function fakePlaid(behave: { load?: boolean; events?: string[]; success?: LinkMeta; exit?: Parameters<Parameters<PlaidFactory["create"]>[0]["onExit"]>[0] | "closed"; throwOnOpen?: boolean }) {
  const calls: string[] = [];
  const factory: PlaidFactory = {
    create(o) {
      calls.push(`create:${o.token}`);
      if (behave.load !== false) setTimeout(() => o.onLoad?.(), 5);
      return {
        open() {
          calls.push("open");
          if (behave.throwOnOpen) throw new Error("blocked");
          setTimeout(() => {
            for (const e of behave.events ?? []) o.onEvent?.(e);
            if (behave.success) o.onSuccess("public-x", behave.success);
            else if (behave.exit === "closed") o.onExit(null);
            else if (behave.exit) o.onExit(behave.exit);
          }, 5);
        },
        destroy() {
          calls.push("destroy");
        },
      };
    },
  };
  return { factory, calls };
}

test("loader success: waits for Plaid to load, opens once, returns the token and what was picked", async () => {
  const { factory, calls } = fakePlaid({ events: ["OPEN", "SELECT_ACCOUNT"], success: { accounts: [{ mask: "5443" }] } });
  const steps: string[] = [];
  const r = await runLink({ getToken: async () => "link-1", loadScript: async () => factory, onStep: (s) => steps.push(s) });
  assert.equal(r?.publicToken, "public-x");
  assert.deepEqual(r?.meta.accounts?.map((a) => a.mask), ["5443"]);
  assert.deepEqual(steps, ["token", "script", "starting", "open", "finishing"]);
  assert.deepEqual(calls.filter((c) => c === "open"), ["open"]); // opened once, after onLoad
  assert.equal(calls[0], "create:link-1");
});

test("token error: fails with the server's reason, never opens Plaid", async () => {
  const reported: string[] = [];
  const { factory, calls } = fakePlaid({});
  await assert.rejects(
    runLink({ getToken: async () => Promise.reject(Object.assign(new Error("Plaid refused the keys"), { code: "INVALID_API_KEYS" })), loadScript: async () => factory, report: (s, c) => reported.push(`${s}:${c}`) }),
    (e: LinkFailure) => e.stage === "token" && /Plaid refused the keys/.test(e.message),
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(reported, ["token:INVALID_API_KEYS"]);
});

test("script error: fails with a reason instead of hanging", async () => {
  await assert.rejects(runLink({ getToken: async () => "t", loadScript: async () => Promise.reject(new Error("blocked by a content blocker")) }), (e: LinkFailure) => e.stage === "script" && /content blocker/.test(e.message));
});

test("timeout: a window that never appears is closed and reported, not left spinning", async () => {
  const reported: string[] = [];
  const { factory, calls } = fakePlaid({ load: false }); // never loads, never opens
  const t0 = Date.now();
  await assert.rejects(runLink({ getToken: async () => "t", loadScript: async () => factory, openTimeoutMs: 80, loadFallbackMs: 20, report: (s, c) => reported.push(`${s}:${c}`) }), (e: LinkFailure) => e.code === "TIMEOUT");
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(calls.includes("open")); // the fallback still tried to open it
  assert.ok(calls.includes("destroy"));
  assert.deepEqual(reported, ["open:TIMEOUT"]);
});

test("open throwing and Plaid exit errors carry Plaid's reason", async () => {
  const a = fakePlaid({ throwOnOpen: true });
  await assert.rejects(runLink({ getToken: async () => "t", loadScript: async () => a.factory }), (e: LinkFailure) => e.code === "OPEN_THREW");
  const b = fakePlaid({ events: ["OPEN"], exit: { error_code: "ITEM_LOGIN_REQUIRED", display_message: "Sign in again" } });
  await assert.rejects(runLink({ getToken: async () => "t", loadScript: async () => b.factory }), (e: LinkFailure) => e.code === "ITEM_LOGIN_REQUIRED" && /Sign in again/.test(e.message));
});

test("closing the window resolves null (button just resets)", async () => {
  const { factory } = fakePlaid({ events: ["OPEN"], exit: "closed" });
  assert.equal(await runLink({ getToken: async () => "t", loadScript: async () => factory }), null);
});

test("update mode: the existing connection's token is used and the picked ··5443 is recognised", async () => {
  let asked: Record<string, unknown> | null = null;
  const { factory } = fakePlaid({ events: ["OPEN"], success: { accounts: [{ mask: "5105" }, { mask: "5443" }] } });
  const r = await runLink({
    getToken: async () => {
      asked = { link: "sealed-existing", addAccounts: true };
      return "update-token";
    },
    loadScript: async () => factory,
  });
  assert.deepEqual(asked, { link: "sealed-existing", addAccounts: true });
  const pick = checkPicked(r!.meta, "5443", new Set(["5105", "5815", "5249"]));
  assert.equal(pick.hasTarget, true);
  assert.equal(pick.onlyAlreadyConnected, false);
});

test("a login that only has already-connected accounts is recognised (so it isn't saved as a duplicate)", () => {
  const pick = checkPicked({ accounts: [{ mask: "5105" }, { mask: "5815" }, { mask: "5249" }] }, "5443", new Set(["5105", "5815", "5249"]));
  assert.equal(pick.hasTarget, false);
  assert.equal(pick.onlyAlreadyConnected, true);
});
