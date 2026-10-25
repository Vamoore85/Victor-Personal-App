import { normalizeUrl } from "./calc";
import type { Institution, Scope } from "./types";
import type { VaultEntry } from "./vault";

/*
 * Pasting logins from a spreadsheet. Rows are split in memory and turned into
 * vault entries only after you press Save; nothing here is stored as-is.
 * Rows with no name and no website are skipped; a header row is optional.
 */

export type LoginRow = { company: string; website: string; username: string; password: string; notes: string };
type Field = keyof LoginRow;

const HEADINGS: { key: Field; match: RegExp }[] = [
  { key: "company", match: /^(account )?name$|company|institution|^account$|^service$|^site name$/i },
  { key: "website", match: /website|^url$|site|address|link/i },
  { key: "username", match: /user|login id|^login$|e-?mail/i },
  { key: "password", match: /^pass(word)?$|^pwd$/i },
  { key: "notes", match: /note|other|detail|question|pin|recovery/i },
];
const ORDER: Field[] = ["company", "website", "username", "password", "notes"];

/** Splits one line on commas, honouring double quotes ("a, b" and "" for a quote). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseLoginRows(text: string): { rows: LoginRow[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const tabs = lines.some((l) => l.includes("\t"));
  const cells = lines.map((l) => (tabs ? l.split("\t") : splitCsv(l)).map((c) => c.trim()));

  // A header row names its columns; without one, columns follow the order of the paste.
  let map: Field[] = ORDER;
  let body = cells;
  const first = cells[0] ?? [];
  if (first.filter((c) => HEADINGS.some((h) => h.match.test(c))).length >= 2) {
    map = first.map((c) => HEADINGS.find((h) => h.match.test(c))?.key ?? ("skip" as Field));
    body = cells.slice(1);
  }

  const rows: LoginRow[] = [];
  let skipped = 0;
  for (const line of body) {
    const row: LoginRow = { company: "", website: "", username: "", password: "", notes: "" };
    line.forEach((value, i) => {
      const key = map[i];
      if (key && key !== ("skip" as Field) && !row[key]) row[key] = value;
    });
    if (!row.company && row.website) row.company = row.website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
    if (!row.company || (!row.username && !row.password)) { skipped++; continue; }
    rows.push(row);
  }
  return { rows, skipped };
}

export type ImportPlan = {
  institutions: Institution[]; // companies that don't exist yet
  entries: VaultEntry[];
  duplicates: number; // same company, username and password already in the vault
};

/** Matches rows to existing companies (by name, any case) and drops logins already in the vault. */
export function planLoginImport(
  rows: LoginRow[],
  institutions: Institution[],
  existing: VaultEntry[],
  scope: Scope,
  newId: () => string,
): ImportPlan {
  const byName = new Map(institutions.map((i) => [i.name.trim().toLowerCase(), i]));
  const seen = new Set(existing.map((e) => `${e.institutionId}|${e.username}|${e.password}`));
  const created: Institution[] = [];
  const entries: VaultEntry[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = row.company.toLowerCase();
    let inst = byName.get(key);
    if (!inst) {
      inst = { id: newId(), name: row.company, type: "Other", website: normalizeUrl(row.website), loginUrl: "", phone: "", memberNumber: "", notes: "", scope };
      byName.set(key, inst);
      created.push(inst);
    }
    const id = `${inst.id}|${row.username}|${row.password}`;
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id);
    entries.push({ id: newId(), institutionId: inst.id, label: "Login", username: row.username, password: row.password, url: normalizeUrl(row.website), notes: row.notes });
  }
  return { institutions: created, entries, duplicates };
}
