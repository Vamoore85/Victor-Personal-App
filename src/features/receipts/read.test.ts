import { test } from "node:test";
import assert from "node:assert/strict";
import { readReceiptText } from "./read";

const TODAY = "2026-10-26";

test("reads a store receipt: name, date and the total, not the subtotal or cash", () => {
  const text = `THE HOME DEPOT
2455 PACES FERRY RD
ATLANTA, GA 30339 (770)433-8211
10/24/26 03:12 PM
2x4 STUD 8FT       4.47
DRILL BIT SET     19.98
SUBTOTAL          24.45
SALES TAX          1.96
TOTAL            $26.41
CASH              40.00
CHANGE DUE        13.59`;
  assert.deepEqual(readReceiptText(text, TODAY), { merchant: "The Home Depot", date: "2026-10-24", amount: 26.41 });
});

test("total on the next line, written-out month, and a misread comma", () => {
  const text = `Starbucks Coffee
Store #1234
Oct 3, 2026
Latte 5,75
Total
$ 6,21`;
  assert.deepEqual(readReceiptText(text, TODAY), { merchant: "Starbucks Coffee", date: "2026-10-03", amount: 6.21 });
});

test("amount due beats a plain total; tax total and savings are not totals", () => {
  const text = `Shell
2026-09-30
Total savings 3.00
Total tax 2.10
Total 50.00
Amount due 48.00`;
  const r = readReceiptText(text, TODAY);
  assert.equal(r.amount, 48);
  assert.equal(r.date, "2026-09-30");
});

test("ignores future or impossible dates and keeps the sale date over a return-by date", () => {
  assert.equal(readReceiptText("Shop\n02/31/2026\n12/01/2027\nTotal 5.00", TODAY).date, null);
  assert.equal(readReceiptText("Shop\n10/01/2026\nReturn by 10/31/2026\nTotal 5.00", TODAY).date, "2026-10-01");
});

test("nothing readable gives empty guesses", () => {
  assert.deepEqual(readReceiptText("~~ ## ..", TODAY), { merchant: "", date: null, amount: null });
});

test("falls back to the largest amount when no total line reads", () => {
  assert.equal(readReceiptText("Joe's Diner\nBurger 12.00\nFries 4.50\nT0TAL 16.50", TODAY).amount, 16.5);
});
