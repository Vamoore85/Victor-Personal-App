import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(__dirname, "route.ts"), "utf8");

test("the Wade MCP route starts with a one-line comment saying it is read-only", () => {
  const first = source.split("\n")[0];
  assert.ok(first.startsWith("//"), "first line is a line comment");
  assert.match(first, /read-only/i);
});

test("the route only exposes POST and a 405 GET; no other HTTP verbs", () => {
  const verbs = [...source.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(verbs, ["POST", "GET"]);
});
