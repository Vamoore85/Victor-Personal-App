"use client";

import { useEffect, useRef, useState } from "react";
import { createCloudDoc } from "@/lib/cloud-doc";
import { newId } from "@/lib/local-store";
import { EMPTY, ENTITIES, KINDS, linksIn, merge, newThought, normalize, update, visible, type Entity, type Kind, type Source, type Thought } from "./braindump";

const doc = createCloudDoc("braindump", EMPTY, normalize, merge);

const VIEWS: { id: Kind; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "project", label: "Projects" },
  { id: "task", label: "Tasks" },
  { id: "research", label: "Research" },
  { id: "someday", label: "Someday" },
];
const ENTITY_TONE: Record<Entity, string> = {
  business: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  personal: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  gladiator: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};
const SAVE_LABEL = { loading: "Opening…", saved: "Saved", saving: "Saving…", offline: "Saved on this device; will sync when online", local: "Saved on this device" } as const;

type Speech = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };
function speechRecognition(): (new () => Speech) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function Capture() {
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source>("typed");
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const rec = useRef<Speech | null>(null);
  useEffect(() => setCanSpeak(!!speechRecognition()), []);

  const add = () => {
    if (!text.trim()) return;
    const t = newThought(text, source, newId());
    doc.set((d) => ({ thoughts: [t, ...d.thoughts] }));
    setText("");
    setSource("typed");
  };
  const talk = () => {
    if (listening) return rec.current?.stop();
    const SR = speechRecognition();
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
      if (said) {
        setText((t) => (t ? `${t} ${said}` : said));
        setSource("voice");
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-surface p-4 sm:p-5 dark:border-zinc-800" data-testid="capture">
      <label htmlFor="thought" className="text-lg font-semibold">
        What&apos;s on your mind?
      </label>
      <textarea
        id="thought"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
        }}
        placeholder="Type a thought, paste a link, or tap the mic. Add #tags if you like."
        rows={3}
        className="mt-2 w-full resize-y rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ember/40 dark:border-zinc-800"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="rounded-full bg-brand px-5 py-2 text-base font-medium text-on-brand disabled:opacity-50" onClick={add} disabled={!text.trim()}>
          Add thought
        </button>
        {canSpeak && (
          <button
            className={`rounded-full border px-4 py-2 text-base ${listening ? "border-rose-400 text-rose-600" : "border-zinc-300 dark:border-zinc-700"}`}
            onClick={talk}
            aria-pressed={listening}
          >
            {listening ? "● Listening… tap to stop" : "🎙 Speak"}
          </button>
        )}
      </div>
    </section>
  );
}

function ThoughtCard({ t }: { t: Thought }) {
  const [tagDraft, setTagDraft] = useState("");
  const set = (p: Partial<Thought>) => doc.set((d) => update(d, t.id, p));
  const links = linksIn(t.text);
  return (
    <li className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800" data-testid="thought">
      <div className="flex items-start gap-3">
        {t.kind === "task" && (
          <input type="checkbox" checked={!!t.done} onChange={(e) => set({ done: e.target.checked })} aria-label="Done" className="mt-1.5 size-5 accent-[var(--brand)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap break-words text-base ${t.done ? "text-zinc-400 line-through" : ""}`}>{t.text}</p>
          {links.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
              {links.map((l) => (
                <a key={l} href={l} target="_blank" rel="noreferrer" className="truncate text-brand underline">
                  {new URL(l).hostname.replace(/^www\./, "")}
                </a>
              ))}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            {t.source !== "typed" && <span>{t.source === "voice" ? "spoken" : "link"}</span>}
            {t.entity && <span className={`rounded-full px-2 py-0.5 font-medium ${ENTITY_TONE[t.entity]}`}>{ENTITIES.find((e) => e.id === t.entity)?.label}</span>}
            {t.tags.map((g) => (
              <button key={g} className="rounded-full bg-zinc-100 px-2 py-0.5 hover:line-through dark:bg-zinc-800" title="Remove tag" onClick={() => set({ tags: t.tags.filter((x) => x !== g) })}>
                #{g}
              </button>
            ))}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500">{t.kind === "inbox" ? "Sort into" : "Move to"}</span>
          {KINDS.map((k) => (
            <button
              key={k.id}
              title={k.hint}
              className={`rounded-full border px-3 py-1 text-sm ${t.kind === k.id ? "border-brand bg-brand text-on-brand" : "border-zinc-300 hover:border-brand dark:border-zinc-700"}`}
              onClick={() => set({ kind: t.kind === k.id ? "inbox" : k.id })}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500">For</span>
          {ENTITIES.map((e) => (
            <button
              key={e.id}
              className={`rounded-full border px-3 py-1 text-sm ${t.entity === e.id ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}
              onClick={() => set({ entity: t.entity === e.id ? undefined : e.id })}
            >
              {e.label}
            </button>
          ))}
          <form
            className="ml-auto flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const g = tagDraft.trim().replace(/^#/, "").toLowerCase();
              if (g && !t.tags.includes(g)) set({ tags: [...t.tags, g] });
              setTagDraft("");
            }}
          >
            <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="+ tag" aria-label="Add tag" className="w-20 rounded-full border border-zinc-200 bg-transparent px-3 py-1 text-sm dark:border-zinc-800" />
          </form>
          <button
            className="text-sm text-zinc-400 hover:text-rose-600"
            onClick={() => {
              if (window.confirm("Delete this thought?")) set({ deleted: true });
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

export function BrainDumpScreen() {
  const { data, status } = doc.use();
  const [view, setView] = useState<Kind>("inbox");
  const [tag, setTag] = useState("");
  const [entity, setEntity] = useState<Entity | "">("");
  const all = visible(data);
  const count = (k: Kind) => all.filter((t) => t.kind === k && !t.done).length;
  const list = all.filter((t) => t.kind === view && (!tag || t.tags.includes(tag)) && (!entity || t.entity === entity));
  const tags = [...new Set(all.flatMap((t) => t.tags))].sort();

  return (
    <div className="flex flex-col gap-4 lg:gap-5" data-testid="braindump">
      <Capture />

      <nav className="flex flex-wrap items-center gap-2" aria-label="Brain Dump lists">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${view === v.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-surface text-zinc-600 ring-1 ring-zinc-200 dark:text-zinc-300 dark:ring-zinc-800"}`}
          >
            {v.label}
            <span className="ml-1.5 tabular-nums opacity-70">{count(v.id)}</span>
          </button>
        ))}
        <span className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto [&>select]:min-w-0 [&>select]:flex-1 sm:[&>select]:flex-none">
          <select aria-label="Company" value={entity} onChange={(e) => setEntity(e.target.value as Entity | "")} className="rounded-full border border-zinc-200 bg-surface px-3 py-1.5 text-sm dark:border-zinc-800">
            <option value="">All companies</option>
            {ENTITIES.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          {tags.length > 0 && (
            <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-full border border-zinc-200 bg-surface px-3 py-1.5 text-sm dark:border-zinc-800">
              <option value="">All tags</option>
              {tags.map((g) => (
                <option key={g} value={g}>#{g}</option>
              ))}
            </select>
          )}
        </span>
      </nav>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-base text-zinc-500 dark:border-zinc-700">
          {view === "inbox" ? "Inbox is clear. New thoughts land here until you sort them." : `Nothing in ${VIEWS.find((v) => v.id === view)?.label} yet.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((t) => (
            <ThoughtCard key={t.id} t={t} />
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-400" data-testid="save-status">{SAVE_LABEL[status]}</p>
    </div>
  );
}
