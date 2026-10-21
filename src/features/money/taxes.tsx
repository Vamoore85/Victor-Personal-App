"use client";

import { useState } from "react";
import { newId, setMoneyData } from "./store";
import { SCOPES, ScopeBadge, useDefaultScope } from "./scope";
import { TAX_DOC_KINDS, companyLabel, type MoneyData, type Scope, type TaxDoc } from "./types";
import { Card, Empty, Field, buttonClass, inputClass } from "./ui";

/*
 * Tax documents: past returns, W-2s, 1099s, K-1s and letters, kept by tax
 * year and by whose they are. Files go to the online database in 3 MB parts
 * (see /api/tax-docs), so a full return PDF fits.
 */

const PART_BYTES = 3 * 1024 * 1024;

/** Who a document belongs to. Combined files show in each book they cover. */
const WHOSE: { value: string; label: string; scope: Scope; also?: Scope[] }[] = [
  ...SCOPES.map((s) => ({ value: s.value as string, label: s.label, scope: s.value })),
  { value: "personal+business", label: "Personal + Maverick (combined)", scope: "personal", also: ["business"] },
  { value: "personal+business+gladiator", label: "All three (combined)", scope: "personal", also: ["business", "gladiator"] },
];
const whoseValue = (d: { scope?: Scope; alsoScopes?: Scope[] }) => [d.scope ?? "personal", ...(d.alsoScopes ?? [])].join("+");
const whoseOf = (value: string) => WHOSE.find((w) => w.value === value) ?? WHOSE[0];
const MAX_BYTES = 60 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const partUrl = (d: { id: string }, part: number, parts?: number) =>
  `/api/tax-docs?id=${encodeURIComponent(d.id)}&part=${part}${parts ? `&parts=${parts}` : ""}`;

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function typeOf(file: File) {
  if (TYPES.has(file.type)) return file.type;
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.png$/i.test(file.name)) return "image/png";
  return "";
}

/** Guesses the tax year from a name like "2025 Tax Return.pdf"; otherwise last year. */
function guessYear(name: string) {
  const years = [...name.matchAll(/(?:^|\D)(20\d{2})(?:\D|$)/g)].map((m) => Number(m[1]));
  const thisYear = new Date().getFullYear();
  return years.find((y) => y >= 2000 && y <= thisYear) ?? thisYear - 1;
}

function guessKind(name: string) {
  if (/w-?2\b/i.test(name)) return "W-2";
  if (/1099/.test(name)) return "1099";
  if (/k-?1\b/i.test(name)) return "K-1";
  if (/1098/.test(name)) return "1098 (mortgage, student loan)";
  if (/1040|1120|1065|return/i.test(name)) return "Tax return";
  return "Tax return";
}

async function upload(file: File, onProgress: (share: number) => void): Promise<Pick<TaxDoc, "id" | "contentType" | "size" | "parts">> {
  const contentType = typeOf(file);
  if (!contentType) throw new Error("Use a PDF or a photo (JPG, PNG).");
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_BYTES) throw new Error("That file is over 60 MB.");
  const id = newId();
  const parts = Math.ceil(file.size / PART_BYTES);
  for (let i = 0; i < parts; i++) {
    const res = await fetch(partUrl({ id }, i), {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: file.slice(i * PART_BYTES, (i + 1) * PART_BYTES),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      if (i > 0) await fetch(partUrl({ id }, 0, i), { method: "DELETE" }).catch(() => undefined);
      throw new Error(json.error || "Couldn't save the document.");
    }
    onProgress((i + 1) / parts);
  }
  return { id, contentType, size: file.size, parts };
}

/** Fetches every part and opens the whole file in a new tab. */
async function openDoc(d: TaxDoc, download: boolean) {
  const tab = download ? null : window.open("", "_blank");
  const blobs: Blob[] = [];
  for (let i = 0; i < d.parts; i++) {
    const res = await fetch(partUrl(d, i));
    if (!res.ok) {
      tab?.close();
      throw new Error("Couldn't open that document.");
    }
    blobs.push(await res.blob());
  }
  const url = URL.createObjectURL(new Blob(blobs, { type: d.contentType }));
  if (tab) tab.location.href = url;
  else {
    const a = document.createElement("a");
    a.href = url;
    a.download = d.name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function Taxes({ data }: { data: MoneyData }) {
  const defaultScope = useDefaultScope();
  const [whose, setWhose] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState("");

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 12 }, (_, i) => thisYear - i);

  async function add(files: FileList) {
    setError("");
    const list = [...files];
    for (let n = 0; n < list.length; n++) {
      const file = list[n];
      const label = list.length > 1 ? `${file.name} (${n + 1} of ${list.length})` : file.name;
      try {
        setProgress(`Uploading ${label}…`);
        const saved = await upload(file, (share) => setProgress(`Uploading ${label}… ${Math.round(share * 100)}%`));
        const doc: TaxDoc = {
          ...saved,
          name: file.name,
          year: year ?? guessYear(file.name),
          kind: kind ?? guessKind(file.name),
          scope: whoseOf(whose ?? defaultScope).scope,
          alsoScopes: whoseOf(whose ?? defaultScope).also,
          note: "",
          addedAt: new Date().toISOString(),
        };
        setMoneyData((d) => ({ ...d, taxDocs: [doc, ...d.taxDocs] }));
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
        break;
      }
    }
    setProgress(null);
  }

  function update(id: string, patch: Partial<TaxDoc>) {
    setMoneyData((d) => ({ ...d, taxDocs: d.taxDocs.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  }

  async function remove(doc: TaxDoc) {
    if (!confirm(`Delete ${doc.name}? This can't be undone.`)) return;
    const res = await fetch(partUrl(doc, 0, doc.parts), { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't delete that document. Try again.");
      return;
    }
    setMoneyData((d) => ({ ...d, taxDocs: d.taxDocs.filter((x) => x.id !== doc.id) }));
  }

  async function open(doc: TaxDoc, download: boolean) {
    setError("");
    await openDoc(doc, download).catch((e: Error) => setError(e.message));
  }

  const byYear = new Map<number, TaxDoc[]>();
  for (const d of [...data.taxDocs].sort((a, b) => b.year - a.year || a.kind.localeCompare(b.kind))) {
    byYear.set(d.year, [...(byYear.get(d.year) ?? []), d]);
  }

  const small = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="flex flex-col gap-6">
      <Card title="Upload tax documents">
        <p className="mb-4 text-sm text-zinc-500">
          Past returns, W-2s, 1099s, K-1s, estimated payments and IRS letters. Pick who they belong to and the tax year, then choose the
          files. PDFs up to 60 MB are fine, and you can pick several at once.
        </p>
        <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Whose">
            <select className={inputClass} value={whose ?? defaultScope} onChange={(e) => setWhose(e.target.value)}>
              {WHOSE.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tax year">
            <select className={inputClass} value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}>
              <option value="">From the file name, else {thisYear - 1}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What it is">
            <select className={inputClass} value={kind ?? ""} onChange={(e) => setKind(e.target.value || null)}>
              <option value="">Guess from the file name</option>
              {TAX_DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <label className={`${buttonClass} cursor-pointer text-center ${progress ? "pointer-events-none opacity-60" : ""}`}>
            {progress ? "Uploading…" : "Choose files"}
            <input
              type="file"
              multiple
              className="sr-only"
              disabled={!!progress}
              onChange={(e) => {
                if (e.target.files?.length) void add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {progress && <p className="mt-3 text-sm text-zinc-500">{progress}</p>}
        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </Card>

      {byYear.size === 0 ? (
        <Card title="Your tax documents">
          <Empty>Nothing uploaded yet. Start with last year&apos;s returns for you, Maverick and Gladiator.</Empty>
        </Card>
      ) : (
        [...byYear].map(([y, docs]) => (
          <Card key={y} title={`${y} tax year`}>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <button className="max-w-full truncate text-left font-medium hover:underline" onClick={() => open(d, false)}>
                      {d.name}
                    </button>
                    {d.alsoScopes?.length ? (
                      <span className="ml-2 rounded bg-ember/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">Combined</span>
                    ) : (
                      <ScopeBadge item={d} />
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <select aria-label="What it is" className={small} value={d.kind} onChange={(e) => update(d.id, { kind: e.target.value })}>
                        {TAX_DOC_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <select aria-label="Tax year" className={small} value={d.year} onChange={(e) => update(d.id, { year: Number(e.target.value) })}>
                        {years.map((yy) => (
                          <option key={yy} value={yy}>
                            {yy}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Whose"
                        className={small}
                        value={whoseValue(d)}
                        onChange={(e) => {
                          const w = whoseOf(e.target.value);
                          update(d.id, { scope: w.scope, alsoScopes: w.also });
                        }}
                      >
                        {WHOSE.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                      <span>{sizeLabel(d.size)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => open(d, true)}>
                      Download
                    </button>
                    <button className="text-zinc-400 hover:text-rose-600" onClick={() => remove(d)} title={`Delete this ${companyLabel(d.scope)} document`}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
