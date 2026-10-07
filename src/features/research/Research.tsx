"use client";

import { useState, type FormEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { ResourceList, deleteResourceFiles, type Resource } from "@/components/Resources";
import { Field, buttonClass, inputClass } from "@/features/money/ui";

const STATUSES = ["Exploring", "Answered", "Parked"] as const;
type Status = (typeof STATUSES)[number];

type Topic = {
  id: string;
  title: string;
  question: string;
  notes: string;
  status: Status;
  resources: Resource[];
  createdAt: string;
};

const store = createLocalStore<{ topics: Topic[] }>("maverick.research.v1", { topics: [] }, (raw) => {
  const v = raw as { topics?: Topic[] } | null;
  return { topics: Array.isArray(v?.topics) ? v.topics : [] };
});

const patch = (id: string, p: Partial<Topic>) => store.set((d) => ({ topics: d.topics.map((t) => (t.id === id ? { ...t, ...p } : t)) }));

const STATUS_STYLE: Record<Status, string> = {
  Exploring: "bg-ember/15 text-brand",
  Answered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Parked: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

function TopicView({ topic, onClose }: { topic: Topic; onClose: () => void }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <input
          className="w-full bg-transparent text-xl font-semibold outline-none"
          value={topic.title}
          onChange={(e) => patch(topic.id, { title: e.target.value })}
          aria-label="Topic"
        />
        <button className="shrink-0 text-sm text-zinc-500 hover:text-brand" onClick={onClose}>Close</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="The question I'm trying to answer">
          <input className={inputClass} value={topic.question} onChange={(e) => patch(topic.id, { question: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className={inputClass} value={topic.status} onChange={(e) => patch(topic.id, { status: e.target.value as Status })}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes and findings">
        <textarea className={`${inputClass} min-h-48`} value={topic.notes} onChange={(e) => patch(topic.id, { notes: e.target.value })} />
      </Field>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Sources</p>
        <ResourceList
          resources={topic.resources}
          onChange={(resources) => patch(topic.id, { resources })}
          doneLabel="Reviewed"
          dropHint="Drag in articles, PDFs, books, video clips or screenshots"
        />
      </div>
      <button
        className="self-start text-xs text-zinc-400 hover:text-rose-600"
        onClick={() => {
          if (!confirm("Delete this topic and its files?")) return;
          deleteResourceFiles(topic.resources);
          store.set((d) => ({ topics: d.topics.filter((t) => t.id !== topic.id) }));
          onClose();
        }}
      >
        Delete topic
      </button>
    </section>
  );
}

export function Research() {
  const data = store.use();
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const id = newId();
    store.set((d) => ({
      topics: [{ id, title: title.trim(), question: "", notes: "", status: "Exploring", resources: [], createdAt: new Date().toISOString() }, ...d.topics],
    }));
    setTitle("");
    setOpenId(id);
  }

  const open = data.topics.find((t) => t.id === openId);
  const q = query.trim().toLowerCase();
  const shown = data.topics.filter(
    (t) => !q || [t.title, t.question, t.notes, ...t.resources.map((r) => r.title)].join(" ").toLowerCase().includes(q),
  );

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="min-w-56 flex-1">
          <Field label="New research topic">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Best LLC setup for Maverick" />
          </Field>
        </div>
        <button className={buttonClass} disabled={!title.trim()}>Start topic</button>
      </form>

      {open && <TopicView topic={open} onClose={() => setOpenId(null)} />}

      {data.topics.length === 0 ? (
        <p className="text-sm text-zinc-500">No topics yet. Start one above, then collect notes and sources as you go.</p>
      ) : (
        <>
          <div className="w-full sm:w-72">
            <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics, notes and sources" />
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setOpenId(t.id)}
                  className={`flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left hover:border-ember ${
                    t.id === openId ? "border-ember" : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium">{t.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  </span>
                  {t.question && <span className="text-sm text-zinc-600 dark:text-zinc-400">{t.question}</span>}
                  <span className="mt-auto text-xs text-zinc-500">
                    {t.resources.length} source{t.resources.length === 1 ? "" : "s"}
                    {t.notes.trim() && ` · ${t.notes.trim().split(/\s+/).length} words of notes`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
