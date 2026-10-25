import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPendingBills, nextOnDay } from "./pending-bills";
import { EMPTY_DATA, type MoneyData } from "@/features/money/types";

// Made-up bills and accounts (no real payees or amounts).
const TODAY = "2026-10-25";
const raw = JSON.stringify({
  bills: [
    ["business", "1111", "Video Service", 10.5, 28, "Software & subscriptions", true, "video.example"],
    ["gladiator", "2222", "Phone Co", 20, 31, "Utilities, phone & internet", true, "", "Day estimated."],
    ["personal", "3333", "Gym", 30, 3, "Health", false],
  ],
  check: { count: 3, total: 60.5 },
});
const base: MoneyData = {
  ...EMPTY_DATA,
  accounts: [
    { id: "a1", name: "Biz", type: "checking", openingBalance: 0, scope: "business", last4: "1111" },
    { id: "a2", name: "Glad", type: "checking", openingBalance: 0, scope: "gladiator", last4: "2222", plaid: { linkId: "l", accountId: "p" } },
  ],
};

test("adds each bill once, on its account, with the next due date", () => {
  const r = applyPendingBills(base, TODAY, raw)!;
  assert.equal(r.added, 3);
  const [video, phone, gym] = r.data.bills;
  assert.deepEqual([video.accountId, video.nextDue, video.url, video.scope], ["a1", "2026-10-28", "https://video.example", "business"]);
  assert.deepEqual([phone.accountId, phone.nextDue, phone.dueDay], ["a2", "2026-10-31", 31]);
  assert.equal(phone.note, "From your bills workbook. Day estimated.");
  assert.deepEqual([gym.accountId, gym.nextDue, gym.url], ["", "2026-11-03", undefined]);
  assert.equal(applyPendingBills(r.data, TODAY, raw), null); // running again adds nothing
});

test("a bill you deleted stays deleted", () => {
  const r = applyPendingBills(base, TODAY, raw)!;
  const less = { ...r.data, bills: r.data.bills.slice(1) };
  assert.equal(applyPendingBills(less, TODAY, raw), null);
});

test("skips a bill you already have under the same company", () => {
  const have: MoneyData = { ...base, bills: [{ id: "b", name: "Video service plus", amount: 10.9, category: "x", frequency: "monthly", nextDue: TODAY, dueDay: 1, accountId: "", autopay: true, scope: "business" }] };
  const r = applyPendingBills(have, TODAY, raw)!;
  assert.equal(r.added, 2);
  assert.equal(r.data.bills.filter((b) => b.scope === "business").length, 1);
});

test("a value that fails its check changes nothing", () => {
  const bad = JSON.stringify({ ...JSON.parse(raw), check: { count: 3, total: 61 } });
  assert.equal(applyPendingBills(base, TODAY, bad), null);
});

test("short months clamp the due day", () => {
  assert.equal(nextOnDay(31, "2026-11-05"), "2026-11-30");
  assert.equal(nextOnDay(5, "2026-12-20"), "2027-01-05");
});
