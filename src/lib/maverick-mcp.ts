import { buildReport, type ReportPeriod } from "@/features/money/reports";
import type { MoneyData, Scope } from "@/features/money/types";
import { wadeMoneySummary } from "./wade-money";

/*
 * Maverick's coordinator for Raven (Victor 11/13: every app plugs into Raven with its own coordinator).
 * A read-only MCP server body: the same money facts the approved Wade link already reads, plus the saved
 * reports. Nothing here writes, syncs a bank, or returns logins, the vault, files or bank ids.
 */

export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ENTITIES = ["Personal", "Maverick", "Gladiator", "Unassigned"];
const INSTRUCTIONS = "This is Maverick, Victor's personal Financial Center (entities: Personal, Maverick = his business, Gladiator). "
  + "Every tool only reads saved data; nothing syncs banks or changes anything. For a broad question start with maverick_overview. "
  + "Say which entity each number belongs to, and give the as-of dates. Transfers are not income or spending.";

type Args = Record<string, unknown>;
type Prop = { type: "integer" | "string"; minimum?: number; maximum?: number; maxLength?: number; enum?: string[]; description?: string };
type Tool = { name: string; title: string; description: string; inputSchema: { type: "object"; properties: Record<string, Prop>; required?: string[]; additionalProperties: false }; annotations: typeof READ_ONLY };

export const TOOLS: Tool[] = [
  { name: "maverick_overview", title: "How the money looks", annotations: READ_ONLY,
    description: "Accounts and balances, bills with next due dates, this month's budgets, and the 25 latest transactions, for Personal, Maverick and Gladiator.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "maverick_transactions", title: "Find transactions", annotations: READ_ONLY,
    description: "Transactions from the last N days (up to 120), optionally for one entity or matching words in the description or category.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      days: { type: "integer", minimum: 1, maximum: 120 }, entity: { type: "string", enum: ENTITIES },
      query: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 500 } } } },
  { name: "maverick_report", title: "Financial report", annotations: READ_ONLY,
    description: "Income, spending and totals report for personal, business (Maverick) or gladiator, over ytd, 12m or 30d.",
    inputSchema: { type: "object", additionalProperties: false, required: ["entity", "period"], properties: {
      entity: { type: "string", enum: ["personal", "business", "gladiator"] }, period: { type: "string", enum: ["ytd", "12m", "30d"] } } } },
];

export function validArgs(tool: Tool, raw: unknown): Args | null {
  const args = (raw === undefined ? {} : raw) as Args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const props = tool.inputSchema.properties;
  if (Object.keys(args).some((k) => !Object.hasOwn(props, k))) return null;
  if ((tool.inputSchema.required ?? []).some((k) => args[k] === undefined)) return null;
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (p.type === "integer" && (!Number.isSafeInteger(v) || (v as number) < p.minimum! || (v as number) > p.maximum!)) return null;
    if (p.type === "string" && (typeof v !== "string" || (p.maxLength && v.length > p.maxLength) || (p.enum && !p.enum.includes(v)))) return null;
  }
  return args;
}

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };
export type McpReply = { status: 200 | 202; body: unknown };

/** Answers one JSON-RPC message. readMoney is only called for tool calls. */
export async function answerMcp(msg: unknown, readMoney: () => Promise<MoneyData | null>, now: Date): Promise<McpReply> {
  const m = msg as Rpc;
  const fail = (id: unknown, code: number, message: string): McpReply => ({ status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
  const ok = (id: unknown, result: unknown): McpReply => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(m?.id, -32600, "Invalid request.");
  if (m.id === undefined) return { status: 202, body: null };
  const params = m.params ?? {};
  if (m.method === "initialize") {
    const asked = params.protocolVersion;
    return ok(m.id, { protocolVersion: PROTOCOLS.includes(asked as string) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "Maverick", title: "Maverick (personal Financial Center)", version: "1.0.0" }, instructions: INSTRUCTIONS });
  }
  if (m.method === "ping") return ok(m.id, {});
  if (m.method === "tools/list") return ok(m.id, { tools: TOOLS });
  if (m.method !== "tools/call") return fail(m.id, -32601, "Method not found.");
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return fail(m.id, -32602, "Unknown tool.");
  const args = validArgs(tool, params.arguments);
  const text = (isError: boolean, value: unknown) => ok(m.id, { isError, content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
  if (!args) return text(true, `Those arguments are not supported by ${tool.name}.`);
  const data = await readMoney();
  if (!data) return text(true, "No saved financial data yet.");
  if (tool.name === "maverick_report") return text(false, buildReport(data, args.entity as Scope, args.period as ReportPeriod, now.toISOString().slice(0, 10), now.getTime()));
  const s = wadeMoneySummary(data, now);
  if (tool.name === "maverick_overview") {
    const { transactions, ...rest } = s;
    return text(false, { ...rest, transactions_in_window: transactions.length, latest_transactions: transactions.slice(0, 25) });
  }
  const since = new Date(now.getTime() - ((args.days as number) ?? 30) * 864e5).toISOString().slice(0, 10);
  const words = typeof args.query === "string" ? args.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const rows = s.transactions.filter((t) => t.date >= since && (!args.entity || t.entity === args.entity)
    && words.every((w) => `${t.description} ${t.category}`.toLowerCase().includes(w)));
  const limit = (args.limit as number) ?? 100;
  return text(false, { checked_at: s.checked_at, since, entity: args.entity ?? "all", query: args.query ?? null,
    matched: rows.length, truncated: rows.length > limit, transactions: rows.slice(0, limit) });
}
