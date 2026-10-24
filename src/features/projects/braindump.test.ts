import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, merge, newThought, normalize, update, visible } from "./braindump";

test("a pasted link is recognised and #tags are picked up", () => {
  assert.equal(newThought(" https://example.com/article ", "typed", "a").source, "link");
  const t = newThought("Call the roofer #house #Maverick", "typed", "b");
  assert.equal(t.source, "typed");
  assert.deepEqual(t.tags, ["house", "maverick"]);
  assert.equal(t.kind, "inbox");
});

test("two devices' copies merge without losing a thought; the newer edit wins; deletes stick", () => {
  const a = newThought("one", "typed", "1", "2026-10-24T10:00:00Z");
  const b = newThought("two", "typed", "2", "2026-10-24T10:01:00Z");
  const phone = { thoughts: [a, b] };
  const desk = update({ thoughts: [a] }, "1", { kind: "task" }, "2026-10-24T11:00:00Z");
  const gone = update(phone, "2", { deleted: true }, "2026-10-24T12:00:00Z");
  const m = merge(desk, gone);
  assert.equal(m.thoughts.length, 2);
  assert.equal(m.thoughts.find((t) => t.id === "1")!.kind, "task");
  assert.deepEqual(visible(m).map((t) => t.id), ["1"]);
});

test("bad saved data opens as an empty inbox", () => {
  assert.deepEqual(normalize(null), EMPTY);
  assert.deepEqual(normalize({ thoughts: [{ nope: 1 }] }), { thoughts: [] });
});
