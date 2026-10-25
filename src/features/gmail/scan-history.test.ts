import { test } from "node:test";
import assert from "node:assert/strict";
import { claimMailScan, claimScan, collectScanBatch, scanKey, scanRange, type ScanCursor } from "./scan-history";

const empty = (): ScanCursor => ({ retryIds: [], looked: 0, kept: 0, complete: false });

test("automatic and history scans share one mailbox read lease",()=> {
  const history=claimScan(empty(),"history",1000);
  assert.throws(()=>claimMailScan({history},"recent","automatic",1001),/Another email scan/);
  assert.equal(claimMailScan({history},"recent","automatic",151001).lease?.id,"automatic");
  assert.throws(()=>claimMailScan({history},"history","second",1001),/already running/);
});

test("full years include January through December, current year stops at today", () => {
  assert.deepEqual(scanRange(90, "2026-10-25", 2024), { from: "2024-01-01", to: "2024-12-31" });
  assert.deepEqual(scanRange(90, "2026-10-25", 2026), { from: "2026-01-01", to: "2026-10-25" });
  assert.deepEqual(scanRange(180, "2026-10-25"), { from: "2026-04-29", to: "2026-10-25" });
  assert.throws(() => scanRange(90, "2026-10-25", 2027));
  assert.throws(() => scanRange(90, "2026-10-25", 1999));
  assert.throws(() => scanRange(90, "2026-10-25", Number.NaN));
  assert.notEqual(scanKey("2024-01-01", "2024-12-31"), scanKey("2025-01-01", "2025-12-31"));
});

test("400-message batch saves the next page, so noise-only results cannot trap scanning", async () => {
  const list = async (page: string | undefined, limit: number) => {
    const start = Number(page ?? 0);
    const end = Math.min(start + limit, 550);
    return { ids: Array.from({ length: end - start }, (_, i) => `message-${start + i}`), page: end < 550 ? String(end) : undefined };
  };
  const first = await collectScanBatch(empty(), list, 400);
  assert.equal(first.ids.length, 400);
  assert.equal(first.page, "400");
  const second = await collectScanBatch({ ...empty(), page: first.page, looked: first.listed }, list, 400);
  assert.equal(second.ids.length, 150);
  assert.equal(second.ids[0], "message-400");
  assert.equal(second.page, undefined);
  assert.equal(first.listed + second.listed, 550);
  assert.equal(new Set([...first.ids, ...second.ids]).size, 550);
});

test("unreadable messages retry after the final page without restarting at the newest email", async () => {
  let listed = false;
  const batch = await collectScanBatch({ ...empty(), looked: 550, retryIds: ["failed-a", "failed-b"] }, async () => { listed = true; return { ids: [] }; });
  assert.equal(listed, false);
  assert.deepEqual(batch.ids, ["failed-a", "failed-b"]);
  assert.equal(batch.listed, 0);
});

test("a retry-filled batch preserves the page for the next scan", async () => {
  const batch = await collectScanBatch({ ...empty(), page: "older", looked: 400, retryIds: ["a", "b"] }, async () => { throw new Error("Must not list while retries fill the batch"); }, 2);
  assert.equal(batch.page, "older");
  assert.deepEqual(batch.ids, ["a", "b"]);
});

test("a simultaneous scan cannot steal an active cursor, but an expired scan resumes", () => {
  const active = claimScan({ ...empty(), page: "older", looked: 400 }, "first", 1000);
  assert.throws(() => claimScan(active, "second", 1001), /already running/);
  const resumed = claimScan(active, "second", 200000);
  assert.equal(resumed.page, "older");
  assert.equal(resumed.looked, 400);
  assert.equal(resumed.lease?.id, "second");
  const restarted = claimScan(active, "third", 200000, true);
  assert.equal(restarted.looked, 0);
  assert.equal(restarted.page, undefined);
});
