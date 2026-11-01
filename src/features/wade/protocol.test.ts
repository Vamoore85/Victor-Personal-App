import { test } from "node:test";
import assert from "node:assert/strict";
import { disconnectOutcome, isStateMessage, readFrameMessage, sendDisconnect, WADE_FRAME_ALLOW, WADE_FRAME_URL, WADE_ORIGIN } from "./protocol";

const frame = { name: "the frame this page made" };
const msg = (data: unknown, origin = WADE_ORIGIN, source: unknown = frame) => ({ origin, source, data });

test("the frame address is fixed and Maverick-only", () => {
  assert.equal(WADE_ORIGIN, "http://127.0.0.1:8790");
  assert.equal(WADE_FRAME_URL, "http://127.0.0.1:8790/embed/maverick");
});

test("only Wade's two status values are accepted", () => {
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "ready" }), frame), "ready");
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "needs-connection" }), frame), "needs-connection");
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "connected" }), frame), null);
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "READY" }), frame), null);
});

test("messages from any other origin are ignored, including CRM, localhost and Maverick itself", () => {
  for (const origin of ["http://localhost:8790", "https://127.0.0.1:8790", "http://127.0.0.1:8791", "https://eva-app-build.vercel.app", "https://maverick-personal.vercel.app", "null", ""]) {
    assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "ready" }, origin), frame), null, origin);
  }
});

test("messages from another window, or before a frame exists, are ignored", () => {
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "ready" }, WADE_ORIGIN, { other: true }), frame), null);
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "ready" }, WADE_ORIGIN, null), frame), null);
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "ready" }), null), null);
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "ready" }), undefined), null);
});

test("no conversation, token or request payloads get through", () => {
  const rejects: unknown[] = [
    { type: "wade-local-state", state: "ready", chat: "hello" },
    { type: "wade-local-state", state: "ready", access_token: "a.b.c" },
    { type: "wade-crm-request", request_id: "8f14e45f-ceea-4672-9b1a-1c3d5e6f7a8b" },
    { type: "wade-crm-access", request_id: "x", access_token: "a.b.c", view: "wade" },
    { type: "wade-local-state" },
    { state: "ready" },
    ["wade-local-state", "ready"],
    "wade-local-state:ready",
    JSON.stringify({ type: "wade-local-state", state: "ready" }),
    null,
    undefined,
    42,
  ];
  for (const data of rejects) assert.equal(readFrameMessage(msg(data), frame), null, JSON.stringify(data));
});

test("look-alike objects are rejected", () => {
  const withProto = Object.assign(Object.create({ extra: 1 }), { type: "wade-local-state", state: "ready" });
  assert.equal(isStateMessage(withProto), false);
  const withSymbol = { type: "wade-local-state", state: "ready", [Symbol("x")]: 1 };
  assert.equal(isStateMessage(withSymbol), false);
  const throwing = new Proxy({}, { ownKeys() { throw new Error("no"); } });
  assert.equal(readFrameMessage(msg(throwing), frame), null);
});

test("Wade's disconnect answers are read, and only a confirmation counts as signed out", () => {
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "disconnected" }), frame), "disconnected");
  assert.equal(readFrameMessage(msg({ type: "wade-local-state", state: "disconnect-unconfirmed" }), frame), "disconnect-unconfirmed");
  assert.equal(disconnectOutcome("disconnected"), "disconnected");
  assert.equal(disconnectOutcome("disconnect-unconfirmed"), "disconnect-unconfirmed");
  assert.equal(disconnectOutcome("timeout"), "disconnect-unconfirmed");
  assert.equal(disconnectOutcome(null), "disconnect-unconfirmed");
  assert.equal(disconnectOutcome("ready"), "disconnect-unconfirmed");
});

test("the only thing Maverick sends is the bare disconnect, to Wade's exact origin", () => {
  const sent: [unknown, string][] = [];
  assert.equal(sendDisconnect({ postMessage: (m, o) => sent.push([m, o]) }), true);
  assert.deepEqual(sent, [[{ type: "wade-local-disconnect" }, "http://127.0.0.1:8790"]]);
  assert.deepEqual(Object.keys(sent[0][0] as object), ["type"]);
  assert.equal(sendDisconnect(null), false);
  assert.equal(sendDisconnect({ postMessage: () => { throw new Error("closed"); } }), false);
});

test("the frame names every Chrome local-access permission, only for Wade's exact address", () => {
  assert.equal(
    WADE_FRAME_ALLOW,
    "local-network-access http://127.0.0.1:8790; local-network http://127.0.0.1:8790; loopback-network http://127.0.0.1:8790; autoplay http://127.0.0.1:8790",
  );
  assert.ok(!WADE_FRAME_ALLOW.includes("*"));
});
