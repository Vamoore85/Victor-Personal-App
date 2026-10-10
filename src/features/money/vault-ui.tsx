"use client";

import { useEffect, useState, type FormEvent } from "react";
import { newId } from "./store";
import type { Institution } from "./types";
import {
  AUTO_LOCK_MINUTES,
  changeMasterPassword,
  createVault,
  generatePassword,
  lockVault,
  saveVaultEntries,
  unlockVault,
  useVault,
  type VaultEntry,
} from "./vault";
import { normalizeUrl } from "./calc";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "./ui";

const MIN_MASTER = 10;
const linkClass =
  "underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100";

/**
 * Locks the vault after AUTO_LOCK_MINUTES with no mouse, key or touch
 * activity, and when the Financial Center is left. Render once, at the top.
 */
export function VaultAutoLock() {
  const vault = useVault();
  useAutoLock(vault.status === "unlocked");
  useEffect(() => lockVault, []);
  return null;
}

function useAutoLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(lockVault, AUTO_LOCK_MINUTES * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lockVault, AUTO_LOCK_MINUTES * 60_000);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [active]);
}

export function VaultBar() {
  const vault = useVault();
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  async function setup(e: FormEvent) {
    e.preventDefault();
    if (pw.length < MIN_MASTER) return setError(`Use at least ${MIN_MASTER} characters.`);
    if (pw !== confirmPw) return setError("The two passwords don't match.");
    setBusy(true);
    await createVault(pw);
    setBusy(false);
    setPw("");
    setConfirmPw("");
    setError("");
  }

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await unlockVault(pw);
    setBusy(false);
    setPw("");
    setError(ok ? "" : "That master password didn't work.");
  }

  if (vault.status === "loading") return null;

  if (vault.status === "none") {
    return (
      <Card title="Set up Maverick Vault">
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Choose a master password. Your logins are encrypted with it on this device, and only the encrypted version is
          saved or exported. <strong>There is no way to recover it</strong>, so pick one you will remember.
        </p>
        <form onSubmit={setup} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Master password">
            <input type="password" autoComplete="new-password" className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Type it again">
            <input type="password" autoComplete="new-password" className={inputClass} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </Field>
          <button className={buttonClass} disabled={busy || !pw}>{busy ? "Creating…" : "Create vault"}</button>
        </form>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </Card>
    );
  }

  if (vault.status === "locked") {
    return (
      <Card title="🔒 Maverick Vault is locked">
        <form onSubmit={unlock} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Master password">
              <input type="password" autoComplete="current-password" className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </Field>
          </div>
          <button className={buttonClass} disabled={busy || !pw}>{busy ? "Unlocking…" : "Unlock"}</button>
        </form>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          🔓 <span className="font-medium">Maverick Vault unlocked.</span>{" "}
          <span className="text-zinc-500">
            {vault.entries.length} login{vault.entries.length === 1 ? "" : "s"} · locks after {AUTO_LOCK_MINUTES} minutes idle
          </span>
        </p>
        <div className="flex gap-2">
          <button className={ghostButtonClass} onClick={() => setChanging((c) => !c)}>Change master password</button>
          <button className={buttonClass} onClick={lockVault}>Lock now</button>
        </div>
      </div>
      {changing && <ChangeMaster onDone={() => setChanging(false)} />}
    </Card>
  );
}

function ChangeMaster({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < MIN_MASTER) return setError(`Use at least ${MIN_MASTER} characters.`);
    if (next !== again) return setError("The new passwords don't match.");
    if (!(await changeMasterPassword(current, next))) return setError("Your current master password is wrong.");
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end dark:border-zinc-800">
      <Field label="Current">
        <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New">
        <input type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="New again">
        <input type="password" autoComplete="new-password" className={inputClass} value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      <button className={buttonClass}>Change</button>
      {error && <p className="text-sm text-rose-600 sm:col-span-4">{error}</p>}
    </form>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked; nothing else to do.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

type Draft = Omit<VaultEntry, "id" | "institutionId">;
const blank = (): Draft => ({ label: "", username: "", password: "", url: "", notes: "" });

/** The logins section on an institution's card. */
export function InstitutionLogins({ institution }: { institution: Institution }) {
  const vault = useVault();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [showDraftPw, setShowDraftPw] = useState(false);

  if (vault.status !== "unlocked") {
    return vault.status === "locked" ? <p className="text-xs text-zinc-400">🔒 Logins hidden while the vault is locked</p> : null;
  }

  const entries = vault.entries.filter((e) => e.institutionId === institution.id);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || (!draft.username && !draft.password)) return;
    const fields = { ...draft, label: draft.label.trim(), username: draft.username.trim(), url: normalizeUrl(draft.url), notes: draft.notes.trim() };
    await saveVaultEntries((prev) =>
      editingId
        ? prev.map((x) => (x.id === editingId ? { ...x, ...fields } : x))
        : [...prev, { id: newId(), institutionId: institution.id, ...fields }],
    );
    setDraft(null);
    setEditingId(null);
    setShowDraftPw(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this login from the vault?")) return;
    await saveVaultEntries((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Logins</p>
        {!draft && (
          <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => { setDraft(blank()); setEditingId(null); }}>
            + Add login
          </button>
        )}
      </div>

      {entries.map((entry) => {
        const open = revealed === entry.id;
        const signIn = entry.url || institution.loginUrl;
        return (
          <div key={entry.id} className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{entry.label || "Login"}</span>
              <span className="flex gap-3 text-xs">
                {signIn && (
                  <a href={signIn} target="_blank" rel="noopener noreferrer" className={linkClass}>Sign in ↗</a>
                )}
                <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => { setEditingId(entry.id); setDraft({ label: entry.label, username: entry.username, password: entry.password, url: entry.url, notes: entry.notes }); }}>
                  Edit
                </button>
                <button className="text-zinc-400 hover:text-rose-600" onClick={() => remove(entry.id)}>Delete</button>
              </span>
            </div>
            <div className="mt-2 grid grid-cols-[5.5rem_1fr_auto] items-center gap-x-3 gap-y-1">
              <span className="text-xs text-zinc-500">Username</span>
              <span className="truncate font-mono text-xs">{entry.username || "—"}</span>
              {entry.username ? <CopyButton value={entry.username} label="Copy" /> : <span />}
              <span className="text-xs text-zinc-500">Password</span>
              <span className="truncate font-mono text-xs">{open ? entry.password : "••••••••••"}</span>
              <span className="flex gap-3">
                <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setRevealed(open ? null : entry.id)}>
                  {open ? "Hide" : "Show"}
                </button>
                <CopyButton value={entry.password} label="Copy" />
              </span>
            </div>
            {entry.notes && (
              <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                {open ? entry.notes : "Notes hidden. Press Show to see them."}
              </p>
            )}
          </div>
        );
      })}

      {draft && (
        <form onSubmit={save} className="grid gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <Field label="What it's for (optional)">
            <input className={inputClass} value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="Online banking" />
          </Field>
          <Field label="Username or email">
            <input className={inputClass} autoComplete="off" value={draft.username} onChange={(e) => set("username", e.target.value)} />
          </Field>
          <Field label="Password">
            <div className="flex gap-2">
              <input
                className={`${inputClass} font-mono`}
                type={showDraftPw ? "text" : "password"}
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => set("password", e.target.value)}
              />
              <button type="button" className={ghostButtonClass} onClick={() => setShowDraftPw((s) => !s)}>{showDraftPw ? "Hide" : "Show"}</button>
              <button type="button" className={ghostButtonClass} onClick={() => { set("password", generatePassword()); setShowDraftPw(true); }}>Generate</button>
            </div>
          </Field>
          <Field label="Sign-in page (optional, if different)">
            <input className={inputClass} inputMode="url" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder={institution.loginUrl || "https://"} />
          </Field>
          <Field label="Notes (PIN, security questions, recovery codes)">
            <textarea className={inputClass} rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button className={buttonClass} disabled={!draft.username && !draft.password}>{editingId ? "Save" : "Add login"}</button>
            <button type="button" className={ghostButtonClass} onClick={() => { setDraft(null); setEditingId(null); setShowDraftPw(false); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
