"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { deleteFile, fileKind, formatSize, loadFile, saveFile, type StoredFile } from "@/lib/files";
import { newId } from "@/lib/local-store";
import { ghostButtonClass, inputClass } from "@/features/money/ui";

/** A book, video clip, document or link attached to a goal, topic, event or speaker. */
export type Resource = {
  id: string;
  title: string;
  url?: string; // for links
  file?: StoredFile; // for dropped files
  done?: boolean; // read / watched
  addedAt: string;
};

export function normalizeLink(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function youtubeId(url: string) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Plays or opens a file stored in this browser. */
function FileView({ file }: { file: StoredFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    loadFile(file.id).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setMissing(true);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);

  if (missing) return <p className="text-xs text-rose-600">This file isn&apos;t in this browser.</p>;
  if (!url) return <p className="text-xs text-zinc-400">Loading…</p>;
  const kind = fileKind(file.type, file.name);
  if (kind === "video") return <video src={url} controls className="max-h-72 w-full rounded-lg bg-black" />;
  if (kind === "audio") return <audio src={url} controls className="w-full" />;
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- local object URL, not optimizable
    return <img src={url} alt={file.name} className="max-h-72 rounded-lg object-contain" />;
  }
  return (
    <div className="flex gap-3 text-sm">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">
        Open
      </a>
      <a href={url} download={file.name} className="text-zinc-500 underline underline-offset-2">
        Download
      </a>
    </div>
  );
}

const KIND_LABEL = { video: "Video", image: "Image", pdf: "PDF", audio: "Audio", book: "Book", file: "File" } as const;

export function ResourceList({
  resources,
  onChange,
  doneLabel = "Done",
  dropHint = "Drag books, video clips, PDFs or images here",
}: {
  resources: Resource[];
  onChange: (next: Resource[]) => void;
  doneLabel?: string;
  dropHint?: string;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Always add to the latest list, even if several files finish saving at once.
  const latest = useRef(resources);
  useEffect(() => {
    latest.current = resources;
  }, [resources]);

  async function addFiles(files: FileList | File[]) {
    setBusy(true);
    const added: Resource[] = [];
    for (const f of Array.from(files)) {
      try {
        const stored = await saveFile(f, f.name);
        added.push({ id: newId(), title: f.name.replace(/\.[^.]+$/, ""), file: stored, addedAt: new Date().toISOString() });
      } catch {
        // Browser storage full: skip this one.
      }
    }
    setBusy(false);
    if (added.length) onChange([...latest.current, ...added]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) {
      addFiles(e.dataTransfer.files);
      return;
    }
    const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (text && /^https?:\/\//.test(text.trim())) addLink(text.trim());
  }

  function addLink(raw: string) {
    const url = normalizeLink(raw);
    if (!url) return;
    onChange([...latest.current, { id: newId(), title: hostOf(url), url, addedAt: new Date().toISOString() }]);
  }

  function submitLink(e: FormEvent) {
    e.preventDefault();
    addLink(link);
    setLink("");
  }

  function remove(r: Resource) {
    if (r.file) deleteFile(r.file.id).catch(() => undefined);
    onChange(resources.filter((x) => x.id !== r.id));
  }

  const update = (id: string, patch: Partial<Resource>) => onChange(resources.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-3">
      {resources.length > 0 && (
        <ul className="flex flex-col gap-2">
          {resources.map((r) => {
            const kind = r.file ? KIND_LABEL[fileKind(r.file.type, r.file.name)] : youtubeId(r.url ?? "") ? "Video link" : "Link";
            const yt = r.url ? youtubeId(r.url) : null;
            const expanded = open === r.id;
            return (
              <li key={r.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={!!r.done}
                    onChange={(e) => update(r.id, { done: e.target.checked })}
                    title={doneLabel}
                    aria-label={doneLabel}
                  />
                  <div className="min-w-0 flex-1">
                    <input
                      className={`w-full truncate bg-transparent text-sm font-medium outline-none ${r.done ? "text-zinc-400 line-through" : ""}`}
                      value={r.title}
                      onChange={(e) => update(r.id, { title: e.target.value })}
                      aria-label="Title"
                    />
                    <p className="text-xs text-zinc-500">
                      {kind}
                      {r.file && ` · ${formatSize(r.file.size)}`}
                      {r.url && (
                        <>
                          {" · "}
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                            {hostOf(r.url)} ↗
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  {(r.file || yt) && (
                    <button className="text-xs text-brand" onClick={() => setOpen(expanded ? null : r.id)}>
                      {expanded ? "Hide" : r.file && /Video|Audio/.test(kind) || yt ? "Play" : "View"}
                    </button>
                  )}
                  <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => remove(r)}>
                    Remove
                  </button>
                </div>
                {expanded && (
                  <div className="mt-3">
                    {r.file && <FileView file={r.file} />}
                    {yt && (
                      <iframe
                        className="aspect-video w-full rounded-lg"
                        src={`https://www.youtube-nocookie.com/embed/${yt}`}
                        title={r.title}
                        allow="accelerometer; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors ${
          over ? "border-ember bg-ember/10" : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <p className="text-zinc-500">{busy ? "Saving…" : dropHint}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => fileRef.current?.click()}>
            Choose files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <form onSubmit={submitLink} className="flex w-full max-w-md gap-2">
          <input className={inputClass} inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a link (YouTube, book, article)" />
          <button className={ghostButtonClass} disabled={!link.trim()}>Add</button>
        </form>
      </div>
    </div>
  );
}

/** Removes every stored file referenced by these resources (when deleting a goal, topic, etc.). */
export function deleteResourceFiles(resources: Resource[]) {
  resources.forEach((r) => r.file && deleteFile(r.file.id).catch(() => undefined));
}
