"use client";

import { useState, type FormEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { ResourceList, deleteResourceFiles, type Resource } from "@/components/Resources";
import { Bar, Field, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";

const AREAS = ["Wealth", "Business", "Health", "Mind", "Skills", "Family", "Spirit", "Other"];

type Step = { id: string; text: string; done: boolean };
type Goal = {
  id: string;
  title: string;
  area: string;
  why: string;
  targetDate: string;
  done: boolean;
  steps: Step[];
  resources: Resource[];
  createdAt: string;
};

const store = createLocalStore<{ goals: Goal[] }>("maverick.invest.v1", { goals: [] }, (raw) => {
  const v = raw as { goals?: Goal[] } | null;
  return { goals: Array.isArray(v?.goals) ? v.goals : [] };
});

const patchGoal = (id: string, p: Partial<Goal>) =>
  store.set((d) => ({ goals: d.goals.map((g) => (g.id === id ? { ...g, ...p } : g)) }));

function GoalCard({ goal }: { goal: Goal }) {
  const [step, setStep] = useState("");
  const total = goal.steps.length + goal.resources.length;
  const finished = goal.steps.filter((s) => s.done).length + goal.resources.filter((r) => r.done).length;
  const days = goal.targetDate
    ? Math.round((new Date(goal.targetDate + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
    : null;

  function addStep(e: FormEvent) {
    e.preventDefault();
    if (!step.trim()) return;
    patchGoal(goal.id, { steps: [...goal.steps, { id: newId(), text: step.trim(), done: false }] });
    setStep("");
  }

  return (
    <section className={`flex flex-col gap-4 rounded-xl border p-5 ${goal.done ? "border-emerald-500/50" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-brand">{goal.area}</p>
          <input
            className={`mt-1 w-full bg-transparent text-lg font-semibold outline-none ${goal.done ? "line-through opacity-60" : ""}`}
            value={goal.title}
            onChange={(e) => patchGoal(goal.id, { title: e.target.value })}
            aria-label="Goal"
          />
          <p className="text-xs text-zinc-500">
            {goal.targetDate
              ? `Target ${new Date(goal.targetDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${
                  days !== null && !goal.done ? (days >= 0 ? ` · ${days} days left` : ` · ${-days} days past`) : ""
                }`
              : "No target date"}
          </p>
        </div>
        <div className="flex shrink-0 gap-3 text-xs">
          <button className="text-brand" onClick={() => patchGoal(goal.id, { done: !goal.done })}>
            {goal.done ? "Reopen" : "Mark achieved"}
          </button>
          <button
            className="text-zinc-400 hover:text-rose-600"
            onClick={() => {
              if (!confirm("Delete this goal and its files?")) return;
              deleteResourceFiles(goal.resources);
              store.set((d) => ({ goals: d.goals.filter((g) => g.id !== goal.id) }));
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1"><Bar value={finished} max={total} /></div>
          <span className="text-xs tabular-nums text-zinc-500">{finished} of {total} done</span>
        </div>
      )}

      <Field label="Why this matters">
        <textarea
          className={`${inputClass} min-h-16`}
          value={goal.why}
          onChange={(e) => patchGoal(goal.id, { why: e.target.value })}
          placeholder="What changes when you reach this?"
        />
      </Field>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Steps</p>
        <ul className="flex flex-col gap-1.5">
          {goal.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.done}
                onChange={(e) => patchGoal(goal.id, { steps: goal.steps.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)) })}
              />
              <span className={`flex-1 ${s.done ? "text-zinc-400 line-through" : ""}`}>{s.text}</span>
              <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => patchGoal(goal.id, { steps: goal.steps.filter((x) => x.id !== s.id) })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addStep} className="mt-2 flex gap-2">
          <input className={inputClass} value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" />
          <button className={ghostButtonClass} disabled={!step.trim()}>Add</button>
        </form>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Books, clips and links</p>
        <ResourceList
          resources={goal.resources}
          onChange={(resources) => patchGoal(goal.id, { resources })}
          doneLabel="Read or watched"
          dropHint="Drag books, video clips, PDFs or images onto this goal"
        />
      </div>
    </section>
  );
}

export function Invest() {
  const data = store.use();
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("Wealth");
  const [targetDate, setTargetDate] = useState("");
  const [filter, setFilter] = useState("All");

  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    store.set((d) => ({
      goals: [
        { id: newId(), title: title.trim(), area, why: "", targetDate, done: false, steps: [], resources: [], createdAt: new Date().toISOString() },
        ...d.goals,
      ],
    }));
    setTitle("");
    setTargetDate("");
  }

  const areasInUse = AREAS.filter((a) => data.goals.some((g) => g.area === a));
  const shown = data.goals
    .filter((g) => filter === "All" || g.area === filter)
    .sort((a, b) => Number(a.done) - Number(b.done));
  const achieved = data.goals.filter((g) => g.done).length;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="grid gap-3 rounded-xl border border-zinc-200 p-5 sm:grid-cols-[1fr_10rem_11rem_auto] sm:items-end dark:border-zinc-800">
        <Field label="New goal">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Read 12 business books this year" />
        </Field>
        <Field label="Area">
          <select className={inputClass} value={area} onChange={(e) => setArea(e.target.value)}>
            {AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Target date">
          <input type="date" className={inputClass} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
        <button className={buttonClass} disabled={!title.trim()}>Add goal</button>
      </form>

      {data.goals.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {["All", ...areasInUse].map((a) => (
            <button
              key={a}
              onClick={() => setFilter(a)}
              className={`rounded-full border px-3 py-1 text-xs ${filter === a ? "border-brand bg-brand text-on-brand" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              {a}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-500">
            {data.goals.length} goal{data.goals.length === 1 ? "" : "s"} · {achieved} achieved
          </span>
        </div>
      )}

      {data.goals.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Add your first goal above. Then drag in the books, video clips and links that will get you there.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {shown.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      )}
    </div>
  );
}
