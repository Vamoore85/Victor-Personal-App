"use client";

import { useState, type FormEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { daysBetween, prettyDate, today } from "@/lib/dates";
import { ResourceList, deleteResourceFiles, normalizeLink, type Resource } from "@/components/Resources";
import { Bar, Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";

const KINDS = ["Vacation", "Business", "Family", "Weekend getaway", "Event / conference"] as const;
const STATUSES = ["Idea", "Planning", "Booked", "Done"] as const;
const BOOKING_TYPES = ["Flight", "Hotel", "Rental car", "Train", "Activity", "Restaurant", "Event tickets", "Other"] as const;

type Booking = {
  id: string;
  type: (typeof BOOKING_TYPES)[number];
  provider: string;
  confirmation: string;
  date: string;
  cost?: number;
  url: string;
};
type PackItem = { id: string; text: string; done: boolean };
type Trip = {
  id: string;
  name: string;
  destination: string;
  start: string;
  end: string;
  kind: (typeof KINDS)[number];
  status: (typeof STATUSES)[number];
  travelers: string;
  budget?: number;
  bookings: Booking[];
  packing: PackItem[];
  notes: string;
  resources: Resource[];
};
type Place = { id: string; name: string; why: string; visited: boolean };
type Data = { trips: Trip[]; places: Place[] };

const store = createLocalStore<Data>("maverick.travel.v1", { trips: [], places: [] }, (raw) => {
  const v = raw as Partial<Data> | null;
  return { trips: Array.isArray(v?.trips) ? v.trips : [], places: Array.isArray(v?.places) ? v.places : [] };
});

const patchTrip = (id: string, p: Partial<Trip>) => store.set((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && !isNaN(n) ? n : undefined;
};
const booked = (t: Trip) => t.bookings.reduce((s, b) => s + (b.cost ?? 0), 0);

const PACKING: Record<string, string[]> = {
  Basics: ["ID / driver's license", "Phone charger", "Wallet and cards", "Toiletries", "Medications", "Headphones", "Sleepwear"],
  Flying: ["Boarding pass", "Passport (international)", "Neck pillow", "Snacks", "Empty water bottle"],
  Business: ["Laptop and charger", "Business cards", "Suit / blazer", "Dress shoes", "Presentation on a thumb drive", "Notebook"],
  Beach: ["Swimsuit", "Sunscreen", "Sunglasses", "Sandals", "Hat", "Beach towel"],
  Cold: ["Winter coat", "Gloves", "Beanie", "Thermal layers", "Boots"],
  Workout: ["Gym clothes", "Running shoes", "Resistance bands"],
};

function tripDates(t: Trip) {
  if (!t.start) return "Dates not set";
  const s = prettyDate(t.start, { month: "short", day: "numeric", year: "numeric" });
  if (!t.end || t.end === t.start) return s;
  return `${s} – ${prettyDate(t.end, { month: "short", day: "numeric", year: t.end.slice(0, 4) !== t.start.slice(0, 4) ? "numeric" : undefined })} · ${daysBetween(t.start, t.end) + 1} days`;
}

function countdown(t: Trip) {
  if (!t.start) return "";
  const days = daysBetween(today(), t.start);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today";
  if (t.end && t.end >= today()) return "happening now";
  return "";
}

const STATUS_STYLE: Record<Trip["status"], string> = {
  Idea: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  Planning: "bg-ember/15 text-brand",
  Booked: "bg-brand text-on-brand",
  Done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

function Bookings({ trip }: { trip: Trip }) {
  const [type, setType] = useState<Booking["type"]>("Flight");
  const [provider, setProvider] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [picked, setDate] = useState("");
  const date = picked || trip.start;
  const [cost, setCost] = useState("");
  const [url, setUrl] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!provider.trim()) return;
    const b: Booking = { id: newId(), type, provider: provider.trim(), confirmation: confirmation.trim(), date, cost: money(cost), url: normalizeLink(url) };
    patchTrip(trip.id, { bookings: [...trip.bookings, b].sort((a, z) => (a.date || "9").localeCompare(z.date || "9")) });
    setProvider("");
    setConfirmation("");
    setCost("");
    setUrl("");
    setDate("");
  }

  return (
    <div className="flex flex-col gap-3">
      {trip.bookings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 font-normal">Type</th>
                <th className="py-1 font-normal">With</th>
                <th className="py-1 font-normal">Date</th>
                <th className="py-1 font-normal">Confirmation</th>
                <th className="py-1 text-right font-normal">Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trip.bookings.map((b) => (
                <tr key={b.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-2 pr-3">{b.type}</td>
                  <td className="pr-3">
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-brand">
                        {b.provider} ↗
                      </a>
                    ) : (
                      b.provider
                    )}
                  </td>
                  <td className="whitespace-nowrap pr-3">{b.date ? prettyDate(b.date, { month: "short", day: "numeric" }) : "–"}</td>
                  <td className="pr-3 font-mono text-xs">{b.confirmation || "–"}</td>
                  <td className="text-right tabular-nums">{b.cost !== undefined ? usd(b.cost) : "–"}</td>
                  <td className="pl-3 text-right">
                    <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => patchTrip(trip.id, { bookings: trip.bookings.filter((x) => x.id !== b.id) })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={add} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[8rem_1fr_9rem_1fr_6rem_1fr_auto]">
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as Booking["type"])} aria-label="Booking type">
          {BOOKING_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Delta, Marriott…" aria-label="Airline, hotel or company" />
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Booking date" />
        <input className={inputClass} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Confirmation #" aria-label="Confirmation number" />
        <input className={inputClass} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Cost" aria-label="Cost" />
        <input className={inputClass} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link to booking" aria-label="Link to booking" />
        <button className={buttonClass} disabled={!provider.trim()}>Add</button>
      </form>
    </div>
  );
}

function Packing({ trip }: { trip: Trip }) {
  const [text, setText] = useState("");
  const add = (items: string[]) => {
    const have = new Set(trip.packing.map((p) => p.text.toLowerCase()));
    const fresh = items.filter((i) => i.trim() && !have.has(i.trim().toLowerCase())).map((i) => ({ id: newId(), text: i.trim(), done: false }));
    if (fresh.length) patchTrip(trip.id, { packing: [...trip.packing, ...fresh] });
  };
  const packed = trip.packing.filter((p) => p.done).length;
  return (
    <div className="flex flex-col gap-3">
      {trip.packing.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <Bar value={packed} max={trip.packing.length} />
            <span className="shrink-0 tabular-nums">
              {packed} of {trip.packing.length} packed
            </span>
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {trip.packing.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={p.done}
                    onChange={(e) => patchTrip(trip.id, { packing: trip.packing.map((x) => (x.id === p.id ? { ...x, done: e.target.checked } : x)) })}
                  />
                  <span className={p.done ? "text-zinc-400 line-through" : ""}>{p.text}</span>
                </label>
                <button className="text-xs text-zinc-300 hover:text-rose-600 dark:text-zinc-600" onClick={() => patchTrip(trip.id, { packing: trip.packing.filter((x) => x.id !== p.id) })} aria-label={`Remove ${p.text}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add([text]);
          setText("");
        }}
        className="flex gap-2"
      >
        <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something to pack" />
        <button className={ghostButtonClass} disabled={!text.trim()}>Add</button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">Add a starter list:</span>
        {Object.keys(PACKING).map((k) => (
          <button key={k} className="rounded-full border border-zinc-300 px-3 py-1 hover:border-ember dark:border-zinc-700" onClick={() => add(PACKING[k])}>
            + {k}
          </button>
        ))}
      </div>
    </div>
  );
}

function TripView({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const spent = booked(trip);
  const [budget, setBudget] = useState(trip.budget === undefined ? "" : String(trip.budget));
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-ember p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <input className="w-full bg-transparent text-xl font-semibold outline-none" value={trip.name} onChange={(e) => patchTrip(trip.id, { name: e.target.value })} aria-label="Trip name" />
          <p className="text-sm text-zinc-500">
            {tripDates(trip)}
            {countdown(trip) && ` · ${countdown(trip)}`}
          </p>
        </div>
        <button className="shrink-0 text-sm text-zinc-500 hover:text-brand" onClick={onClose}>Close</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2">
          <Field label="Where">
            <input className={inputClass} value={trip.destination} onChange={(e) => patchTrip(trip.id, { destination: e.target.value })} placeholder="Miami, FL" />
          </Field>
        </div>
        <Field label="Leave">
          <input type="date" className={inputClass} value={trip.start} onChange={(e) => patchTrip(trip.id, { start: e.target.value, end: trip.end && trip.end < e.target.value ? e.target.value : trip.end })} />
        </Field>
        <Field label="Return">
          <input type="date" className={inputClass} value={trip.end} min={trip.start} onChange={(e) => patchTrip(trip.id, { end: e.target.value })} />
        </Field>
        <Field label="Kind of trip">
          <select className={inputClass} value={trip.kind} onChange={(e) => patchTrip(trip.id, { kind: e.target.value as Trip["kind"] })}>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputClass} value={trip.status} onChange={(e) => patchTrip(trip.id, { status: e.target.value as Trip["status"] })}>
            {STATUSES.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Who's going">
          <input className={inputClass} value={trip.travelers} onChange={(e) => patchTrip(trip.id, { travelers: e.target.value })} placeholder="Me, kids" />
        </Field>
        <Field label="Budget">
          <input
            className={inputClass}
            inputMode="decimal"
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              patchTrip(trip.id, { budget: money(e.target.value) });
            }}
            placeholder="0.00"
          />
        </Field>
      </div>

      {(trip.budget !== undefined || spent > 0) && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span>Booked so far</span>
            <span className="tabular-nums">
              {usd(spent)}
              {trip.budget !== undefined && ` of ${usd(trip.budget)}`}
            </span>
          </div>
          {trip.budget !== undefined && <Bar value={spent} max={trip.budget} over={spent > trip.budget} />}
          {trip.budget !== undefined && (
            <p className="text-xs text-zinc-500">{spent > trip.budget ? `${usd(spent - trip.budget)} over budget` : `${usd(trip.budget - spent)} left for food, fun and extras`}</p>
          )}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Flights, hotels and bookings</p>
        <Bookings trip={trip} />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Packing list</p>
        <Packing trip={trip} />
      </div>
      <Field label="Plans and notes">
        <textarea className={`${inputClass} min-h-28`} value={trip.notes} onChange={(e) => patchTrip(trip.id, { notes: e.target.value })} placeholder="Things to do, places to eat, who to see" />
      </Field>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Tickets, itineraries and inspiration</p>
        <ResourceList resources={trip.resources} onChange={(resources) => patchTrip(trip.id, { resources })} doneLabel="Done" dropHint="Drag in boarding passes, itineraries, photos or travel videos" />
      </div>
      <button
        className="self-start text-xs text-zinc-400 hover:text-rose-600"
        onClick={() => {
          if (!confirm(`Delete ${trip.name} and its files?`)) return;
          deleteResourceFiles(trip.resources);
          store.set((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== trip.id) }));
          onClose();
        }}
      >
        Delete trip
      </button>
    </section>
  );
}

function TripCard({ trip, active, onOpen }: { trip: Trip; active: boolean; onOpen: () => void }) {
  const cd = countdown(trip);
  return (
    <li>
      <button onClick={onOpen} className={`flex h-full w-full flex-col gap-1 rounded-xl border p-4 text-left hover:border-ember ${active ? "border-ember" : "border-zinc-200 dark:border-zinc-800"}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="font-medium">{trip.name}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[trip.status]}`}>{trip.status}</span>
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{[trip.destination, trip.kind].filter(Boolean).join(" · ")}</span>
        <span className="text-xs text-zinc-500">
          {tripDates(trip)}
          {cd && <span className="font-medium text-brand"> · {cd}</span>}
        </span>
        {(trip.bookings.length > 0 || trip.budget !== undefined) && (
          <span className="mt-auto pt-1 text-xs text-zinc-500">
            {trip.bookings.length} booking{trip.bookings.length === 1 ? "" : "s"} · {usd(booked(trip))}
            {trip.budget !== undefined && ` of ${usd(trip.budget)}`}
          </span>
        )}
      </button>
    </li>
  );
}

function Places({ data, onPlan }: { data: Data; onPlan: (tripId: string) => void }) {
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  return (
    <Card title="Places I want to go">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          store.set((d) => ({ ...d, places: [...d.places, { id: newId(), name: name.trim(), why: why.trim(), visited: false }] }));
          setName("");
          setWhy("");
        }}
        className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
      >
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Place" aria-label="Place" />
        <input className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why (food, beach, family, a game, a conference)" aria-label="Why" />
        <button className={buttonClass} disabled={!name.trim()}>Add</button>
      </form>
      {data.places.length === 0 ? (
        <div className="mt-4">
          <Empty>Your bucket list is empty.</Empty>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {[...data.places].sort((a, b) => Number(a.visited) - Number(b.visited)).map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={p.visited}
                onChange={(e) => store.set((d) => ({ ...d, places: d.places.map((x) => (x.id === p.id ? { ...x, visited: e.target.checked } : x)) }))}
                aria-label="Been there"
                title="Been there"
              />
              <span className={`min-w-0 flex-1 ${p.visited ? "text-zinc-400 line-through" : ""}`}>
                <span className="font-medium">{p.name}</span>
                {p.why && <span className="text-zinc-500"> · {p.why}</span>}
              </span>
              {!p.visited && (
                <button
                  className="text-xs text-brand"
                  onClick={() => {
                    const id = newId();
                    store.set((d) => ({ ...d, trips: [newTrip(id, `Trip to ${p.name}`, p.name), ...d.trips] }));
                    onPlan(id);
                  }}
                >
                  Plan a trip
                </button>
              )}
              <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => store.set((d) => ({ ...d, places: d.places.filter((x) => x.id !== p.id) }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function newTrip(id: string, name: string, destination = ""): Trip {
  return { id, name, destination, start: "", end: "", kind: "Vacation", status: "Idea", travelers: "", bookings: [], packing: [], notes: "", resources: [] };
}

export function Travel() {
  const data = store.use();
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"Trips" | "Bucket list">("Trips");

  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    store.set((d) => ({ ...d, trips: [newTrip(id, name.trim()), ...d.trips] }));
    setName("");
    setOpenId(id);
  }

  const t0 = today();
  const isPast = (t: Trip) => t.status === "Done" || (!!t.end && t.end < t0) || (!t.end && !!t.start && t.start < t0);
  const upcoming = data.trips.filter((t) => !isPast(t) && t.start).sort((a, b) => a.start.localeCompare(b.start));
  const ideas = data.trips.filter((t) => !isPast(t) && !t.start);
  const past = data.trips.filter(isPast).sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  const next = upcoming[0];
  const year = t0.slice(0, 4);
  const thisYear = data.trips.filter((t) => t.start.startsWith(year));
  const open = data.trips.find((t) => t.id === openId);

  const list = (title: string, trips: Trip[]) =>
    trips.length > 0 && (
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} active={t.id === openId} onOpen={() => setOpenId(t.id)} />
          ))}
        </ul>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="col-span-2 rounded-xl border border-zinc-200 p-4 lg:col-span-1 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Next trip</p>
          {next ? (
            <button className="mt-1 text-left" onClick={() => setOpenId(next.id)}>
              <span className="block text-2xl font-semibold">{next.destination || next.name}</span>
              <span className="text-sm text-brand">{countdown(next)}</span>
            </button>
          ) : (
            <p className="mt-1 text-2xl font-semibold">–</p>
          )}
        </div>
        <Stat label={`Trips in ${year}`} value={String(thisYear.length)} />
        <Stat label={`Booked in ${year}`} value={usd(thisYear.reduce((s, t) => s + booked(t), 0))} />
      </div>

      <nav className="flex gap-2">
        {(["Trips", "Bucket list"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? buttonClass : ghostButtonClass}>
            {t}
          </button>
        ))}
      </nav>

      {tab === "Bucket list" ? (
        <Places
          data={data}
          onPlan={(id) => {
            setTab("Trips");
            setOpenId(id);
          }}
        />
      ) : (
        <>
          <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="min-w-56 flex-1">
              <Field label="New trip or vacation">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer in Miami" />
              </Field>
            </div>
            <button className={buttonClass} disabled={!name.trim()}>Add trip</button>
          </form>
          {open && <TripView key={open.id} trip={open} onClose={() => setOpenId(null)} />}
          {data.trips.length === 0 && <Empty>No trips yet. Add one above, or start from your bucket list.</Empty>}
          {list("Coming up", upcoming)}
          {list("Ideas, no dates yet", ideas)}
          {list("Past trips", past)}
        </>
      )}
    </div>
  );
}
