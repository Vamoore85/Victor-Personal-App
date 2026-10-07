"use client";

import { useEffect, useRef, useState } from "react";
import { deleteFile, formatSize, loadFile, saveFile } from "@/lib/files";
import { newId } from "@/lib/local-store";
import { openBlob, openJson, sealBlob, sealJson, useVault, type Sealed } from "@/features/money/vault";
import { VaultAutoLock, VaultBar } from "@/features/money/vault-ui";
import { ghostButtonClass, inputClass } from "@/features/money/ui";

/*
 * Legacy: will, final wishes and instructions for the people who handle
 * things after a death. Everything here, files included, is encrypted with
 * the Maverick Vault key, so it is readable only with the master password.
 */

const STORAGE_KEY = "maverick.legacy.v1";

const SECTIONS = [
  {
    id: "will",
    title: "My will",
    prompt: "Where the signed original is kept, the date it was signed, who the executor is, and the attorney who prepared it.",
  },
  { id: "contacts", title: "Who to contact first", prompt: "Names, relationship and phone numbers, in the order they should be called." },
  { id: "wishes", title: "Final wishes", prompt: "Burial or cremation, the kind of service, music, readings, organ donation, anything else." },
  {
    id: "money",
    title: "Money and accounts",
    prompt: "What should happen to each account, which bills to stop, where the Financial Center and Maverick Vault hold the details.",
  },
  { id: "business", title: "My business", prompt: "Who takes over Maverick, key contacts, where the business documents are." },
  { id: "insurance", title: "Insurance and benefits", prompt: "Life insurance policies, employer benefits, how to file claims." },
  { id: "property", title: "Home, vehicles and property", prompt: "Deeds, titles, keys, safe deposit box, storage units." },
  { id: "digital", title: "Phone and online accounts", prompt: "How to get into the phone, which accounts to close or memorialize." },
  { id: "dependents", title: "Children, dependents and pets", prompt: "Guardianship wishes, who looks after whom, routines and needs." },
  { id: "messages", title: "Messages to loved ones", prompt: "Anything you want people to hear from you." },
] as const;

type Attachment = { id: string; fileId: string; name: string; type: string; size: number };
type LegacyData = { sections: Record<string, string>; attachments: Attachment[]; updatedAt?: string };
const EMPTY: LegacyData = { sections: {}, attachments: [] };

function readSealed(): Sealed | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Sealed) : null;
  } catch {
    return null;
  }
}

function AttachmentRow({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const blob = await loadFile(a.fileId);
      if (!blob) return;
      const url = URL.createObjectURL(await openBlob(blob, a.type));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 truncate">
        {a.name} <span className="text-xs text-zinc-500">{formatSize(a.size)}</span>
      </span>
      <span className="flex shrink-0 gap-3 text-xs">
        <button className="text-brand" onClick={open} disabled={busy}>{busy ? "Opening…" : "Open"}</button>
        <button className="text-zinc-400 hover:text-rose-600" onClick={onRemove}>Remove</button>
      </span>
    </li>
  );
}

function LegacyEditor() {
  const [data, setData] = useState<LegacyData | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<"saved" | "saving" | "idle">("idle");
  const dirty = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sealed = readSealed();
    (sealed ? openJson<LegacyData>(sealed) : Promise.resolve(EMPTY))
      .then((d) => setData({ sections: d.sections ?? {}, attachments: d.attachments ?? [], updatedAt: d.updatedAt }))
      .catch(() => setError("This Legacy page couldn't be opened with the current vault. It may belong to a different master password."));
  }, []);

  // Save a moment after typing stops.
  useEffect(() => {
    if (!data || !dirty.current) return;
    const t = setTimeout(async () => {
      setSaved("saving");
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(await sealJson(data)));
        dirty.current = false;
        setSaved("saved");
      } catch {
        setSaved("idle");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Opening…</p>;

  const change = (update: (d: LegacyData) => LegacyData) => {
    dirty.current = true;
    setData((d) => (d ? { ...update(d), updatedAt: new Date().toISOString() } : d));
  };

  async function attach(files: FileList) {
    const added: Attachment[] = [];
    for (const f of Array.from(files)) {
      const stored = await saveFile(await sealBlob(f), f.name);
      added.push({ id: newId(), fileId: stored.id, name: f.name, type: f.type, size: f.size });
    }
    change((d) => ({ ...d, attachments: [...d.attachments, ...added] }));
  }

  const filled = SECTIONS.filter((s) => (data.sections[s.id] ?? "").trim()).length;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-zinc-500">
        {filled} of {SECTIONS.length} sections filled in
        {saved === "saving" ? " · Saving…" : saved === "saved" ? " · Saved and encrypted" : ""}
      </p>

      {SECTIONS.map((s) => (
        <section key={s.id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-medium">{s.title}</h2>
          <p className="mb-3 mt-1 text-sm text-zinc-500">{s.prompt}</p>
          <textarea
            className={`${inputClass} min-h-28`}
            value={data.sections[s.id] ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              change((d) => ({ ...d, sections: { ...d.sections, [s.id]: value } }));
            }}
          />
        </section>
      ))}

      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-medium">Documents</h2>
        <p className="mb-3 mt-1 text-sm text-zinc-500">
          Scans or photos of the signed will, power of attorney, advance directive, insurance policies, deeds. Encrypted
          like everything else here.
        </p>
        {data.attachments.length > 0 && (
          <ul className="mb-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.attachments.map((a) => (
              <AttachmentRow
                key={a.id}
                a={a}
                onRemove={() => {
                  if (!confirm(`Remove ${a.name}?`)) return;
                  deleteFile(a.fileId).catch(() => undefined);
                  change((d) => ({ ...d, attachments: d.attachments.filter((x) => x.id !== a.id) }));
                }}
              />
            ))}
          </ul>
        )}
        <button className={ghostButtonClass} onClick={() => fileRef.current?.click()}>Add documents</button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) attach(e.target.files);
            e.target.value = "";
          }}
        />
      </section>
    </div>
  );
}

export function Legacy() {
  const vault = useVault();
  return (
    <div className="flex flex-col gap-6">
      <VaultAutoLock />
      <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">This page is not a will.</p>
        <p className="mt-1">
          It holds your instructions and tells people where things are. A will only counts when it is written, signed and
          witnessed the way your state requires (in Maryland, signed in front of two witnesses). An estate attorney can make
          sure yours holds up. Also make sure someone you trust can find your master password, for example in a sealed
          envelope with your attorney.
        </p>
      </aside>
      <VaultBar />
      {vault.status === "unlocked" && <LegacyEditor />}
    </div>
  );
}
