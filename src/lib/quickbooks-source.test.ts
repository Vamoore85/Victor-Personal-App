import test from "node:test";
import assert from "node:assert/strict";
import { saveGladiatorLink, summarize } from "./quickbooks";

test("Gladiator connection validates the company and never includes the link key or provider body in errors", async () => {
  const previousFetch = globalThis.fetch, previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://unused@localhost/test";
  const key = "a".repeat(64), calls: { url: string; body: string }[] = [];
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), "https://msmfyftalseckinllvsd.supabase.co/functions/v1/quickbooks");
    assert.equal(options?.method, "POST");
    assert.equal(new Headers(options?.headers).get("x-gladiator-books-key"), key);
    calls.push({ url: String(input), body: String(options?.body) });
    return new Response(JSON.stringify({ private_error: key }), { status: 403 });
  };
  try {
    await assert.rejects(saveGladiatorLink(key), e => e instanceof Error && /connected again/.test(e.message) && !e.message.includes(key));
    assert.deepEqual(JSON.parse(calls[0].body), { status: true });
    const before = calls.length;
    await assert.rejects(saveGladiatorLink("invalid"), /connection code/);
    assert.equal(calls.length, before);
    globalThis.fetch = async () => new Response(JSON.stringify({ connected: true, company: "Unrelated Company" }));
    await assert.rejects(saveGladiatorLink(key), /not connected to Gladiator/);
  } finally { globalThis.fetch = previousFetch;if (previousUrl === undefined) delete process.env.DATABASE_URL;else process.env.DATABASE_URL = previousUrl; }
});

test("financial totals are taken from QuickBooks report groups and are independent of imported bank records", () => {
  const pl = { Header: { ReportBasis: "Accrual" }, Rows: { Row: [
    { group: "Income", Summary: { ColData: [{ value: "Total Income" }, { value: "100" }] } },
    { group: "Expenses", Summary: { ColData: [{ value: "Total Expenses" }, { value: "40" }] } },
    { group: "NetIncome", Summary: { ColData: [{ value: "Net Income" }, { value: "60" }] } },
  ] } };
  const result = summarize(pl, { Header: { EndPeriod: "2026-10-25" }, Rows: { Row: [] } }, 2026, "Gladiator Solutions LLC");
  assert.equal(result.companyName, "Gladiator Solutions LLC");assert.equal(result.income, 100);assert.equal(result.expenses, 40);assert.equal(result.netIncome, 60);
});
