import { randomUUID } from "node:crypto";
import { EMPTY_DATA, type Institution, type MoneyData, type Scope } from "@/features/money/types";

/*
 * Your website directory (names and links only, never usernames or
 * passwords), delivered through the PENDING_SITES environment variable in
 * Vercel instead of the (public) code repository.
 * Format: {"sites": [[scope, name, website, what it is], ...], "check": {"count"}}.
 * Added to the Logins list the next time the app loads. A site you already
 * had under the same company (same name or same web address) is skipped, and one
 * you delete later isn't brought back (siteImports remembers it).
 */

type Row = [Scope, string, string, string];
type Pending = { sites: Row[]; check?: { count: number } };

const SCOPES: Scope[] = ["personal", "business", "gladiator"];

function pending(raw: string | undefined): Pending | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Pending;
    if (!Array.isArray(p.sites) || p.sites.some((r) => !SCOPES.includes(r[0]) || typeof r[1] !== "string" || !r[1].trim())) {
      console.error("PENDING_SITES has a bad row");
      return null;
    }
    if (p.check && p.sites.length !== p.check.count) {
      console.error("PENDING_SITES failed its check", p.sites.length);
      return null;
    }
    return p;
  } catch {
    console.error("PENDING_SITES isn't valid JSON");
    return null;
  }
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const host = (url: string) => url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
const importKey = (scope: Scope, name: string) => `${scope}|${nameKey(name)}`;

/** Returns the data with the new sites added, or null when there's nothing new. */
export function applyPendingSites(current: unknown, raw?: string): { data: MoneyData; added: number; noLink: number } | null {
  const p = pending(raw ?? process.env.PENDING_SITES);
  if (!p) return null;
  const base = { ...EMPTY_DATA, ...((current as Partial<MoneyData>) ?? {}) } as MoneyData;
  const before = base.siteImports ?? [];
  const done = new Set(before);
  const imports = [...before];
  const had = base.institutions ?? [];
  const institutions = [...had];
  let added = 0;
  let noLink = 0;
  for (const [scope, name, website, kind] of p.sites) {
    const k = importKey(scope, name);
    if (done.has(k)) continue;
    done.add(k);
    imports.push(k);
    const url = website ? `https://${website.replace(/^https?:\/\//, "")}` : "";
    // Several rows can share a web address (two accounts at one bank), so only sites you had before match by address.
    const same = (i: Institution) => (i.scope ?? "personal") === scope && nameKey(i.name) === nameKey(name);
    const there = institutions.some(same) || had.some((i) => (i.scope ?? "personal") === scope && !!url && [i.website, i.loginUrl].some((u) => u && host(u) === host(url)));
    if (there) continue;
    const site: Institution = { id: randomUUID(), name: name.trim(), type: kind || "Website", website: url, loginUrl: "", phone: "", memberNumber: "", notes: "", scope };
    institutions.push(site);
    added++;
    if (!url) noLink++;
  }
  if (imports.length === before.length) return null;
  return { data: { ...base, institutions, siteImports: imports }, added, noLink };
}
