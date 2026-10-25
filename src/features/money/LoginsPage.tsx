"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { normalizeUrl } from "./calc";
import { PasteLogins } from "./logins-paste-ui";
import { ENTITIES } from "./outlook";
import { scopeOf, ScopeField } from "./scope";
import { newId, setMoneyData, useMoneyData } from "./store";
import type { Institution, MoneyData, Scope } from "./types";
import { Field, buttonClass, ghostButtonClass, inputClass } from "./ui";
import { useVault } from "./vault";
import { InstitutionLogins, VaultAutoLock, VaultBar } from "./vault-ui";

/*
 * The master login portal: every website and account you sign in to, in one
 * searchable list with a link to each. The site names and links are plain
 * records; usernames and passwords stay in the Maverick Vault and only show
 * (and can only be copied or edited) after you unlock it (vault-ui.tsx).
 */

// Same company colors as the Bills and Accounts pages.
const DOT: Record<Scope, string> = { business: "bg-blue-600", personal: "bg-green-600", gladiator: "bg-orange-500" };
const linkClass = "underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100";

type Filter = "all" | Scope;

/** Where a site's Open button goes: its sign-in page, else its website. Empty when none was saved. */
export const siteUrl = (i: Pick<Institution, "loginUrl" | "website">) => i.loginUrl || i.website || "";

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LoginsOverview() {
  const data = useMoneyData();
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  return <Portal data={data} />;
}

function Portal({ data }: { data: MoneyData }) {
  const vault = useVault();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const entries = vault.status === "unlocked" ? vault.entries : [];

  const sites = useMemo(() => [...data.institutions].sort((a, b) => a.name.localeCompare(b.name)), [data.institutions]);
  const q = query.trim().toLowerCase();
  const shown = sites.filter((s) => {
    if (filter !== "all" && scopeOf(s) !== filter) return false;
    if (!q) return true;
    const own = entries.filter((e) => e.institutionId === s.id);
    return [s.name, siteUrl(s), ...own.flatMap((e) => [e.label, e.username, e.url])].some((t) => t?.toLowerCase().includes(q));
  });
  const noLink = sites.filter((s) => !siteUrl(s) && !entries.some((e) => e.institutionId === s.id && e.url)).length;

  return (
    <div className="flex flex-col gap-4">
      <VaultAutoLock />
      <VaultBar />

      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-surface p-3 sm:p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="Search websites and accounts"
            aria-label="Search websites and accounts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className={buttonClass} onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Add website"}</button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Company">
          {([{ id: "all", label: "All" }, ...ENTITIES] as { id: Filter; label: string }[]).map((f) => (
            <button
              key={f.id}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1 text-sm ${filter === f.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {adding && <SiteForm onDone={() => setAdding(false)} />}
      </div>

      <p className="text-sm text-zinc-500">
        {shown.length} of {sites.length} website{sites.length === 1 ? "" : "s"}
        {noLink > 0 && ` · ${noLink} with no link saved yet`}
        {vault.status === "locked" && " · unlock the vault to see your usernames and passwords"}
      </p>

      {sites.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No websites saved yet. Add one above, or import your logins from a spreadsheet below.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:divide-zinc-800 dark:border-zinc-800">
          {shown.map((s) => (
            <SiteRow key={s.id} site={s} accounts={entries.filter((e) => e.institutionId === s.id).length} unlocked={vault.status === "unlocked"} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} />
          ))}
          {shown.length === 0 && <li className="p-4 text-sm text-zinc-500">Nothing matches.</li>}
        </ul>
      )}

      <details className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">Import logins from a spreadsheet</summary>
        <div className="mt-3">
          <PasteLogins data={data} />
        </div>
      </details>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
        <Link href="/accounts" className="underline hover:text-brand">Accounts and bills</Link>
      </div>
    </div>
  );
}

function SiteRow({ site, accounts, unlocked, open, onToggle }: { site: Institution; accounts: number; unlocked: boolean; open: boolean; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const url = siteUrl(site);
  const scope = scopeOf(site);
  return (
    <li className="p-3 sm:px-4">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[scope]}`} title={ENTITIES.find((e) => e.id === scope)!.label} />
        <div className="min-w-0 flex-1">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className={`font-medium ${linkClass}`}>{site.name}</a>
          ) : (
            <span className="font-medium">{site.name}</span>
          )}
          <p className="truncate text-xs text-zinc-500">
            {url ? domainOf(url) : <span className="text-amber-700 dark:text-amber-400">No link saved</span>}
            {" · "}
            {ENTITIES.find((e) => e.id === scope)!.label}
            {unlocked && ` · ${accounts} account${accounts === 1 ? "" : "s"}`}
          </p>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={`${buttonClass} shrink-0`}>
            Open ↗
          </a>
        )}
        <button className={`${ghostButtonClass} shrink-0`} aria-expanded={open} onClick={onToggle}>
          {open ? "Close" : "Accounts"}
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 sm:pl-5">
          {editing ? (
            <SiteForm site={site} onDone={() => setEditing(false)} />
          ) : (
            <button className="self-start text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setEditing(true)}>
              Edit website name or link
            </button>
          )}
          <InstitutionLogins institution={site} />
        </div>
      )}
    </li>
  );
}

/** Adds a website, or edits one's name, link and company. Holds no usernames or passwords. */
function SiteForm({ site, onDone }: { site?: Institution; onDone: () => void }) {
  const [name, setName] = useState(site?.name ?? "");
  const [url, setUrl] = useState(site ? siteUrl(site) : "");
  const [scope, setScope] = useState<Scope>(site ? scopeOf(site) : "personal");

  function save(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const link = normalizeUrl(url);
    setMoneyData((d) => ({
      ...d,
      institutions: site
        ? d.institutions.map((i) => (i.id === site.id ? { ...i, name: n, scope, ...(i.loginUrl ? { loginUrl: link } : { website: link }) } : i))
        : [...d.institutions, { id: newId(), name: n, type: "Website", website: link, loginUrl: "", phone: "", memberNumber: "", notes: "", scope }],
    }));
    onDone();
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-zinc-800">
      <Field label="Website or service">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Geico" autoFocus={!site} />
      </Field>
      <Field label="Link">
        <input className={inputClass} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="geico.com" />
      </Field>
      <ScopeField value={scope} onChange={setScope} />
      <div className="flex gap-2 sm:col-span-3">
        <button className={buttonClass} disabled={!name.trim()}>{site ? "Save" : "Add website"}</button>
        <button type="button" className={ghostButtonClass} onClick={onDone}>Cancel</button>
      </div>
      {!site && <p className="text-xs text-zinc-500 sm:col-span-3">Then open it with Accounts to save a username and password in the vault.</p>}
    </form>
  );
}
