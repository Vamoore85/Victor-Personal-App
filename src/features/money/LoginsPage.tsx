"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { normalizeUrl } from "./calc";
import { PasteLogins } from "./logins-paste-ui";
import { ENTITIES } from "./outlook";
import { scopeOf, ScopeField } from "./scope";
import { cloudErrorMessage, cloudReady, newId, retryCloud, setMoneyData, useCloudState, useMoneyData } from "./store";
import type { Institution, MoneyData, Scope } from "./types";
import { Field, inputClass } from "./ui";
import { useVault, type VaultEntry } from "./vault";
import { InstitutionLogins, VaultAutoLock, VaultBar } from "./vault-ui";

/*
 * The master login portal: every website and account you sign in to, in one
 * searchable table with a link to each. The site names and links are plain
 * records; usernames and passwords stay in the Maverick Vault and only show
 * (and can only be copied or edited) after you unlock it (vault-ui.tsx).
 */

const NAVY = "text-[#13233f] dark:text-zinc-100";
const TEAL_LINK = "font-medium text-teal-700 underline decoration-teal-700/40 underline-offset-2 hover:decoration-teal-700 dark:text-teal-400";
const TEAL_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40";
const TEAL_OUTLINE = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40";
const PLAIN_OUTLINE = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";

// Same company colors as the Bills and Accounts pages.
const PILL: Record<Scope, string> = {
  business: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  personal: "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  gladiator: "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
};
const GENERIC = new Set(["", "other", "website"]);

type Filter = "all" | Scope;

/** Where a site's links go: its sign-in page, else its website. Empty when none was saved. */
export const siteUrl = (i: Pick<Institution, "loginUrl" | "website">) => i.loginUrl || i.website || "";

const groupLabel = (s: Scope) => ENTITIES.find((e) => e.id === s)!.label;

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function OutIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function LoginsOverview() {
  const data = useMoneyData();
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  return <Portal data={data} />;
}

function Portal({ data }: { data: MoneyData }) {
  const vault = useVault();
  const cloud = useCloudState();
  // This browser's copy shows at once; the saved directory arrives from the database a moment later.
  const state = cloud === "off" || cloudReady() ? "ready" : cloud === "error" ? "failed" : "loading";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const unlocked = vault.status === "unlocked";
  const entries = unlocked ? vault.entries : [];

  const sites = useMemo(() => [...data.institutions].sort((a, b) => a.name.localeCompare(b.name)), [data.institutions]);
  const q = query.trim().toLowerCase();
  const shown = sites.filter((s) => {
    if (filter !== "all" && scopeOf(s) !== filter) return false;
    if (!q) return true;
    const own = entries.filter((e) => e.institutionId === s.id);
    return [s.name, s.type, siteUrl(s), ...own.flatMap((e) => [e.label, e.username, e.url])].some((t) => t?.toLowerCase().includes(q));
  });
  const noLink = sites.filter((s) => !siteUrl(s)).length;

  return (
    <div className={`flex flex-col gap-5 ${NAVY}`}>
      <VaultAutoLock />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Master login portal</h1>
          <p className="mt-1 text-zinc-500 sm:text-lg">Your websites and accounts, all in one place.</p>
        </div>
        <button className={TEAL_BUTTON} onClick={() => setAdding((a) => !a)}>
          <span aria-hidden="true" className="text-lg leading-none">+</span> Add login
        </button>
      </div>

      {adding && <SiteForm onDone={(id) => { setAdding(false); if (id) setOpenId(id); }} />}

      <div className="relative max-w-3xl">
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          className="w-full rounded-xl border border-zinc-300 bg-surface py-3 pl-11 pr-4 text-base outline-none focus:border-teal-700 dark:border-zinc-700"
          placeholder="Search websites or accounts"
          aria-label="Search websites or accounts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Group">
          {([{ id: "all", label: "All" }, ...ENTITIES] as { id: Filter; label: string }[]).map((f) => (
            <button
              key={f.id}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${filter === f.id ? "border-teal-700 bg-teal-700 text-white" : "border-zinc-300 bg-surface hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {unlocked ? (
          <span className="text-sm text-zinc-500">🔓 Login details unlocked</span>
        ) : (
          <button className={PLAIN_OUTLINE} aria-expanded={unlocking} onClick={() => setUnlocking((u) => !u)}>
            <LockIcon /> Unlock login details
          </button>
        )}
      </div>

      {(unlocking || unlocked) && <VaultBar />}

      {state === "failed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <span>Couldn&apos;t load your saved websites{cloudErrorMessage() ? `: ${cloudErrorMessage()}` : "."} What&apos;s below is only this browser&apos;s copy.</span>
          <button className={PLAIN_OUTLINE} onClick={retryCloud}>Try again</button>
        </div>
      )}

      <p className="text-sm text-zinc-500">
        {state === "loading" ? "Loading your saved websites…" : `${shown.length} of ${sites.length} website${sites.length === 1 ? "" : "s"}`}
        {state !== "loading" && noLink > 0 && ` · ${noLink} with no link saved`}
      </p>

      {sites.length === 0 && state === "loading" ? (
        <p className="rounded-2xl border border-zinc-200 bg-surface p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">Loading…</p>
      ) : sites.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No websites saved yet. Press Add login to add one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-surface dark:border-zinc-800">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_7rem_auto] gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-sm font-semibold md:grid dark:border-zinc-800 dark:bg-zinc-900">
            <span>Website</span>
            <span>Account</span>
            <span>Group</span>
            <span className="w-[17rem]">Actions</span>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {shown.map((s) => (
              <SiteRow
                key={s.id}
                site={s}
                logins={entries.filter((e) => e.institutionId === s.id)}
                unlocked={unlocked}
                open={openId === s.id}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              />
            ))}
            {shown.length === 0 && <li className="p-5 text-sm text-zinc-500">Nothing matches.</li>}
          </ul>
        </div>
      )}

      <p className="flex items-center gap-2 text-sm text-zinc-500">
        <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-400 text-xs">i</span>
        Open a website, then unlock to see your saved login details.
      </p>

      <details className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">Import logins from a spreadsheet</summary>
        <div className="mt-3">
          <PasteLogins data={data} />
        </div>
      </details>

      <div className="text-sm text-zinc-500">
        <Link href="/accounts" className="underline hover:text-teal-700">Accounts and bills</Link>
      </div>
    </div>
  );
}

function SiteRow({ site, logins, unlocked, open, onToggle }: { site: Institution; logins: VaultEntry[]; unlocked: boolean; open: boolean; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const url = siteUrl(site);
  const scope = scopeOf(site);
  const kind = GENERIC.has(site.type.trim().toLowerCase()) ? "" : site.type;
  const who = logins.map((l) => l.username || l.label).filter(Boolean);

  return (
    <li className="px-4 py-3 md:px-5">
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_7rem_auto] md:gap-4">
        <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {site.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className={`${TEAL_LINK} break-words`}>
                {site.name}
                <span className="ml-1 inline-block align-middle"><OutIcon /></span>
              </a>
            ) : (
              <span className="font-medium">{site.name}</span>
            )}
            {!url && <p className="text-xs text-amber-700 dark:text-amber-400">No link saved</p>}
          </div>
        </div>
        <div className={`col-start-2 min-w-0 text-sm md:col-start-auto ${kind || unlocked ? "" : "hidden md:block"}`}>
          <p className="truncate">{kind || <span className="text-zinc-400">—</span>}</p>
          {unlocked && <p className="truncate text-xs text-zinc-500">{who.length ? who.join(", ") : "No login saved yet"}</p>}
        </div>
        <div className="col-start-2 md:col-start-auto">
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${PILL[scope]}`}>{groupLabel(scope)}</span>
        </div>
        <div className="col-span-2 flex gap-2 md:col-span-1 md:w-[17rem]">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className={`${TEAL_OUTLINE} flex-1`}>
              Open website <OutIcon />
            </a>
          ) : (
            <span className="flex-1" />
          )}
          <button className={`${PLAIN_OUTLINE} flex-1`} aria-expanded={open} onClick={onToggle}>
            <LockIcon /> {open ? "Close" : "Login details"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-zinc-50 p-3 md:ml-12 dark:bg-zinc-900/60">
          {!unlocked && <VaultBar />}
          <InstitutionLogins institution={site} />
          {editing ? (
            <SiteForm site={site} onDone={() => setEditing(false)} />
          ) : (
            <button className="self-start text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setEditing(true)}>
              Edit website name, link or group
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Adds a website, or edits one's name, link and group. Holds no usernames or passwords. */
function SiteForm({ site, onDone }: { site?: Institution; onDone: (id?: string) => void }) {
  const [name, setName] = useState(site?.name ?? "");
  const [url, setUrl] = useState(site ? siteUrl(site) : "");
  const [kind, setKind] = useState(site && !GENERIC.has(site.type.trim().toLowerCase()) ? site.type : "");
  const [scope, setScope] = useState<Scope>(site ? scopeOf(site) : "personal");

  function save(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const link = normalizeUrl(url);
    const id = site?.id ?? newId();
    const type = kind.trim() || (site ? site.type : "Website");
    setMoneyData((d) => ({
      ...d,
      institutions: site
        ? d.institutions.map((i) => (i.id === site.id ? { ...i, name: n, type, scope, ...(i.loginUrl ? { loginUrl: link } : { website: link }) } : i))
        : [...d.institutions, { id, name: n, type, website: link, loginUrl: "", phone: "", memberNumber: "", notes: "", scope }],
    }));
    onDone(site ? undefined : id);
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-2xl border border-zinc-200 bg-surface p-4 sm:grid-cols-2 sm:items-end lg:grid-cols-4 dark:border-zinc-800">
      <Field label="Website or service">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Geico" autoFocus={!site} />
      </Field>
      <Field label="Link">
        <input className={inputClass} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="geico.com" />
      </Field>
      <Field label="Account (what it's for)">
        <input className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Car insurance" />
      </Field>
      <ScopeField value={scope} onChange={setScope} />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <button className={TEAL_BUTTON} disabled={!name.trim()}>{site ? "Save" : "Add website"}</button>
        <button type="button" className={PLAIN_OUTLINE} onClick={() => onDone()}>Cancel</button>
        {!site && <span className="text-xs text-zinc-500">Next, save the username and password under Login details. They&apos;re kept in your vault.</span>}
      </div>
    </form>
  );
}
