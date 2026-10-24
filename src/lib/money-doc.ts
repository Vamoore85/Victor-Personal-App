import { groupKey, isCandidate } from "@/features/money/bill-intel";
import { readDoc, writeDoc } from "@/lib/db";
import { EMPTY_DATA, type MoneyData } from "@/features/money/types";

// The Financial Center's data as the server sees it: the same "money" row the
// browser loads and saves through /api/money.

export const MONEY_DOC = "money";

/** The fields the server works with, filled in when an older copy lacks them. */
export function asMoney(data: unknown): MoneyData {
  const v = (data ?? {}) as Partial<MoneyData>;
  const out = { ...EMPTY_DATA, ...v } as MoneyData;
  for (const k of ["accounts", "transactions", "bankLinks", "rules", "briefings"] as const) if (!Array.isArray(out[k])) (out as Record<string, unknown>)[k] = [];
  return out;
}

/** Applies a change to the saved money data, retrying when another save lands first. */
export async function updateMoney(change: (d: MoneyData) => MoneyData): Promise<{ rev: number; data: MoneyData }> {
  for (let i = 0; i < 5; i++) {
    const doc = await readDoc(MONEY_DOC);
    const next = change(asMoney(doc?.data));
    const saved = await writeDoc(MONEY_DOC, doc?.rev ?? 0, next);
    if (saved.ok) return { rev: saved.rev, data: next };
  }
  throw new Error("The money data kept changing while saving.");
}

/** One line per account for the hosting's logs: last 4, entity, type, bank feed and balance age. Never amounts or names. */
export function accountDiag(data: unknown) {
  const d = asMoney(data);
  const links = new Map(d.bankLinks.map((l) => [l.id, l]));
  return d.accounts
    .map((a) => {
      const link = a.plaid ? links.get(a.plaid.linkId) : undefined;
      const bb = a.bankBalance;
      const bal = !bb ? "none" : bb.current === null && bb.available === null ? "empty" : `${Math.round((Date.now() - new Date(bb.asOf).getTime()) / 36e5)}h`;
      const bank = d.transactions.filter((t) => t.accountId === a.id && t.plaidId).length;
      const other = d.transactions.filter((t) => t.accountId === a.id && !t.plaidId).length;
      return `${a.last4 ?? "----"}/${a.needsEntity ? "UNASSIGNED" : (a.scope ?? "personal")}${a.nickname ? `(${a.nickname})` : ""}/${a.type}/feed=${!a.plaid ? "none" : link ? "live" : "removed"}/bal=${bal}/tx=${bank}+${other}`;
    })
    .join(" ") + ` rules=${d.accountRules ?? 0} links=${d.bankLinks.length} dupLinks=${d.bankLinks.filter((l) => l.duplicateOf).length}`;
}

/**
 * Why a bill you expect isn't in the bills list: for a few kinds of payment,
 * how many transactions match, on which accounts, up to when, how many the
 * bill finder looks at, and what it found. Counts, dates and names only.
 */
const LOOK_FOR: [string, RegExp][] = [
  ["child-support", /CHILD|SUPPORT|CSEA|\bDHS\b|\bCSE\b|FAMILY SUPPORT/i],
  ["verizon", /VERIZON|\bVZW\b/i],
  ["bge", /\bBGE\b|BG ?& ?E|BALTIMORE GAS/i],
  ["gas", /\bGAS\b|SHELL|EXXON|\bBP\b|SUNOCO|WAWA|ROYAL FARMS|CITGO|MOBIL|SPEEDWAY|SHEETZ/i],
  ["card-payment", /CRD PMT|CARD ?PAYMENT|CREDIT CARD|CC PMT|E-?PAYMENT|AUTOPAY|AUTO PAY|CAPITAL ONE|DISCOVER|AMEX|AMERICAN EXPRESS|CHASE|CITI|SYNCHRONY|BARCLAY/i],
  ["checks", /^CHECK|CHECK ?#|CHECK NUMBER|\bCHK\b/i],
  ["apple", /APPLE|ITUNES/i],
  ["rent", /\bRENT\b|LEASE|APARTMENT|APTS?\b|PROPERTY|PROPERTIES|MANAGEMENT|MGMT|REALTY|HOUSING|LANDLORD|MORTGAGE|HOME LOAN|RENTCAFE|APPFOLIO|BILT|ZILLOW|YARDI|BUILDIUM|COZY|AVAIL|PAYLEASE|ZEGO/i],
  ["personal-checks", /^CHECK|CHECK ?#|CHECK NUMBER|\bCHK\b/i],
  ["subscriptions", /NETFLIX|SPOTIFY|HULU|DISNEY|YOUTUBE|AMAZON PRIME|PRIME VIDEO|PARAMOUNT|PEACOCK|MAX\b|HBO|ADOBE|MICROSOFT|GOOGLE|DROPBOX|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|PATREON|AUDIBLE|SIRIUS/i],
];
export function billDiag(data: unknown) {
  const d = asMoney(data);
  const acct = new Map(d.accounts.map((a) => [a.id, a]));
  const out: string[] = [];
  for (const [name, re] of LOOK_FOR) {
    const ts = d.transactions.filter((t) => t.kind === "expense" && re.test(t.description));
    if (!ts.length) {
      out.push(`${name}: none`);
      continue;
    }
    const cand = ts.filter((t) => isCandidate(t, "out")).length;
    const byAcct = new Map<string, number>();
    for (const t of ts) {
      const a = acct.get(t.accountId);
      const k = `${a?.last4 ?? "?"}${a?.needsEntity ? "(unassigned)" : ""}`;
      byAcct.set(k, (byAcct.get(k) ?? 0) + 1);
    }
    const last = ts.reduce((m, t) => (t.date > m ? t.date : m), "");
    const cats = [...new Set(ts.map((t) => t.category))].slice(0, 4).join("|");
    const keys = [...new Set(ts.filter((t) => isCandidate(t, "out")).map(groupKey))].join("|");
    const shownKeys = keys.split("|").filter((k) => !k.startsWith("CHECK ")).slice(0, 8).join("|");
    const finds = d.recurring
      .filter((f) => f.direction === "out" && keys.split("|").some((k) => k && f.key.includes(`|${k}|`)))
      .map((f) => `${f.key.split("|")[1].replace(/^CHECK .*/, "CHECK")}:${f.cadence}/${f.confidence}/${f.status}/next=${f.nextExpected ?? "none"}`)
      .join(",");
    out.push(`${name}: n=${ts.length} candidates=${cand} accts=${[...byAcct].map(([k, v]) => `${k}:${v}`).join(",")} last=${last} cats=${cats} keys=${shownKeys} findings=${finds || "none"}`);
  }
  // Big monthly-sized payments out of Personal accounts, by payee and size band (no exact amounts).
  const personal = new Set(d.accounts.filter((a) => (a.scope ?? "personal") === "personal").map((a) => a.id));
  const big = new Map<string, { n: number; months: Set<string>; days: Set<number> }>();
  for (const t of d.transactions) {
    if (t.kind !== "expense" || !personal.has(t.accountId) || t.amount < 1000) continue;
    const band = t.amount < 1500 ? "1-1.5k" : t.amount < 2500 ? "1.5-2.5k" : "2.5k+";
    const k = `${groupKey(t).replace(/^CHECK .*/, "CHECK")}/${t.category}/${band}/${acct.get(t.accountId)?.last4}`;
    const g = big.get(k) ?? { n: 0, months: new Set(), days: new Set() };
    g.n++;
    g.months.add(t.date.slice(0, 7));
    g.days.add(+t.date.slice(8, 10));
    big.set(k, g);
  }
  out.push(`personal-big: ${[...big].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, g]) => `${k}:n${g.n}/m${g.months.size}/days${[...g.days].sort((x, y) => x - y).join(".")}`).join(", ") || "none"}`);
  return out.join(" || ") + ` | scan=${d.billScan ? `${d.billScan.found}@${d.billScan.windowEnd}/rules${d.billScan.rules}` : "none"} recurring=${d.recurring.length}`;
}
