"use client";

import { useState, type FormEvent } from "react";
import { newId, setMoneyData } from "./store";
import { INSTITUTION_TYPES, type Institution, type MoneyData } from "./types";
import { accountBalance, accountTypeLabel, isLiability, money, normalizeUrl, shortDate } from "./calc";
import { Card, Empty, Field, buttonClass, ghostButtonClass, inputClass } from "./ui";

type Draft = Omit<Institution, "id">;

const blankDraft = (): Draft => ({
  name: "",
  type: "Bank",
  website: "",
  loginUrl: "",
  phone: "",
  memberNumber: "",
  notes: "",
});

const linkClass =
  "underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100";

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Institutions({ data }: { data: MoneyData }) {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const fields: Draft = {
      ...draft,
      name: draft.name.trim(),
      website: normalizeUrl(draft.website),
      loginUrl: normalizeUrl(draft.loginUrl),
      phone: draft.phone.trim(),
      memberNumber: draft.memberNumber.trim().slice(-4),
      notes: draft.notes.trim(),
    };
    setMoneyData((d) => ({
      ...d,
      institutions: editingId
        ? d.institutions.map((i) => (i.id === editingId ? { ...i, ...fields } : i))
        : [...d.institutions, { id: newId(), ...fields }],
    }));
    setDraft(blankDraft());
    setEditingId(null);
  }

  function edit(i: Institution) {
    setEditingId(i.id);
    const { id: _id, ...rest } = i;
    void _id;
    setDraft(rest);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove() {
    if (!editingId || !confirm("Delete this institution? Its accounts and bills stay, just unlinked.")) return;
    setMoneyData((d) => ({
      ...d,
      institutions: d.institutions.filter((i) => i.id !== editingId),
      accounts: d.accounts.map((a) => (a.institutionId === editingId ? { ...a, institutionId: "" } : a)),
      bills: d.bills.map((b) => (b.institutionId === editingId ? { ...b, institutionId: "" } : b)),
    }));
    setDraft(blankDraft());
    setEditingId(null);
  }

  const typesInUse = ["All", ...INSTITUTION_TYPES.filter((t) => data.institutions.some((i) => i.type === t))];
  const shown = data.institutions
    .filter((i) => filter === "All" || i.type === filter)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <Card title={editingId ? "Edit institution" : "Add an institution"}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="Name">
            <input className={inputClass} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Chase" />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={draft.type} onChange={(e) => set("type", e.target.value)}>
              {INSTITUTION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Phone">
            <input className={inputClass} inputMode="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="1-800-935-9935" />
          </Field>
          <Field label="Website">
            <input className={inputClass} inputMode="url" value={draft.website} onChange={(e) => set("website", e.target.value)} placeholder="chase.com" />
          </Field>
          <Field label="Sign-in page">
            <input className={inputClass} inputMode="url" value={draft.loginUrl} onChange={(e) => set("loginUrl", e.target.value)} placeholder="secure.chase.com" />
          </Field>
          <Field label="Account # (last 4 only)">
            <input className={inputClass} inputMode="numeric" maxLength={4} value={draft.memberNumber} onChange={(e) => set("memberNumber", e.target.value)} placeholder="1234" />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Notes">
              <input className={inputClass} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Branch, contact person, what this is for" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button className={buttonClass} disabled={!draft.name.trim()}>
              {editingId ? "Save changes" : "Add institution"}
            </button>
            {editingId && (
              <>
                <button type="button" className={ghostButtonClass} onClick={() => { setEditingId(null); setDraft(blankDraft()); }}>
                  Cancel
                </button>
                <button type="button" className="px-2 text-sm text-rose-600" onClick={remove}>
                  Delete
                </button>
              </>
            )}
          </div>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          Don&apos;t store passwords or full account numbers here; keep those in a password manager.
        </p>
      </Card>

      {data.institutions.length === 0 ? (
        <Card>
          <Empty>
            No institutions yet. Add your banks, credit cards, lenders, insurance, utilities and anyone else you deal with.
            Then pick them when you add accounts and bills.
          </Empty>
        </Card>
      ) : (
        <>
          {typesInUse.length > 2 && (
            <div className="flex flex-wrap gap-2">
              {typesInUse.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    filter === t
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map((inst) => {
              const accounts = data.accounts.filter((a) => a.institutionId === inst.id);
              const bills = data.bills.filter((b) => b.institutionId === inst.id);
              return (
                <section key={inst.id} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{inst.name}</h3>
                      <p className="text-xs text-zinc-500">
                        {inst.type}
                        {inst.memberNumber && ` · ending ${inst.memberNumber}`}
                      </p>
                    </div>
                    <button className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => edit(inst)}>
                      Edit
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {inst.loginUrl && (
                      <a href={inst.loginUrl} target="_blank" rel="noopener noreferrer" className={`font-medium ${linkClass}`}>
                        Sign in ↗
                      </a>
                    )}
                    {inst.website && (
                      <a href={inst.website} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        {hostOf(inst.website)} ↗
                      </a>
                    )}
                    {inst.phone && (
                      <a href={`tel:${inst.phone.replace(/[^\d+]/g, "")}`} className={linkClass}>
                        {inst.phone}
                      </a>
                    )}
                  </div>

                  {inst.notes && <p className="text-sm text-zinc-600 dark:text-zinc-400">{inst.notes}</p>}

                  {(accounts.length > 0 || bills.length > 0) && (
                    <ul className="flex flex-col gap-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
                      {accounts.map((a) => {
                        const bal = accountBalance(data, a);
                        return (
                          <li key={a.id} className="flex justify-between gap-3">
                            <span>{a.name} <span className="text-xs text-zinc-500">{accountTypeLabel(a)}</span></span>
                            <span className="tabular-nums">{isLiability(a) && bal <= 0 ? `${money(-bal)} owed` : money(bal)}</span>
                          </li>
                        );
                      })}
                      {bills.map((b) => (
                        <li key={b.id} className="flex justify-between gap-3">
                          <span>{b.name} <span className="text-xs text-zinc-500">bill · next {shortDate(b.nextDue)}</span></span>
                          <span className="tabular-nums">{money(b.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
