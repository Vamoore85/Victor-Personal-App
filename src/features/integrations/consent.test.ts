import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, merge, setAllowed } from "./consent";

test("everything starts off; a sensitive capability also needs (and turns on) read-only status", () => {
  assert.deepEqual(EMPTY.apps, {});
  const c = setAllowed(EMPTY, "ring", "camera", true, "t1");
  assert.deepEqual(c.apps.ring.allowed, { camera: true, status: true });
  assert.equal((c.apps.ring.allowed as Record<string, boolean>).control, undefined);
});

test("turning off status turns every capability off", () => {
  let c = setAllowed(EMPTY, "ring", "control", true, "t1");
  c = setAllowed(c, "ring", "status", false, "t2");
  assert.deepEqual(c.apps.ring.allowed, {});
});

test("the newer choice wins across devices", () => {
  const a = setAllowed(EMPTY, "ring", "camera", true, "2026-10-24T10:00:00Z");
  const b = setAllowed(EMPTY, "ring", "status", true, "2026-10-24T11:00:00Z");
  assert.deepEqual(merge(a, b).apps.ring.allowed, { status: true });
});
