import type { Bill, Institution, Scope } from "@/features/money/types";
import type { EmailItem } from "./parse";

/*
 * Suggestions for reviewing an email bill: which company it probably belongs
 * to, and which saved bill it probably is. Both are only suggestions. Your
 * Gmail is personal, but a bill in it can be Maverick's or Gladiator's, so a
 * company is never filled in unless exactly one fits, and you still confirm it.
 */

const scopeOf = (x: { scope?: Scope }) => x.scope ?? "personal";
const GENERIC = new Set(
  "payment payments online service services bill bills billing account accounts customer support notification notifications statement statements email reply noreply alerts team member membership insurance financial bank card credit".split(" "),
);

function mainDomain(url: string | undefined) {
  if (!url) return "";
  const host = url.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  return host.split(".").slice(-2).join(".");
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !GENERIC.has(w)));

function fits(item: EmailItem, name: string, urls: (string | undefined)[]) {
  const label = item.fromDomain.split(".")[0];
  if (item.fromDomain && urls.some((u) => mainDomain(u) === item.fromDomain)) return true;
  const mine = words(`${item.merchant} ${label}`);
  return [...words(name)].some((w) => mine.has(w));
}

export type ScopeHint = { scope: Scope | null; why: string };

/** The one company whose login sites or saved bills match the sender, if only one does. */
export function suggestScope(item: EmailItem, sites: Institution[], bills: Bill[]): ScopeHint {
  const hits = new Map<Scope, string>();
  for (const s of sites) if (fits(item, s.name, [s.website, s.loginUrl])) hits.set(scopeOf(s), hits.get(scopeOf(s)) ?? s.name);
  for (const b of bills) if (fits(item, b.name, [b.url])) hits.set(scopeOf(b), hits.get(scopeOf(b)) ?? b.name);
  if (hits.size === 1) {
    const [[scope, name]] = [...hits];
    return { scope, why: `Matches "${name}"` };
  }
  if (hits.size > 1) return { scope: null, why: "This sender matches more than one company. Pick one." };
  return { scope: null, why: "No match in your logins or bills. Pick a company." };
}

/** The saved bill in that company this email is for, when exactly one fits. */
export function suggestBill(item: EmailItem, scope: Scope, bills: Bill[]): Bill | null {
  const same = bills.filter((b) => scopeOf(b) === scope && fits(item, b.name, [b.url]));
  return same.length === 1 ? same[0] : null;
}

/** A link that opens the message in Gmail, in the right account. */
export const gmailLink = (id: string, email: string | null) =>
  `https://mail.google.com/mail/${email ? `?authuser=${encodeURIComponent(email)}` : "u/0/"}#all/${encodeURIComponent(id)}`;
