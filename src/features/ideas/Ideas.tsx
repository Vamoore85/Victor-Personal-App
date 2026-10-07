"use client";

import { useState, type KeyboardEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";

type Idea = { id: string; text: string; pinned: boolean; createdAt: string; updatedAt: string };

const store = createLocalStore<{ ideas: Idea[] }>("maverick.ideas.v1", { ideas: [] }, (raw) => {
  const v = raw as { ideas?: Idea[] } | null;
  return { ideas: Array.isArray(v?.ideas) ? v.ideas : [] };
});

const tagsOf = (text: string) => [...new Set((text.match(/#[\p{L}\d_-]+/gu) ?? []).map((t) => t.toLowerCase()))];

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function IdeaCard({ idea }: { idea: Idea }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.text);
  const save = () => {
    const text = draft.trim();
    if (text && text !== idea.text) {
      store.set((d) => ({
        ideas: d.ideas.map((i) => (i.id === idea.id ? { ...i, text, updatedAt: new Date().toISOString() } : i)),
      }));
    }
    setEditing(false);
  };
  const patch = (p: Partial<Idea>) => store.set((d) => ({ ideas: d.ideas.map((i) => (i.id === idea.id ? { ...i, ...p } : i)) }));

  return (
    <article
      className={`mb-4 break-inside-avoid rounded-xl border p-4 ${
        idea.pinned ? "border-ember bg-ember/5" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {editing ? (
        <textarea
          className={`${inputClass} min-h-32`}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            if (e.key === "Escape") {
              setDraft(idea.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <p className="cursor-text whitespace-pre-wrap text-sm leading-relaxed" onClick={() => { setDraft(idea.text); setEditing(true); }}>
          {idea.text}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-zinc-400">
        <span>{when(idea.createdAt)}</span>
        <span className="flex gap-3">
          <button className="hover:text-brand" onClick={() => patch({ pinned: !idea.pinned })}>
            {idea.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            className="hover:text-rose-600"
            onClick={() => {
              if (confirm("Delete this idea?")) store.set((d) => ({ ideas: d.ideas.filter((i) => i.id !== idea.id) }));
            }}
          >
            Delete
          </button>
        </span>
      </div>
    </article>
  );
}

export function Ideas() {
  const data = store.use();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  function add() {
    const t = text.trim();
    if (!t) return;
    const now = new Date().toISOString();
    store.set((d) => ({ ideas: [{ id: newId(), text: t, pinned: false, createdAt: now, updatedAt: now }, ...d.ideas] }));
    setText("");
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
  };

  const allTags = [...new Set(data.ideas.flatMap((i) => tagsOf(i.text)))].sort();
  const q = query.trim().toLowerCase();
  const shown = data.ideas
    .filter((i) => (!q || i.text.toLowerCase().includes(q)) && (!tag || tagsOf(i.text).includes(tag)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <textarea
          className="min-h-28 w-full resize-y bg-transparent text-base outline-none placeholder:text-zinc-400"
          placeholder="Dump an idea. Anything goes. Add #tags to group them later."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-400">Ctrl or ⌘ + Enter to save</span>
          <button className={buttonClass} onClick={add} disabled={!text.trim()}>Save idea</button>
        </div>
      </section>

      {data.ideas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-64">
            <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ideas" />
          </div>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className={`rounded-full border px-3 py-1 text-xs ${tag === t ? "border-brand bg-brand text-on-brand" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              {t}
            </button>
          ))}
          {(q || tag) && (
            <button className={ghostButtonClass} onClick={() => { setQuery(""); setTag(null); }}>Clear</button>
          )}
        </div>
      )}

      {data.ideas.length === 0 ? (
        <p className="text-sm text-zinc-500">No ideas yet. Your first one goes in the box above.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No ideas match.</p>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {shown.map((i) => (
            <IdeaCard key={i.id} idea={i} />
          ))}
        </div>
      )}
    </div>
  );
}
