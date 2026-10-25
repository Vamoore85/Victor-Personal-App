import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLoginRows, planLoginImport } from "./logins-import";
import type { Institution } from "./types";

/* Made-up logins only. */
test("a pasted sheet with a header row maps its columns by name", () => {
  const text = [
    "Account Name\tWebsite\tUsername\tPassword\tOther Login Details",
    "Example Bank\texample-bank.test\tdemo_user\tdemo-pass-1\tcall line 2",
    "Example Gym\texample-gym.test\tdemo2\tdemo-pass-2\t",
    "\t\t\t\t",
  ].join("\n");
  const { rows, skipped } = parseLoginRows(text);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(rows[0], { company: "Example Bank", website: "example-bank.test", username: "demo_user", password: "demo-pass-1", notes: "call line 2" });
});

test("comma-separated rows with quoted commas and no header use the default column order", () => {
  const { rows } = parseLoginRows('Example Co,example.test,demo,"pass, with comma",\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].password, "pass, with comma");
});

test("rows with no name and no login are skipped, and a company falls back to its website", () => {
  const { rows, skipped } = parseLoginRows("\thttps://www.example-utility.test/pay\tdemo\tdemo-pass\n\tonly-a-site.test\t\t");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, "example-utility.test");
  assert.equal(skipped, 1);
});

test("planning matches existing companies by name and skips logins already in the vault", () => {
  let n = 0;
  const newId = () => `id${++n}`;
  const institutions: Institution[] = [{ id: "bank", name: "Example Bank", type: "Bank", website: "", loginUrl: "", phone: "", memberNumber: "", notes: "", scope: "personal" }];
  const existing = [{ id: "e0", institutionId: "bank", label: "Login", username: "demo_user", password: "demo-pass-1", url: "", notes: "" }];
  const rows = [
    { company: "example bank", website: "", username: "demo_user", password: "demo-pass-1", notes: "" },
    { company: "Example Bank", website: "", username: "demo_user", password: "demo-pass-changed", notes: "" },
    { company: "Example Gym", website: "example-gym.test", username: "demo2", password: "demo-pass-2", notes: "" },
  ];
  const plan = planLoginImport(rows, institutions, existing, "personal", newId);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.entries.length, 2);
  assert.equal(plan.institutions.length, 1, "only the gym is new");
  assert.equal(plan.institutions[0].name, "Example Gym");
  assert.equal(plan.entries[0].institutionId, "bank");
  assert.equal(plan.entries[1].institutionId, plan.institutions[0].id);
});
