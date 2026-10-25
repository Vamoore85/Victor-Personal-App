import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRecurring, groupKey, isCandidate } from "./bill-intel";
import { EMPTY_DATA, type Account, type MoneyData, type Transaction } from "./types";

/*
 * Made-up history (no real payees or amounts): the kinds of payment that used
 * to be skipped as "movement" or as too irregular, and must now show as bills.
 */
const TODAY = "2026-10-24";
const acct = (id: string, scope: Account["scope"]): Account => ({ id, name: `Account ${id}`, type: "checking", openingBalance: 0, scope, last4: id });
let n = 0;
const t = (accountId: string, date: string, amount: number, description: string, category = "Other", extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, accountId, date, amount, kind: "expense", category, description, plaidId: `p${n}`, ...extra,
});
const months = (from: number, to: number, day: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`);

function data(transactions: Transaction[]): MoneyData {
  return { ...EMPTY_DATA, accounts: [acct("1111", "personal"), acct("2222", "business")], transactions };
}
const find = (d: MoneyData, name: RegExp) => detectRecurring(d, TODAY).found.find((f) => name.test(f.merchant));

test("checks, child support, BG&E, Verizon and card payments are found as bills", () => {
  const d = data([
    ...months(1, 10, 3).map((day) => t("2222", day, 500, "CHECK 1043", "Transfer")),
    ...months(1, 10, 15).map((day) => t("1111", day, 300, "MD CHILD SUPPORT SDU PAYMENT", "Transfer")),
    ...months(1, 10, 20).map((day, i) => t("1111", day, [80, 210, 190, 120, 60, 95, 150, 175, 90, 70][i], "BGE ONLINE PMT")),
    ...months(1, 10, 9).map((day, i) => t("1111", day, 120 + i, "VERIZON WIRELESS PAYMENTS")),
    ...months(1, 10, 25).map((day, i) => t("1111", day, [400, 90, 1200, 300, 250, 800, 60, 500, 700, 350][i], "CAPITAL ONE CRD PMT", "Debt payments", { transferId: "x" + i })),
  ]);
  for (const name of [/^Check 500$/, /Child support/, /BG&E/, /Verizon/, /Capital One/i]) {
    const f = find(d, name);
    assert.ok(f, `missing ${name}`);
    assert.equal(f.cadence, "monthly", `${name} cadence`);
    assert.ok(f.nextExpected && f.nextExpected >= TODAY, `${name} has a next date`);
  }
});

test("Apple and gas charges are added up into one monthly line each", () => {
  const d = data([
    ...months(1, 9, 2).flatMap((day) => [t("1111", day, 9.99, "APPLE.COM/BILL"), t("1111", day.replace(/02$/, "14"), 2.99, "APPLE.COM/BILL 866-712"), t("1111", day.replace(/02$/, "21"), 14.99, "APL* ITUNES.COM")]),
    ...months(1, 9, 1).flatMap((day) => [5, 12, 19, 26].map((dd) => t("1111", day.replace(/01$/, String(dd).padStart(2, "0")), 40, "SHELL OIL 57444", "Dining"))),
  ]);
  const apple = find(d, /Apple/);
  assert.ok(apple);
  assert.equal(apple.typical, 27.97);
  assert.equal(apple.nextExpected, "2026-11-01");
  const gas = find(d, /Gas/);
  assert.ok(gas);
  assert.equal(gas.typical, 160);
});

test("a bill on an account whose history ends early keeps its next dates", () => {
  // Statements only run to the end of June; the bill didn't stop, we just can't see further.
  const d = data([...months(1, 6, 10).map((day) => t("2222", day, 75, "INSURANCE CO PREMIUM", "Insurance", { plaidId: undefined }))]);
  const f = find(d, /Insurance/i);
  assert.ok(f);
  assert.equal(f.nextExpected, "2026-11-10");
});

test("deposits, refunds and money in are still not bills", () => {
  const d = data([
    ...months(1, 6, 3).map((day) => t("1111", day, 500, "CHECK DEPOSIT", "Transfer")),
    ...months(1, 6, 4).map((day) => t("1111", day, 20, "ZELLE FROM A FRIEND", "Transfer")),
  ]);
  assert.equal(detectRecurring(d, TODAY).found.filter((f) => f.direction === "out").length, 0);
});

test("checks from the personal account are child support, even when the amount changes", () => {
  const d = data(months(1, 10, 1).map((day, i) => t("1111", day, i % 2 ? 400 : 450, `CHECK ${2000 + i}`, "Other")));
  const f = find(d, /Child support/);
  assert.ok(f);
  assert.equal(f.cadence, "monthly");
  assert.equal(f.nextExpected, "2026-11-01");
  assert.equal(detectRecurring(d, TODAY).found.filter((x) => /^Check/.test(x.merchant)).length, 0);
});

test("everyday spending repeats as monthly totals: food by category, a busy store by name", () => {
  const d = data([
    ...months(4, 9, 1).flatMap((day) => [3, 9, 16, 23].map((dd) => t("1111", day.replace(/01$/, String(dd).padStart(2, "0")), 25, `DINER NUMBER ${dd}`, "Dining"))),
    ...months(4, 9, 1).flatMap((day) => [2, 6, 11, 17, 22, 28].map((dd) => t("1111", day.replace(/01$/, String(dd).padStart(2, "0")), 15, "AMAZON MKTPL", "Shopping"))),
  ]);
  const dining = find(d, /^Dining \(monthly total\)$/);
  assert.ok(dining);
  assert.equal(dining.typical, 100);
  const amazon = find(d, /Amazon Mktpl \(monthly total\)/);
  assert.ok(amazon);
  assert.equal(amazon.typical, 90);
});

test("the big monthly check from the personal account is rent, the smaller ones child support", () => {
  const d = data([
    ...months(1, 10, 1).map((day, i) => t("1111", day, 1900, `CHECK ${3000 + i}`, "Other")),
    ...months(1, 10, 12).map((day, i) => t("1111", day, 350, `CHECK ${4000 + i}`, "Other")),
  ]);
  const rent = find(d, /^Rent$/);
  assert.ok(rent);
  assert.equal(rent.typical, 1900);
  assert.equal(rent.nextExpected, "2026-11-01");
  const cs = find(d, /Child support/);
  assert.ok(cs);
  assert.equal(cs.typical, 350);
});

test("a check with CHK in the middle of the bank's wording still counts", () => {
  const d = data(months(1, 8, 4).map((day, i) => t("2222", day, 640, `PAID CHK ${500 + i}`, "Owner draw")));
  assert.ok(find(d, /^Check 640$/));
});

test("transfers to checking accounts are not written checks, with or without a saved transfer link", () => {
  for (const description of ["WEB XFER TO CHK 00000000001234", "WEB XFER FROM CHK 00000000001234", "TRANSFER TO CHK 1234"]) {
    for (const transferId of [undefined, "own-account-move"]) {
      const payment = t("1111", "2026-10-20", 16000, description, "Other", { transferId });
      assert.equal(isCandidate(payment, "out"), false, description);
      assert.doesNotMatch(groupKey(payment), /^CHECK /);
    }
  }
});

test("checking-account transfers cannot spoil rent or child support detection", () => {
  const d = data([
    t("1111", "2026-09-02", 1900, "CHECK 0201"),
    t("1111", "2026-10-04", 1900, "CHECK 0203"),
    t("1111", "2026-09-15", 750, "CHECK 0202"),
    t("1111", "2026-10-20", 16000, "WEB XFER TO CHK 00000000001234"),
    t("1111", "2026-10-20", 900, "WEB XFER TO CHK 00000000005678"),
    t("1111", "2026-10-02", 40, "WEB XFER TO CHK 00000000005678"),
  ]);
  const rent = find(d, /^Rent$/);
  assert.ok(rent);
  assert.equal(rent.typical, 1900);
  assert.equal(rent.cadence, "monthly");
  assert.equal(rent.nextExpected, "2026-11-03");
  assert.equal(rent.occurrences.length, 2);
  const support = find(d, /^Child support$/);
  assert.ok(support);
  assert.equal(support.typical, 750);
  assert.equal(support.occurrences.length, 1);
});
