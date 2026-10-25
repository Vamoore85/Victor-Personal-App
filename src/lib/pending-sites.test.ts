import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPendingSites } from "./pending-sites";
import { EMPTY_DATA, type MoneyData } from "@/features/money/types";

// Made-up sites (no real names).
const raw = JSON.stringify({
  sites: [
    ["personal", "Example Insurance", "insure.example", "Car Insurance"],
    ["personal", "Example Bank Login", "www.bank.example", "Banking"],
    ["gladiator", "Example Bank Login", "bank.example", ""],
    ["gladiator", "Old Portal", "", ""],
    ["gladiator", "Example Bank Second Account", "bank.example", ""],
  ],
  check: { count: 5 },
});
const base: MoneyData = {
  ...EMPTY_DATA,
  institutions: [{ id: "i1", name: "Example Bank", type: "Bank", website: "https://bank.example", loginUrl: "", phone: "", memberNumber: "", notes: "", scope: "personal" }],
};

test("adds new sites with links, skipping ones already there under the same company", () => {
  const r = applyPendingSites(base, raw)!;
  assert.deepEqual([r.added, r.noLink], [4, 1]);
  const names = r.data.institutions.map((i) => `${i.scope}:${i.name}:${i.website}:${i.type}`);
  assert.deepEqual(names, [
    "personal:Example Bank:https://bank.example:Bank", // kept as it was; same web address
    "personal:Example Insurance:https://insure.example:Car Insurance",
    "gladiator:Example Bank Login:https://bank.example:Website",
    "gladiator:Old Portal::Website",
    "gladiator:Example Bank Second Account:https://bank.example:Website", // two accounts at one site both stay
  ]);
  assert.equal(applyPendingSites(r.data, raw), null); // running again adds nothing
});

test("a site you deleted stays deleted", () => {
  const r = applyPendingSites(base, raw)!;
  const less = { ...r.data, institutions: r.data.institutions.filter((i) => i.name !== "Old Portal") };
  assert.equal(applyPendingSites(less, raw), null);
});

test("a value that fails its check changes nothing", () => {
  assert.equal(applyPendingSites(base, JSON.stringify({ ...JSON.parse(raw), check: { count: 9 } })), null);
});
