import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EMPTY_DATA, type MoneyData } from "@/features/money/types";
import { answerMcp, TOOLS } from "./maverick-mcp";

const data = {
  ...EMPTY_DATA,
  accounts: [{ id: "a1", name: "Checking", type: "checking", openingBalance: 100, scope: "business", plaid: { linkId: "L", accountId: "P" } }],
  transactions: [
    { id: "t1", date: "2026-11-10", description: "Client payment", amount: 1000, kind: "income", category: "Income", accountId: "a1" },
    { id: "t2", date: "2026-11-09", description: "Software seat", amount: 50, kind: "expense", category: "Software", accountId: "a1" },
    { id: "t3", date: "2026-06-01", description: "Old software", amount: 5, kind: "expense", category: "Software", accountId: "a1" },
  ],
  bills: [], budgets: [],
  institutions: [{ id: "i1", name: "Bank", loginUrl: "https://bank.example/login", notes: "private note" }],
} as unknown as MoneyData;
const now = new Date("2026-11-13T12:00:00Z");
let reads = 0;
const read = async () => { reads++; return data; };
const rpc = (method: string, params?: unknown, id: unknown = 1) => answerMcp({ jsonrpc: "2.0", id, method, params }, read, now);
const body = (r: { body: unknown }) => r.body as { result?: { isError?: boolean; content?: { text: string }[]; tools?: { name: string; annotations: { readOnlyHint: boolean } }[]; serverInfo?: { name: string }; protocolVersion?: string }; error?: { code: number } };

test("initialize names it Maverick; tools are all read-only; listing reads no money data", async () => {
  reads = 0;
  const init = body(await rpc("initialize", { protocolVersion: "2025-06-18" }));
  assert.equal(init.result!.serverInfo!.name, "Maverick");
  assert.equal(body(await rpc("initialize", { protocolVersion: "old" })).result!.protocolVersion, "2025-06-18");
  const list = body(await rpc("tools/list"));
  assert.deepEqual(list.result!.tools!.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.ok(list.result!.tools!.every((t) => t.annotations.readOnlyHint));
  assert.equal((await answerMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, read, now)).status, 202);
  assert.equal(reads, 0);
});

test("overview and transactions give money facts and never logins or notes", async () => {
  const ov = JSON.parse(body(await rpc("tools/call", { name: "maverick_overview", arguments: {} })).result!.content![0].text);
  assert.equal(ov.accounts[0].entity, "Maverick");
  assert.equal(ov.transactions_in_window, 2);
  const tx = JSON.parse(body(await rpc("tools/call", { name: "maverick_transactions", arguments: { days: 30, query: "software", entity: "Maverick" } })).result!.content![0].text);
  assert.deepEqual(tx.transactions.map((t: { amount: number }) => t.amount), [-50]);
  const all = JSON.stringify([ov, tx]);
  assert.ok(!all.includes("private note") && !all.includes("bank.example"));
});

test("report runs for a fixed entity and period", async () => {
  const r = body(await rpc("tools/call", { name: "maverick_report", arguments: { entity: "business", period: "30d" } }));
  assert.equal(r.result!.isError, false);
  assert.ok(JSON.parse(r.result!.content![0].text).period);
});

test("bad arguments, unknown tools and methods read nothing", async () => {
  reads = 0;
  for (const [name, args] of [["maverick_report", { entity: "vault", period: "ytd" }], ["maverick_report", { entity: "business" }],
    ["maverick_transactions", { days: 999 }], ["maverick_transactions", { days: "7" }], ["maverick_overview", { sync: true }]] as const) {
    assert.equal(body(await rpc("tools/call", { name, arguments: args })).result!.isError, true, name);
  }
  assert.equal(body(await rpc("tools/call", { name: "maverick_sync", arguments: {} })).error!.code, -32602);
  assert.equal(body(await rpc("resources/list")).error!.code, -32601);
  assert.equal(body(await answerMcp([1, 2], read, now)).error!.code, -32600);
  assert.equal(reads, 0);
});
