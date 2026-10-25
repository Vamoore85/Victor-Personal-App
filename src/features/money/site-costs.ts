import { billMonthlyCost } from "./calc";
import type { Bill, Institution, MoneyData, Scope, Transaction } from "./types";

/*
 * What each website in the login portal costs a month. A site's cost comes
 * from the bills linked to it (Bill.institutionId), or from what you typed
 * for it (Institution.cost). Linking a bill only sets that field: the bill's
 * amount and schedule are never changed here.
 */

export const SITE_COST_RULES = 1;

export type SiteCostView =
  | { state: "bills"; monthly: number; yearly: boolean; average: boolean; bills: Bill[] }
  | { state: "manual"; monthly: number; yearly: number | null }
  | { state: "variable" }
  | { state: "none" }
  | { state: "unset" };

const scopeOf = (x: { scope?: Scope }) => x.scope ?? "personal";
const round = (n: number) => Math.round(n * 100) / 100;

export function siteCost(site: Institution, bills: Bill[]): SiteCostView {
  const linked = bills.filter((b) => b.institutionId === site.id);
  if (linked.length) {
    return {
      state: "bills",
      monthly: round(linked.reduce((s, b) => s + billMonthlyCost(b), 0)),
      yearly: linked.some((b) => b.frequency === "yearly"),
      average: linked.some((b) => /average/i.test(b.note ?? "")),
      bills: linked,
    };
  }
  const c = site.cost;
  if (c?.kind === "manual" && typeof c.amount === "number") {
    return c.period === "yearly" ? { state: "manual", monthly: round(c.amount / 12), yearly: c.amount } : { state: "manual", monthly: c.amount, yearly: null };
  }
  if (c?.kind === "variable") return { state: "variable" };
  if (c?.kind === "none") return { state: "none" };
  return { state: "unset" };
}

/* ---- Linking your saved bills to sites, only where the match is clear ---- */

const STOP = new Set(["the", "inc", "llc", "co", "com", "www", "and", "of", "for"]);

function tokens(s: string) {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)));
}

/** The site's main web address, e.g. "account.adobe.com" -> "adobe.com". */
function domain(url: string | undefined) {
  if (!url) return "";
  const host = url.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  return host.split(".").slice(-2).join(".");
}

export function matchScore(bill: Bill, site: Institution) {
  const d = domain(bill.url);
  const sameSite = !!d && [site.website, site.loginUrl].some((u) => domain(u) === d);
  const a = tokens(bill.name);
  const b = tokens(site.name);
  const shared = [...a].filter((t) => b.has(t));
  const score = (sameSite ? 2 : 0) + shared.reduce((s, t) => s + (t.length === 1 ? 0.5 : 1), 0);
  // Either the same web address plus a shared word, or a long distinctive word in common (like "chatgpt").
  const enough = (sameSite && shared.length > 0) || shared.some((t) => t.length >= 5);
  return enough ? score : 0;
}

/**
 * Links each unlinked bill to the one site in its company it clearly belongs
 * to. A bill that fits two sites equally well, or a site two bills fit
 * equally well, is left for you to link. Sites with a bill or a cost you set
 * are left alone. Returns the bills to link: [billId, siteId].
 */
export function proposeLinks(d: Pick<MoneyData, "bills" | "institutions">): [string, string][] {
  const taken = new Set(d.bills.map((b) => b.institutionId).filter(Boolean) as string[]);
  const sites = d.institutions.filter((s) => !taken.has(s.id) && !s.cost);
  const pairs: { bill: Bill; site: Institution; score: number }[] = [];
  for (const bill of d.bills) {
    if (bill.institutionId) continue;
    for (const site of sites) {
      if (scopeOf(site) !== scopeOf(bill)) continue;
      const score = matchScore(bill, site);
      if (score > 0) pairs.push({ bill, site, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const usedBills = new Set<string>();
  const usedSites = new Set<string>();
  const links: [string, string][] = [];
  for (const p of pairs) {
    if (usedBills.has(p.bill.id) || usedSites.has(p.site.id)) continue;
    const rival = pairs.some(
      (q) => q !== p && q.score === p.score && ((q.bill.id === p.bill.id && !usedSites.has(q.site.id)) || (q.site.id === p.site.id && !usedBills.has(q.bill.id))),
    );
    // Tied: neither this bill nor this site is linked automatically.
    usedBills.add(p.bill.id);
    usedSites.add(p.site.id);
    if (!rival) links.push([p.bill.id, p.site.id]);
  }
  return links;
}

/** Runs the matching once (siteCostRules marks it done). Returns null when it already ran. */
export function linkSiteCosts(d: MoneyData): { data: MoneyData; linked: number } | null {
  if ((d.siteCostRules ?? 0) >= SITE_COST_RULES) return null;
  const links = new Map(proposeLinks(d));
  return {
    linked: links.size,
    data: { ...d, bills: d.bills.map((b) => (links.has(b.id) ? { ...b, institutionId: links.get(b.id) } : b)), siteCostRules: SITE_COST_RULES },
  };
}

/* ---- The last payment that actually came out for each site ---- */

// Words too common in bank descriptions and site names to tie a payment to one site.
const GENERIC = new Set(
  "payment payments online service services charge charges plan subscription subscr membership insurance premium account personal business gladiator maverick bills bill credit card transfer debit purchase monthly annual fees processing remittance portal login website bank banking recurring checking savings".split(" "),
);

const spaced = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const squashed = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** What to look for in a bank description: the site's web name (adobe, netflix, tmobile) and its distinctive words. */
function clues(site: Institution, bills: Bill[]) {
  const words = new Set<string>();
  const squash: string[] = [];
  for (const u of [site.website, site.loginUrl]) {
    const label = domain(u).split(".")[0];
    if (label.length >= 3) words.add(label);
    if (label.length >= 6) squash.push(label);
  }
  for (const name of [site.name, ...bills.map((b) => b.name)]) {
    for (const w of spaced(name).trim().split(" ")) if (w.length >= 5 && !GENERIC.has(w)) words.add(w);
  }
  return { words: [...words], squash };
}

export type LastPayment = { date: string; amount: number; accountId: string };

const near = (b: Bill, amount: number) => Math.abs(b.amount - amount) <= Math.max(0.5, b.amount * 0.02);
const varies = (b: Bill) => /average|varies/i.test(b.note ?? "");

/**
 * For each site, the latest payment out of an account in the same company
 * that clearly belongs to it. Only saved, posted transactions count (bank
 * feeds skip pending ones). A payment that fits several sites goes to the one
 * whose bill has that exact amount, and otherwise to none of them. With a
 * bill linked, the payment must match its amount (unless the bill varies);
 * without one, only an amount that came out at least twice counts, so a
 * one-off purchase from the same company isn't taken for the bill.
 */
export function lastPayments(d: Pick<MoneyData, "institutions" | "bills" | "transactions" | "accounts">): Map<string, LastPayment> {
  const accounts = new Map(d.accounts.filter((a) => !a.needsEntity).map((a) => [a.id, a]));
  const sites = d.institutions.map((site) => {
    const bills = d.bills.filter((b) => b.institutionId === site.id);
    return { site, bills, ...clues(site, bills) };
  });
  const found = new Map<string, { site: (typeof sites)[number]; txns: Transaction[] }>();
  for (const t of d.transactions) {
    if (t.kind !== "expense" || t.transferId) continue;
    const account = accounts.get(t.accountId);
    if (!account) continue;
    const text = spaced(t.description);
    const flat = squashed(t.description);
    const fits = sites.filter(
      (s) => scopeOf(s.site) === scopeOf(account) && (s.words.some((w) => text.includes(` ${w} `)) || s.squash.some((w) => flat.includes(w))),
    );
    const exact = fits.length > 1 ? fits.filter((s) => s.bills.some((b) => near(b, t.amount))) : fits;
    if (exact.length !== 1) continue;
    const hit = found.get(exact[0].site.id) ?? { site: exact[0], txns: [] };
    hit.txns.push(t);
    found.set(exact[0].site.id, hit);
  }
  const out = new Map<string, LastPayment>();
  for (const [id, { site, txns }] of found) {
    const times = new Map<number, number>();
    for (const t of txns) times.set(Math.round(t.amount * 100), (times.get(Math.round(t.amount * 100)) ?? 0) + 1);
    const ok = (t: Transaction) =>
      site.bills.length ? site.bills.some((b) => near(b, t.amount) || varies(b)) : (times.get(Math.round(t.amount * 100)) ?? 0) >= 2;
    const last = txns.filter(ok).sort((x, y) => y.date.localeCompare(x.date))[0];
    if (last) out.set(id, { date: last.date, amount: last.amount, accountId: last.accountId });
  }
  return out;
}
