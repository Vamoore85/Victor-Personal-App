"use client";

import { useState, type FormEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { addDays, daysBetween, prettyDate, today } from "@/lib/dates";
import { Bar, Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";

type DayLog = { date: string; weight?: number; sleep?: number; steps?: number; water?: number; notes?: string };
type Workout = { id: string; date: string; type: string; minutes: number; notes: string };
type Habit = { id: string; name: string; done: string[] };
type Goals = { weight?: number; sleep: number; workoutsPerWeek: number };
type Data = { logs: DayLog[]; workouts: Workout[]; habits: Habit[]; goals: Goals };

const EMPTY: Data = { logs: [], workouts: [], habits: [], goals: { sleep: 7, workoutsPerWeek: 3 } };

const store = createLocalStore<Data>("maverick.health.v1", EMPTY, (raw) => {
  const v = raw as Partial<Data> | null;
  return {
    logs: Array.isArray(v?.logs) ? v.logs : [],
    workouts: Array.isArray(v?.workouts) ? v.workouts : [],
    habits: Array.isArray(v?.habits) ? v.habits : [],
    goals: { ...EMPTY.goals, ...(v?.goals ?? {}) },
  };
});

const WORKOUT_TYPES = ["Weights", "Run", "Walk", "Bike", "Swim", "HIIT", "Yoga / stretch", "Sports", "Boxing", "Other"];
const HABIT_STARTERS = ["Drink 8 glasses of water", "No sugar", "Read 20 minutes", "Stretch", "Take vitamins", "In bed by 11"];

const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? undefined : Number(s));
const show = (n: number | undefined) => (n === undefined ? "" : String(n));

/** Number box that keeps what you type (like "185.") and saves the parsed number. */
function NumInput({ value, onChange, placeholder, decimal }: { value?: number; onChange: (n: number | undefined) => void; placeholder?: string; decimal?: boolean }) {
  const [text, setText] = useState(show(value));
  return (
    <input
      className={inputClass}
      inputMode={decimal ? "decimal" : "numeric"}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(num(e.target.value));
      }}
      onBlur={() => setText(show(value))}
    />
  );
}

function setLog(date: string, patch: Partial<DayLog>) {
  store.set((d) => {
    const existing = d.logs.find((l) => l.date === date);
    const next = { ...(existing ?? { date }), ...patch };
    const logs = existing ? d.logs.map((l) => (l.date === date ? next : l)) : [...d.logs, next];
    return { ...d, logs: logs.sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

function toggleHabit(id: string, date: string) {
  store.set((d) => ({
    ...d,
    habits: d.habits.map((h) =>
      h.id !== id ? h : { ...h, done: h.done.includes(date) ? h.done.filter((x) => x !== date) : [...h.done, date] },
    ),
  }));
}

/** Days in a row the habit was done, ending today (or yesterday, if today isn't checked yet). */
function streak(h: Habit) {
  const set = new Set(h.done);
  let day = set.has(today()) ? today() : addDays(today(), -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Monday of the week containing this date. */
function weekStart(ymd: string) {
  const dow = (new Date(ymd + "T00:00:00").getDay() + 6) % 7;
  return addDays(ymd, -dow);
}

function weightOn(logs: DayLog[], onOrBefore: string) {
  const w = logs.filter((l) => l.weight !== undefined && l.date <= onOrBefore);
  return w.length ? w[w.length - 1] : undefined;
}

function WeightChart({ logs, goal }: { logs: DayLog[]; goal?: number }) {
  const from = addDays(today(), -89);
  const pts = logs.filter((l) => l.weight !== undefined && l.date >= from);
  if (pts.length < 2) return <Empty>Log your weight on two or more days to see the trend.</Empty>;
  const values = pts.map((p) => p.weight!).concat(goal ? [goal] : []);
  const lo = Math.floor(Math.min(...values) - 2);
  const hi = Math.ceil(Math.max(...values) + 2);
  const W = 600;
  const H = 180;
  const L = 36;
  const span = Math.max(1, daysBetween(pts[0].date, pts[pts.length - 1].date));
  const x = (date: string) => L + (daysBetween(pts[0].date, date) / span) * (W - L - 8);
  const y = (w: number) => 8 + ((hi - w) / (hi - lo)) * (H - 28);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.weight!).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weight over the last 90 days">
      {[hi, (hi + lo) / 2, lo].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} className="stroke-zinc-200 dark:stroke-zinc-800" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {goal !== undefined && goal >= lo && goal <= hi && (
        <g>
          <line x1={L} x2={W - 8} y1={y(goal)} y2={y(goal)} strokeDasharray="4 4" className="stroke-emerald-500" />
          <text x={W - 10} y={y(goal) - 4} textAnchor="end" className="fill-emerald-600 text-[11px] dark:fill-emerald-400">
            Goal {goal}
          </text>
        </g>
      )}
      <path d={path} fill="none" strokeWidth={2.5} className="stroke-ember" />
      {pts.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.weight!)} r={3} className="fill-brand" />
      ))}
      <text x={L} y={H - 4} className="fill-zinc-500 text-[11px]">
        {prettyDate(pts[0].date, { month: "short", day: "numeric" })}
      </text>
      <text x={W - 8} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
        {prettyDate(pts[pts.length - 1].date, { month: "short", day: "numeric" })}
      </text>
    </svg>
  );
}

function CheckIn({ data, date, setDate }: { data: Data; date: string; setDate: (d: string) => void }) {
  const log = data.logs.find((l) => l.date === date) ?? { date };
  const [type, setType] = useState(WORKOUT_TYPES[0]);
  const [minutes, setMinutes] = useState("");
  const [wNotes, setWNotes] = useState("");
  const dayWorkouts = data.workouts.filter((w) => w.date === date);

  function addWorkout(e: FormEvent) {
    e.preventDefault();
    const m = num(minutes);
    if (!m) return;
    store.set((d) => ({ ...d, workouts: [...d.workouts, { id: newId(), date, type, minutes: m, notes: wNotes.trim() }] }));
    setMinutes("");
    setWNotes("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title="Daily check-in"
        action={<input type="date" className={`${inputClass} w-auto`} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Weight (lb)">
            <NumInput key={date} decimal value={log.weight} onChange={(n) => setLog(date, { weight: n })} placeholder="185" />
          </Field>
          <Field label="Sleep (hours)">
            <NumInput key={date} decimal value={log.sleep} onChange={(n) => setLog(date, { sleep: n })} placeholder="7.5" />
          </Field>
          <Field label="Steps">
            <NumInput key={date} value={log.steps} onChange={(n) => setLog(date, { steps: n })} placeholder="8000" />
          </Field>
          <Field label="Water (glasses)">
            <NumInput key={date} value={log.water} onChange={(n) => setLog(date, { water: n })} placeholder="8" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="How I feel / notes">
            <textarea className={`${inputClass} min-h-20`} value={log.notes ?? ""} onChange={(e) => setLog(date, { notes: e.target.value })} placeholder="Energy, soreness, meals, anything" />
          </Field>
        </div>
        {data.habits.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Habits</p>
            <ul className="flex flex-col gap-1.5">
              {data.habits.map((h) => (
                <li key={h.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={h.done.includes(date)} onChange={() => toggleHabit(h.id, date)} />
                    {h.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title={`Workouts · ${prettyDate(date, { weekday: "long", month: "short", day: "numeric" })}`}>
        <form onSubmit={addWorkout} className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_6rem_auto]">
          <Field label="Type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {WORKOUT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Minutes">
            <input className={inputClass} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="45" />
          </Field>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <button className={buttonClass} disabled={!num(minutes)}>Log workout</button>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <input className={inputClass} value={wNotes} onChange={(e) => setWNotes(e.target.value)} placeholder="Notes (sets, distance, how it went)" />
          </div>
        </form>
        <ul className="mt-4 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {dayWorkouts.length === 0 && <Empty>No workout logged for this day.</Empty>}
          {dayWorkouts.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{w.type}</span> · {w.minutes} min
                {w.notes && <span className="block text-xs text-zinc-500">{w.notes}</span>}
              </span>
              <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => store.set((d) => ({ ...d, workouts: d.workouts.filter((x) => x.id !== w.id) }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Habits({ data }: { data: Data }) {
  const [name, setName] = useState("");
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const add = (n: string) => {
    if (!n.trim() || data.habits.some((h) => h.name.toLowerCase() === n.trim().toLowerCase())) return;
    store.set((d) => ({ ...d, habits: [...d.habits, { id: newId(), name: n.trim(), done: [] }] }));
  };
  return (
    <Card title="Habits">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(name);
          setName("");
        }}
        className="flex gap-2"
      >
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="New habit, like 10 minutes of stretching" />
        <button className={buttonClass} disabled={!name.trim()}>Add</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {HABIT_STARTERS.filter((s) => !data.habits.some((h) => h.name === s)).map((s) => (
          <button key={s} className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:border-ember dark:border-zinc-700" onClick={() => add(s)}>
            + {s}
          </button>
        ))}
      </div>
      {data.habits.length === 0 ? (
        <div className="mt-4">
          <Empty>No habits yet. Add one above, then check it off each day.</Empty>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="py-1 text-left font-normal">Habit</th>
                {days.map((d) => (
                  <th key={d} className="w-10 py-1 font-normal">
                    {prettyDate(d, { weekday: "narrow" })}
                    <span className="block">{Number(d.slice(8))}</span>
                  </th>
                ))}
                <th className="py-1 text-right font-normal">Streak</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.habits.map((h) => (
                <tr key={h.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-2 pr-3">{h.name}</td>
                  {days.map((d) => (
                    <td key={d} className="text-center">
                      <button
                        onClick={() => toggleHabit(h.id, d)}
                        aria-label={`${h.name} on ${d}`}
                        className={`h-6 w-6 rounded-md border ${h.done.includes(d) ? "border-ember bg-ember text-on-brand" : "border-zinc-300 dark:border-zinc-700"}`}
                      >
                        {h.done.includes(d) ? "✓" : ""}
                      </button>
                    </td>
                  ))}
                  <td className="text-right tabular-nums">{streak(h)} 🔥</td>
                  <td className="pl-3 text-right">
                    <button
                      className="text-xs text-zinc-400 hover:text-rose-600"
                      onClick={() => confirm(`Delete "${h.name}"?`) && store.set((d) => ({ ...d, habits: d.habits.filter((x) => x.id !== h.id) }))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Trends({ data }: { data: Data }) {
  const recent = [...data.logs].reverse().slice(0, 30);
  return (
    <div className="flex flex-col gap-6">
      <Card title="Weight, last 90 days">
        <WeightChart logs={data.logs} goal={data.goals.weight} />
      </Card>
      <Card title="Goals">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Goal weight (lb)">
            <NumInput decimal value={data.goals.weight} onChange={(n) => store.set((d) => ({ ...d, goals: { ...d.goals, weight: n } }))} placeholder="175" />
          </Field>
          <Field label="Sleep goal (hours)">
            <NumInput decimal value={data.goals.sleep} onChange={(n) => n && store.set((d) => ({ ...d, goals: { ...d.goals, sleep: n } }))} />
          </Field>
          <Field label="Workouts per week">
            <NumInput value={data.goals.workoutsPerWeek} onChange={(n) => n && store.set((d) => ({ ...d, goals: { ...d.goals, workoutsPerWeek: n } }))} />
          </Field>
        </div>
      </Card>
      <Card title="Recent days">
        {recent.length === 0 ? (
          <Empty>Nothing logged yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 font-normal">Day</th>
                  <th className="py-1 font-normal">Weight</th>
                  <th className="py-1 font-normal">Sleep</th>
                  <th className="py-1 font-normal">Steps</th>
                  <th className="py-1 font-normal">Water</th>
                  <th className="py-1 font-normal">Workouts</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((l) => {
                  const ws = data.workouts.filter((w) => w.date === l.date);
                  return (
                    <tr key={l.date} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-2">{prettyDate(l.date, { weekday: "short", month: "short", day: "numeric" })}</td>
                      <td>{l.weight ?? "–"}</td>
                      <td>{l.sleep !== undefined ? `${l.sleep} h` : "–"}</td>
                      <td>{l.steps?.toLocaleString() ?? "–"}</td>
                      <td>{l.water ?? "–"}</td>
                      <td>{ws.length ? ws.map((w) => `${w.type} ${w.minutes}m`).join(", ") : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const TABS = ["Today", "Habits", "Trends"] as const;

export function Health() {
  const data = store.use();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Today");
  const [picked, setDate] = useState<string | null>(null);
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  const date = picked ?? today();

  const latest = weightOn(data.logs, today());
  const monthAgo = weightOn(data.logs, addDays(today(), -30));
  const change = latest && monthAgo && latest.date !== monthAgo.date ? latest.weight! - monthAgo.weight! : undefined;
  const sleeps = data.logs.filter((l) => l.sleep !== undefined && l.date > addDays(today(), -7));
  const avgSleep = sleeps.length ? sleeps.reduce((s, l) => s + l.sleep!, 0) / sleeps.length : undefined;
  const week = weekStart(today());
  const weekWorkouts = data.workouts.filter((w) => w.date >= week);
  const weekMinutes = weekWorkouts.reduce((s, w) => s + w.minutes, 0);
  const sessionsThisWeek = new Set(weekWorkouts.map((w) => w.date)).size;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Weight" value={latest ? `${latest.weight} lb` : "–"} />
        <Stat
          label="Last 30 days"
          value={change === undefined ? "–" : `${change > 0 ? "+" : ""}${change.toFixed(1)} lb`}
          tone={change === undefined || data.goals.weight === undefined || !latest ? undefined : Math.sign(change) === Math.sign(data.goals.weight - latest.weight!) ? "good" : "bad"}
        />
        <Stat label="Avg sleep, 7 days" value={avgSleep === undefined ? "–" : `${avgSleep.toFixed(1)} h`} tone={avgSleep === undefined ? undefined : avgSleep >= data.goals.sleep ? "good" : "bad"} />
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Workout days this week</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {sessionsThisWeek}
            <span className="text-base text-zinc-500"> / {data.goals.workoutsPerWeek}</span>
          </p>
          <div className="mt-2">
            <Bar value={sessionsThisWeek} max={data.goals.workoutsPerWeek} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{weekMinutes} minutes</p>
        </div>
      </div>
      {latest && data.goals.weight !== undefined && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {Math.abs(latest.weight! - data.goals.weight) < 0.5
            ? "You're at your goal weight."
            : `${Math.abs(latest.weight! - data.goals.weight).toFixed(1)} lb to go to your goal of ${data.goals.weight} lb.`}
        </p>
      )}

      <nav className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? buttonClass : ghostButtonClass}>
            {t}
          </button>
        ))}
      </nav>

      {tab === "Today" && <CheckIn data={data} date={date} setDate={setDate} />}
      {tab === "Habits" && <Habits data={data} />}
      {tab === "Trends" && <Trends data={data} />}
    </div>
  );
}
