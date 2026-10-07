"use client";

import { useState, type FormEvent } from "react";
import { createLocalStore, newId } from "@/lib/local-store";
import { prettyDate, today } from "@/lib/dates";
import { deleteFile, type StoredFile } from "@/lib/files";
import { Photo, PhotoPicker } from "@/components/Photo";
import { normalizeLink } from "@/components/Resources";
import { Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";

const CATEGORIES = ["Tops", "Shirts", "Pants", "Suits & blazers", "Outerwear", "Shoes", "Activewear", "Accessories", "Watches & jewelry", "Other"];
const OCCASIONS = ["Everyday", "Work", "Business meeting", "Speaking / stage", "Date night", "Formal", "Workout", "Travel"];
const SIZE_FIELDS = ["Shirt", "Dress shirt (neck / sleeve)", "Pants (waist x inseam)", "Suit jacket", "Shoes", "Hat", "Belt", "Ring", "Watch band"];
const PRIORITIES = ["Need", "Want", "Someday"] as const;

type Item = {
  id: string;
  name: string;
  category: string;
  color: string;
  brand: string;
  size: string;
  cost?: number;
  photo?: StoredFile;
  worn: string[];
  notes: string;
};
type Outfit = { id: string; name: string; occasion: string; itemIds: string[]; photo?: StoredFile; worn: string[]; notes: string };
type Wish = { id: string; name: string; url: string; price?: number; priority: (typeof PRIORITIES)[number]; bought: boolean };
type Data = { items: Item[]; outfits: Outfit[]; wishlist: Wish[]; sizes: Record<string, string> };

const store = createLocalStore<Data>("maverick.style.v1", { items: [], outfits: [], wishlist: [], sizes: {} }, (raw) => {
  const v = raw as Partial<Data> | null;
  return {
    items: Array.isArray(v?.items) ? v.items : [],
    outfits: Array.isArray(v?.outfits) ? v.outfits : [],
    wishlist: Array.isArray(v?.wishlist) ? v.wishlist : [],
    sizes: v?.sizes && typeof v.sizes === "object" ? v.sizes : {},
  };
});

const patchItem = (id: string, p: Partial<Item>) => store.set((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
const patchOutfit = (id: string, p: Partial<Outfit>) => store.set((d) => ({ ...d, outfits: d.outfits.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && !isNaN(n) ? n : undefined;
};
const lastWorn = (worn: string[]) => (worn.length ? [...worn].sort().at(-1)! : "");

function markWorn(worn: string[]) {
  return worn.includes(today()) ? worn : [...worn, today()];
}

/** Wearing an outfit counts as wearing each piece in it. */
function wearOutfit(o: Outfit) {
  store.set((d) => ({
    ...d,
    outfits: d.outfits.map((x) => (x.id === o.id ? { ...x, worn: markWorn(x.worn) } : x)),
    items: d.items.map((i) => (o.itemIds.includes(i.id) ? { ...i, worn: markWorn(i.worn) } : i)),
  }));
}

function ItemCard({ item, open, onToggle }: { item: Item; open: boolean; onToggle: () => void }) {
  const perWear = item.cost !== undefined && item.worn.length ? item.cost / item.worn.length : undefined;
  const [cost, setCost] = useState(item.cost === undefined ? "" : String(item.cost));
  return (
    <li className={`flex flex-col overflow-hidden rounded-xl border ${open ? "border-ember sm:col-span-2" : "border-zinc-200 dark:border-zinc-800"}`}>
      {open ? (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex gap-4">
            <PhotoPicker photo={item.photo} onChange={(photo) => patchItem(item.id, { photo })} className="h-32 w-32" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input className="w-full bg-transparent text-lg font-medium outline-none" value={item.name} onChange={(e) => patchItem(item.id, { name: e.target.value })} aria-label="Item name" />
              <select className={inputClass} value={item.category} onChange={(e) => patchItem(item.id, { category: e.target.value })} aria-label="Category">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Color">
              <input className={inputClass} value={item.color} onChange={(e) => patchItem(item.id, { color: e.target.value })} placeholder="Navy" />
            </Field>
            <Field label="Brand">
              <input className={inputClass} value={item.brand} onChange={(e) => patchItem(item.id, { brand: e.target.value })} />
            </Field>
            <Field label="Size">
              <input className={inputClass} value={item.size} onChange={(e) => patchItem(item.id, { size: e.target.value })} />
            </Field>
            <Field label="What I paid">
              <input
                className={inputClass}
                inputMode="decimal"
                value={cost}
                onChange={(e) => {
                  setCost(e.target.value);
                  patchItem(item.id, { cost: money(e.target.value) });
                }}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Notes (fit, tailoring, care)">
            <textarea className={`${inputClass} min-h-16`} value={item.notes} onChange={(e) => patchItem(item.id, { notes: e.target.value })} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              className="text-xs text-zinc-400 hover:text-rose-600"
              onClick={() => {
                if (!confirm(`Remove ${item.name} from your closet?`)) return;
                if (item.photo) deleteFile(item.photo.id).catch(() => undefined);
                store.set((d) => ({
                  ...d,
                  items: d.items.filter((x) => x.id !== item.id),
                  outfits: d.outfits.map((o) => ({ ...o, itemIds: o.itemIds.filter((i) => i !== item.id) })),
                }));
              }}
            >
              Remove from closet
            </button>
            <button className={ghostButtonClass} onClick={onToggle}>Done</button>
          </div>
        </div>
      ) : (
        <>
          <button onClick={onToggle} className="aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900" aria-label={`Edit ${item.name}`}>
            {item.photo ? <Photo file={item.photo} className="h-full w-full" /> : <span className="text-3xl text-zinc-300 dark:text-zinc-700">👔</span>}
          </button>
          <div className="flex flex-1 flex-col gap-1 p-3">
            <button onClick={onToggle} className="text-left text-sm font-medium">{item.name}</button>
            <p className="text-xs text-zinc-500">{[item.color, item.brand, item.size].filter(Boolean).join(" · ") || item.category}</p>
            <p className="text-xs text-zinc-500">
              Worn {item.worn.length}×{perWear !== undefined && ` · ${usd(perWear)}/wear`}
            </p>
            <button
              className={`mt-auto self-start rounded-full px-2 py-0.5 text-xs ${item.worn.includes(today()) ? "bg-ember/15 text-brand" : "border border-zinc-300 hover:border-ember dark:border-zinc-700"}`}
              onClick={() => patchItem(item.id, { worn: item.worn.includes(today()) ? item.worn.filter((d) => d !== today()) : markWorn(item.worn) })}
            >
              {item.worn.includes(today()) ? "Wore it today ✓" : "Wore it today"}
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function Closet({ data }: { data: Data }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [filter, setFilter] = useState("All");
  const [openId, setOpenId] = useState<string | null>(null);

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    store.set((d) => ({ ...d, items: [{ id, name: name.trim(), category, color: "", brand: "", size: d.sizes[sizeKeyFor(category)] ?? "", worn: [], notes: "" }, ...d.items] }));
    setName("");
    setOpenId(id);
  }

  const used = CATEGORIES.filter((c) => data.items.some((i) => i.category === c));
  const shown = data.items.filter((i) => filter === "All" || i.category === filter);
  const value = data.items.reduce((s, i) => s + (i.cost ?? 0), 0);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const notWorn = data.items.filter((i) => (lastWorn(i.worn) || "0") < cutoff.toISOString().slice(0, 10)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Pieces" value={String(data.items.length)} />
        <Stat label="Closet value" value={usd(value)} />
        <Stat label="Not worn in a year" value={String(notWorn)} />
      </div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="min-w-48 flex-1">
          <Field label="Add to closet">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Navy blazer" />
          </Field>
        </div>
        <Field label="Category">
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <button className={buttonClass} disabled={!name.trim()}>Add</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>Your closet is empty. Add pieces above, then drop in a photo of each.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {["All", ...used].map((c) => (
              <button key={c} onClick={() => setFilter(c)} className={`rounded-full px-3 py-1 text-xs ${filter === c ? "bg-brand text-on-brand" : "border border-zinc-300 dark:border-zinc-700"}`}>
                {c}
              </button>
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((i) => (
              <ItemCard key={i.id} item={i} open={openId === i.id} onToggle={() => setOpenId(openId === i.id ? null : i.id)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function sizeKeyFor(category: string) {
  if (category === "Shoes") return "Shoes";
  if (category === "Pants") return "Pants (waist x inseam)";
  if (category === "Suits & blazers") return "Suit jacket";
  if (category === "Shirts") return "Dress shirt (neck / sleeve)";
  if (category === "Tops" || category === "Activewear" || category === "Outerwear") return "Shirt";
  return "";
}

function Outfits({ data }: { data: Data }) {
  const [name, setName] = useState("");
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [editing, setEditing] = useState<string | null>(null);
  const [occFilter, setOccFilter] = useState("All");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    store.set((d) => ({ ...d, outfits: [{ id, name: name.trim(), occasion, itemIds: [], worn: [], notes: "" }, ...d.outfits] }));
    setName("");
    setEditing(id);
  }

  const shown = data.outfits.filter((o) => occFilter === "All" || o.occasion === occFilter);
  const used = OCCASIONS.filter((o) => data.outfits.some((x) => x.occasion === o));

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="min-w-48 flex-1">
          <Field label="New outfit">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Keynote look" />
          </Field>
        </div>
        <Field label="For">
          <select className={inputClass} value={occasion} onChange={(e) => setOccasion(e.target.value)}>
            {OCCASIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <button className={buttonClass} disabled={!name.trim()}>Create outfit</button>
      </form>
      {used.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {["All", ...used].map((c) => (
            <button key={c} onClick={() => setOccFilter(c)} className={`rounded-full px-3 py-1 text-xs ${occFilter === c ? "bg-brand text-on-brand" : "border border-zinc-300 dark:border-zinc-700"}`}>
              {c}
            </button>
          ))}
        </div>
      )}
      {data.outfits.length === 0 && <Empty>No outfits yet. Create one, then pick pieces from your closet or drop in a photo of the look.</Empty>}
      <ul className="grid gap-4 md:grid-cols-2">
        {shown.map((o) => {
          const pieces = data.items.filter((i) => o.itemIds.includes(i.id));
          const isEditing = editing === o.id;
          return (
            <li key={o.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${isEditing ? "border-ember" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex gap-4">
                <PhotoPicker photo={o.photo} onChange={(photo) => patchOutfit(o.id, { photo })} label="Photo of the look" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input className="w-full bg-transparent font-medium outline-none" value={o.name} onChange={(e) => patchOutfit(o.id, { name: e.target.value })} aria-label="Outfit name" />
                  <select className="w-fit bg-transparent text-xs text-zinc-500 outline-none" value={o.occasion} onChange={(e) => patchOutfit(o.id, { occasion: e.target.value })} aria-label="Occasion">
                    {OCCASIONS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <p className="text-xs text-zinc-500">
                    {o.worn.length ? `Worn ${o.worn.length}× · last ${prettyDate(lastWorn(o.worn), { month: "short", day: "numeric" })}` : "Not worn yet"}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button className={ghostButtonClass} onClick={() => wearOutfit(o)} disabled={o.worn.includes(today())}>
                      {o.worn.includes(today()) ? "Wearing it today ✓" : "Wear today"}
                    </button>
                    <button className="text-xs text-brand" onClick={() => setEditing(isEditing ? null : o.id)}>
                      {isEditing ? "Done" : "Pick pieces"}
                    </button>
                  </div>
                </div>
              </div>
              {pieces.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pieces.map((p) => (
                    <span key={p.id} className="flex items-center gap-1.5 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2 text-xs dark:border-zinc-800">
                      {p.photo ? <Photo file={p.photo} className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-zinc-200 dark:bg-zinc-800" />}
                      {p.name}
                    </span>
                  ))}
                </div>
              )}
              {isEditing && (
                <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  {data.items.length === 0 ? (
                    <Empty>Add pieces in your Closet first.</Empty>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.items.map((i) => {
                        const on = o.itemIds.includes(i.id);
                        return (
                          <button
                            key={i.id}
                            onClick={() => patchOutfit(o.id, { itemIds: on ? o.itemIds.filter((x) => x !== i.id) : [...o.itemIds, i.id] })}
                            className={`rounded-full px-3 py-1 text-xs ${on ? "bg-brand text-on-brand" : "border border-zinc-300 dark:border-zinc-700"}`}
                          >
                            {i.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <textarea className={`${inputClass} min-h-14`} value={o.notes} onChange={(e) => patchOutfit(o.id, { notes: e.target.value })} placeholder="Notes (shoes, watch, where I wore it)" />
                  <button
                    className="self-start text-xs text-zinc-400 hover:text-rose-600"
                    onClick={() => {
                      if (!confirm(`Delete the ${o.name} outfit?`)) return;
                      if (o.photo) deleteFile(o.photo.id).catch(() => undefined);
                      store.set((d) => ({ ...d, outfits: d.outfits.filter((x) => x.id !== o.id) }));
                    }}
                  >
                    Delete outfit
                  </button>
                </div>
              )}
              {!isEditing && o.notes && <p className="text-xs text-zinc-500">{o.notes}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WishList({ data }: { data: Data }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [priority, setPriority] = useState<Wish["priority"]>("Want");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    store.set((d) => ({ ...d, wishlist: [...d.wishlist, { id: newId(), name: name.trim(), url: normalizeLink(url), price: money(price), priority, bought: false }] }));
    setName("");
    setUrl("");
    setPrice("");
  }

  const open = data.wishlist.filter((w) => !w.bought);
  const bought = data.wishlist.filter((w) => w.bought);
  const total = open.reduce((s, w) => s + (w.price ?? 0), 0);
  const order = (w: Wish) => PRIORITIES.indexOf(w.priority);

  const row = (w: Wish) => (
    <li key={w.id} className="flex items-center gap-3 py-2 text-sm">
      <input type="checkbox" checked={w.bought} onChange={(e) => store.set((d) => ({ ...d, wishlist: d.wishlist.map((x) => (x.id === w.id ? { ...x, bought: e.target.checked } : x)) }))} aria-label="Bought" />
      <span className={`min-w-0 flex-1 ${w.bought ? "text-zinc-400 line-through" : ""}`}>
        {w.url ? (
          <a href={w.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-brand">
            {w.name} ↗
          </a>
        ) : (
          w.name
        )}
      </span>
      {!w.bought && <span className={`rounded-full px-2 py-0.5 text-[11px] ${w.priority === "Need" ? "bg-ember/15 text-brand" : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"}`}>{w.priority}</span>}
      <span className="w-20 text-right tabular-nums">{w.price !== undefined ? usd(w.price) : ""}</span>
      <button className="text-xs text-zinc-400 hover:text-rose-600" onClick={() => store.set((d) => ({ ...d, wishlist: d.wishlist.filter((x) => x.id !== w.id) }))}>
        Remove
      </button>
    </li>
  );

  return (
    <Card title="Wish list" action={open.length > 0 ? <span className="text-sm text-zinc-500">{usd(total)} total</span> : undefined}>
      <form onSubmit={add} className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_6rem_7rem_auto]">
        <div className="col-span-2 sm:col-span-1">
          <Field label="Item">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chelsea boots" />
          </Field>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Link">
            <input className={inputClass} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="store.com/…" />
          </Field>
        </div>
        <Field label="Price">
          <input className={inputClass} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Wish["priority"])}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <button className={buttonClass} disabled={!name.trim()}>Add</button>
        </div>
      </form>
      {data.wishlist.length === 0 ? (
        <div className="mt-4">
          <Empty>Nothing on your wish list yet.</Empty>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {[...open].sort((a, b) => order(a) - order(b)).map(row)}
          {bought.map(row)}
        </ul>
      )}
    </Card>
  );
}

function Sizes({ data }: { data: Data }) {
  return (
    <Card title="My sizes">
      <p className="mb-4 text-sm text-zinc-500">Handy when ordering online or at the tailor. New closet pieces start with the matching size.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SIZE_FIELDS.map((f) => (
          <Field key={f} label={f}>
            <input className={inputClass} value={data.sizes[f] ?? ""} onChange={(e) => store.set((d) => ({ ...d, sizes: { ...d.sizes, [f]: e.target.value } }))} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

const TABS = ["Closet", "Outfits", "Wish list", "My sizes"] as const;

export function Style() {
  const data = store.use();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Closet");
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 ${tab === t ? buttonClass : ghostButtonClass}`}>
            {t}
          </button>
        ))}
      </nav>
      {tab === "Closet" && <Closet data={data} />}
      {tab === "Outfits" && <Outfits data={data} />}
      {tab === "Wish list" && <WishList data={data} />}
      {tab === "My sizes" && <Sizes data={data} />}
    </div>
  );
}
