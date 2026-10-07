"use client";

import { useState, type FormEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { ResourceList, deleteResourceFiles, normalizeLink, type Resource } from "@/components/Resources";
import { Field, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";

const EVENT_STATUSES = ["Interested", "Going", "Hosting", "Attended", "Skipped"] as const;
type EventStatus = (typeof EVENT_STATUSES)[number];

type MavEvent = {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  url: string;
  status: EventStatus;
  speakerIds: string[];
  notes: string;
  resources: Resource[];
};

type Speaker = {
  id: string;
  name: string;
  topic: string;
  website: string;
  contact: string;
  notes: string;
  resources: Resource[];
};

type Data = { events: MavEvent[]; speakers: Speaker[] };

const store = createLocalStore<Data>("maverick.events.v1", { events: [], speakers: [] }, (raw) => {
  const v = raw as Partial<Data> | null;
  return { events: Array.isArray(v?.events) ? v.events : [], speakers: Array.isArray(v?.speakers) ? v.speakers : [] };
});

const patchEvent = (id: string, p: Partial<MavEvent>) => store.set((d) => ({ ...d, events: d.events.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
const patchSpeaker = (id: string, p: Partial<Speaker>) => store.set((d) => ({ ...d, speakers: d.speakers.map((s) => (s.id === id ? { ...s, ...p } : s)) }));

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function prettyDate(ymd: string) {
  if (!ymd) return "Date not set";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const STATUS_STYLE: Record<EventStatus, string> = {
  Interested: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  Going: "bg-ember/15 text-brand",
  Hosting: "bg-brand text-on-brand",
  Attended: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Skipped: "bg-zinc-500/10 text-zinc-400",
};

function EventCard({ ev, speakers }: { ev: MavEvent; speakers: Speaker[] }) {
  const [open, setOpen] = useState(false);
  const linked = speakers.filter((s) => ev.speakerIds.includes(s.id));
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => setOpen(!open)}>
          <p className="font-medium">{ev.name}</p>
          <p className="text-xs text-zinc-500">
            {prettyDate(ev.date)}
            {ev.time && ` · ${ev.time}`}
            {ev.location && ` · ${ev.location}`}
          </p>
          {linked.length > 0 && <p className="mt-1 text-xs text-zinc-500">Speakers: {linked.map((s) => s.name).join(", ")}</p>}
        </button>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[ev.status]}`}>{ev.status}</span>
      </div>
      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date"><input type="date" className={inputClass} value={ev.date} onChange={(e) => patchEvent(ev.id, { date: e.target.value })} /></Field>
            <Field label="Time"><input className={inputClass} value={ev.time} onChange={(e) => patchEvent(ev.id, { time: e.target.value })} placeholder="7:00 PM" /></Field>
            <Field label="Status">
              <select className={inputClass} value={ev.status} onChange={(e) => patchEvent(ev.id, { status: e.target.value as EventStatus })}>
                {EVENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Location"><input className={inputClass} value={ev.location} onChange={(e) => patchEvent(ev.id, { location: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <Field label="Event page or tickets">
                <div className="flex gap-2">
                  <input className={inputClass} inputMode="url" value={ev.url} onChange={(e) => patchEvent(ev.id, { url: e.target.value })} onBlur={(e) => patchEvent(ev.id, { url: normalizeLink(e.target.value) })} />
                  {ev.url && <a className={ghostButtonClass} href={ev.url} target="_blank" rel="noopener noreferrer">Open ↗</a>}
                </div>
              </Field>
            </div>
          </div>
          {speakers.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-zinc-500">Speakers at this event</p>
              <div className="flex flex-wrap gap-2">
                {speakers.map((s) => {
                  const on = ev.speakerIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => patchEvent(ev.id, { speakerIds: on ? ev.speakerIds.filter((x) => x !== s.id) : [...ev.speakerIds, s.id] })}
                      className={`rounded-full border px-3 py-1 text-xs ${on ? "border-brand bg-brand text-on-brand" : "border-zinc-300 dark:border-zinc-700"}`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Field label="Notes">
            <textarea className={`${inputClass} min-h-24`} value={ev.notes} onChange={(e) => patchEvent(ev.id, { notes: e.target.value })} placeholder="Why go, who to meet, takeaways" />
          </Field>
          <ResourceList resources={ev.resources} onChange={(resources) => patchEvent(ev.id, { resources })} doneLabel="Reviewed" dropHint="Drag in flyers, photos, recordings or slides" />
          <button
            className="self-start text-xs text-zinc-400 hover:text-rose-600"
            onClick={() => {
              if (!confirm("Delete this event?")) return;
              deleteResourceFiles(ev.resources);
              store.set((d) => ({ ...d, events: d.events.filter((x) => x.id !== ev.id) }));
            }}
          >
            Delete event
          </button>
        </div>
      )}
    </li>
  );
}

function SpeakerCard({ sp, events }: { sp: Speaker; events: MavEvent[] }) {
  const [open, setOpen] = useState(false);
  const at = events.filter((e) => e.speakerIds.includes(sp.id));
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <button className="w-full text-left" onClick={() => setOpen(!open)}>
        <p className="font-medium">{sp.name}</p>
        <p className="text-xs text-zinc-500">
          {sp.topic || "Topic not set"}
          {at.length > 0 && ` · ${at.length} event${at.length === 1 ? "" : "s"}`}
          {sp.resources.length > 0 && ` · ${sp.resources.length} clip${sp.resources.length === 1 ? "" : "s"} and links`}
        </p>
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className={inputClass} value={sp.name} onChange={(e) => patchSpeaker(sp.id, { name: e.target.value })} /></Field>
            <Field label="Topic"><input className={inputClass} value={sp.topic} onChange={(e) => patchSpeaker(sp.id, { topic: e.target.value })} placeholder="Leadership, real estate…" /></Field>
            <Field label="Website">
              <div className="flex gap-2">
                <input className={inputClass} inputMode="url" value={sp.website} onChange={(e) => patchSpeaker(sp.id, { website: e.target.value })} onBlur={(e) => patchSpeaker(sp.id, { website: normalizeLink(e.target.value) })} />
                {sp.website && <a className={ghostButtonClass} href={sp.website} target="_blank" rel="noopener noreferrer">Open ↗</a>}
              </div>
            </Field>
            <Field label="Contact or booking"><input className={inputClass} value={sp.contact} onChange={(e) => patchSpeaker(sp.id, { contact: e.target.value })} placeholder="Agent, email or phone" /></Field>
          </div>
          <Field label="Notes">
            <textarea className={`${inputClass} min-h-24`} value={sp.notes} onChange={(e) => patchSpeaker(sp.id, { notes: e.target.value })} placeholder="Key ideas, quotes, why they matter to you" />
          </Field>
          <ResourceList resources={sp.resources} onChange={(resources) => patchSpeaker(sp.id, { resources })} doneLabel="Watched" dropHint="Drag in talks, video clips, books or links" />
          <button
            className="self-start text-xs text-zinc-400 hover:text-rose-600"
            onClick={() => {
              if (!confirm("Delete this speaker?")) return;
              deleteResourceFiles(sp.resources);
              store.set((d) => ({
                events: d.events.map((e) => ({ ...e, speakerIds: e.speakerIds.filter((x) => x !== sp.id) })),
                speakers: d.speakers.filter((x) => x.id !== sp.id),
              }));
            }}
          >
            Delete speaker
          </button>
        </div>
      )}
    </li>
  );
}

export function Events() {
  const data = store.use();
  const [tab, setTab] = useState<"events" | "speakers">("events");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (tab === "events") {
      store.set((d) => ({
        ...d,
        events: [...d.events, { id: newId(), name: name.trim(), date, time: "", location: "", url: "", status: "Interested", speakerIds: [], notes: "", resources: [] }],
      }));
    } else {
      store.set((d) => ({ ...d, speakers: [...d.speakers, { id: newId(), name: name.trim(), topic: "", website: "", contact: "", notes: "", resources: [] }] }));
    }
    setName("");
    setDate("");
  }

  const t = today();
  const upcoming = data.events.filter((e) => !e.date || e.date >= t).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const past = data.events.filter((e) => e.date && e.date < t).sort((a, b) => b.date.localeCompare(a.date));
  const speakers = [...data.speakers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 self-start rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
        {(["events", "speakers"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-md px-4 py-1.5 text-sm ${tab === k ? "bg-white font-medium text-brand shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {k === "events" ? `Events (${data.events.length})` : `Speakers (${data.speakers.length})`}
          </button>
        ))}
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="min-w-56 flex-1">
          <Field label={tab === "events" ? "New event" : "New speaker"}>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={tab === "events" ? "Leadership summit" : "Speaker's name"} />
          </Field>
        </div>
        {tab === "events" && (
          <div className="w-44">
            <Field label="Date"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
        )}
        <button className={buttonClass} disabled={!name.trim()}>{tab === "events" ? "Add event" : "Add speaker"}</button>
      </form>

      {tab === "events" ? (
        data.events.length === 0 ? (
          <p className="text-sm text-zinc-500">No events yet. Add conferences, talks, workshops and anything you want to attend or host.</p>
        ) : (
          <>
            <section>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Coming up</h2>
              {upcoming.length === 0 ? <p className="text-sm text-zinc-500">Nothing coming up.</p> : (
                <ul className="flex flex-col gap-3">{upcoming.map((e) => <EventCard key={e.id} ev={e} speakers={speakers} />)}</ul>
              )}
            </section>
            {past.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Past</h2>
                <ul className="flex flex-col gap-3 opacity-80">{past.map((e) => <EventCard key={e.id} ev={e} speakers={speakers} />)}</ul>
              </section>
            )}
          </>
        )
      ) : speakers.length === 0 ? (
        <p className="text-sm text-zinc-500">No speakers yet. Add people whose talks you follow or want to book.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">{speakers.map((s) => <SpeakerCard key={s.id} sp={s} events={data.events} />)}</ul>
      )}
    </div>
  );
}
