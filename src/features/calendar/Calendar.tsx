"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";
import { api, ago } from "@/features/gladiator/api";
import { addDays, byDay, localYmd, monthRange } from "./days";

type Source = "google" | "outlook" | "bill";
type Ev = {
  id: string;
  source: Source;
  calendar: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  url: string;
  joinUrl?: string;
  recurring?: boolean;
  editable?: boolean;
  amount?: number;
  paid?: boolean;
};
type CalInfo = { id: string; name: string; source: Source; account: string; canEdit: boolean };
type Health = { ok: boolean; at: string | null; lastSuccess: string | null; error: string | null } | null;
type Status = {
  database: boolean;
  google: { keys: boolean; connected: boolean; email: string | null; connectedAt: string | null; health: Health };
  outlook: { keys: boolean; connected: boolean; email: string | null; account: string | null; connectedAt: string | null; missing: string[]; health: Health };
  googleRedirectUri?: string;
  microsoftRedirectUri?: string;
};
type Result = { calendars: CalInfo[]; events: Ev[]; errors: Partial<Record<Source, string>>; status: Status };

export const SOURCE_LABEL: Record<Source, string> = { google: "Google", outlook: "Gladiator Outlook", bill: "Bill" };
const SOURCE_STYLE: Record<Source, string> = {
  google: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  outlook: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  bill: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayTitle = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

function when(e: Ev, day: string) {
  if (e.allDay) return "All day";
  const s = localYmd(new Date(e.start));
  const en = localYmd(new Date(e.end));
  if (s === en) return `${time(e.start)} – ${time(e.end)}`;
  if (day === s) return `${time(e.start)} →`;
  if (day === en) return `→ ${time(e.end)}`;
  return "All day (continues)";
}

/* ---- Writing to Gladiator's Outlook calendar, always through a preview ---- */

type Draft = { calendarId: string; title: string; start: string; end: string; timeZone: string; allDay: boolean; location: string; teams: boolean };
type Pending = { kind: "create" | "update" | "cancel"; eventId?: string; draft?: Draft; calendarId?: string; comment?: string; title?: string };

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${localYmd(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function draftFrom(e: Ev | null, calendarId: string, day: string): Draft {
  if (!e) return { calendarId, title: "", start: `${day}T09:00`, end: `${day}T09:30`, timeZone: tz(), allDay: false, location: "", teams: false };
  return {
    calendarId: e.calendarId,
    title: e.title,
    start: e.allDay ? e.start : toLocalInput(e.start),
    end: e.allDay ? e.end : toLocalInput(e.end),
    timeZone: tz(),
    allDay: e.allDay,
    location: e.location,
    teams: Boolean(e.joinUrl),
  };
}

function EventForm({ calendars, initial, editing, onPreview, onClose }: { calendars: CalInfo[]; initial: Draft; editing: Ev | null; onPreview: (p: Pending) => void; onClose: () => void }) {
  const [d, setD] = useState(initial);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  return (
    <Card title={editing ? "Change event" : "New Gladiator event"} action={<button className={ghostButtonClass} onClick={onClose}>Close</button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Calendar">
          <select className={inputClass} value={d.calendarId} onChange={(e) => set({ calendarId: e.target.value })} disabled={Boolean(editing)}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.account})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input className={inputClass} value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={d.allDay}
            onChange={(e) => {
              const allDay = e.target.checked;
              const s = d.start.slice(0, 10);
              set(allDay ? { allDay, start: s, end: addDays(s, 1) } : { allDay, start: `${s}T09:00`, end: `${s}T09:30` });
            }}
          />
          All day
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.teams} onChange={(e) => set({ teams: e.target.checked })} />
          Add a Teams meeting link
        </label>
        <Field label={d.allDay ? "First day" : "Starts"}>
          <input className={inputClass} type={d.allDay ? "date" : "datetime-local"} value={d.start} onChange={(e) => set({ start: e.target.value })} />
        </Field>
        <Field label={d.allDay ? "Day after the last day" : "Ends"}>
          <input className={inputClass} type={d.allDay ? "date" : "datetime-local"} value={d.end} onChange={(e) => set({ end: e.target.value })} />
        </Field>
        <Field label="Where">
          <input className={inputClass} value={d.location} onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <p className="self-end text-xs text-zinc-500">Times are in {d.timeZone}.</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={buttonClass} disabled={!d.title.trim()} onClick={() => onPreview({ kind: editing ? "update" : "create", eventId: editing?.id, draft: d })}>
          Preview
        </button>
        {editing && (
          <button className={ghostButtonClass} onClick={() => onPreview({ kind: "cancel", eventId: editing.id, calendarId: editing.calendarId, comment: "", title: editing.title })}>
            Cancel this event…
          </button>
        )}
      </div>
    </Card>
  );
}

function Confirm({ pending, account, onDone, onBack }: { pending: Pending; account: string; onDone: (msg: string) => void; onBack: () => void }) {
  const [comment, setComment] = useState(pending.comment ?? "");
  const [preview, setPreview] = useState<{ key: string; token?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState("");
  const body = useMemo(
    () => ({ kind: pending.kind, eventId: pending.eventId, calendarId: pending.calendarId, comment, draft: pending.draft }),
    [pending, comment],
  );
  // A preview belongs to the exact body it was made for; a change waits for a new one.
  const key = JSON.stringify(body);
  const token = preview?.key === key ? (preview.token ?? null) : null;
  const error = commitError || (preview?.key === key ? (preview.error ?? "") : "");
  useEffect(() => {
    let live = true;
    api<{ token: string }>("/api/calendar/write", { action: "preview", ...body }).then(
      (r) => live && setPreview({ key: JSON.stringify(body), token: r.token }),
      (e) => live && setPreview({ key: JSON.stringify(body), error: (e as Error).message }),
    );
    return () => {
      live = false;
    };
  }, [body]);
  async function commit() {
    if (!token) return;
    setBusy(true);
    setCommitError("");
    try {
      await api("/api/calendar/write", { action: "commit", token, ...body });
      onDone(pending.kind === "cancel" ? "Event cancelled." : pending.kind === "update" ? "Event changed." : "Event added.");
    } catch (e) {
      setCommitError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const d = pending.draft;
  return (
    <Card title="Check before saving" action={<button className={ghostButtonClass} onClick={onBack}>Back</button>}>
      <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-zinc-500">Account</dt>
        <dd className="font-medium">{account}</dd>
        <dt className="text-zinc-500">What happens</dt>
        <dd>{pending.kind === "cancel" ? "Cancel the event. Attendees get Microsoft's cancellation notice." : pending.kind === "update" ? "Change this event in Outlook." : "Add this event to Outlook."}</dd>
        {d && (
          <>
            <dt className="text-zinc-500">Title</dt>
            <dd>{d.title}</dd>
            <dt className="text-zinc-500">When</dt>
            <dd>
              {d.allDay ? `All day, ${d.start} to ${addDays(d.end, -1)}` : `${d.start.replace("T", " ")} to ${d.end.replace("T", " ")}`} ({d.timeZone})
            </dd>
            <dt className="text-zinc-500">Where</dt>
            <dd>{d.location || "—"}</dd>
            <dt className="text-zinc-500">Teams link</dt>
            <dd>{d.teams ? "Yes" : "No"}</dd>
          </>
        )}
        {pending.kind === "cancel" && (
          <>
            <dt className="text-zinc-500">Event</dt>
            <dd>{pending.title}</dd>
          </>
        )}
      </dl>
      {pending.kind === "cancel" && (
        <div className="mt-3">
          <Field label="Note to attendees (optional)">
            <input className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
      <div className="mt-4">
        <button className={buttonClass} disabled={!token || busy} onClick={commit}>
          {busy ? "Saving…" : pending.kind === "cancel" ? "Cancel the event" : "Save to Outlook"}
        </button>
      </div>
    </Card>
  );
}

/* ---- Connections ---- */

function Connection({ name, account, connected, health, error, action }: { name: string; account: string | null; connected: boolean; health: Health; error?: string; action: React.ReactNode }) {
  const problem = error || (health && !health.ok ? health.error : null);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800" data-testid={`cal-conn-${name}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${!connected ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" : problem ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
          {!connected ? "Not connected" : problem ? "Problem" : "Connected"}
        </span>
      </div>
      {account && <span className="text-zinc-500">{account}</span>}
      {connected && <span className="text-xs text-zinc-500">Last good read {ago(health?.lastSuccess)}</span>}
      {problem && <span className="text-xs text-rose-600">{problem}</span>}
      <div className="mt-1">{action}</div>
    </div>
  );
}

export function CalendarScreen() {
  const today = localYmd(new Date());
  const [month, setMonth] = useState(today);
  const range = monthRange(month);
  const [data, setData] = useState<Result | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [fatal, setFatal] = useState("");
  const [hidden, setHidden] = useState<Set<Source>>(new Set());
  const [form, setForm] = useState<{ editing: Ev | null; day: string } | null>(null);
  const [formDraft, setFormDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNoticeText] = useState<string | null>(null);
  const setNotice = (m: string | null) => {
    setNoticeShown(false);
    setNoticeText(m);
  };

  const params = useSearchParams();
  // Read once: clearing the address below also clears the live search params.
  const [signIn] = useState(() => params.get("microsoft") || params.get("google"));
  const [noticeShown, setNoticeShown] = useState(true);
  useEffect(() => {
    if (signIn) window.history.replaceState(null, "", "/calendar");
  }, [signIn]);
  const signInNotice =
    !signIn || !noticeShown
      ? null
      : signIn === "connected" || signIn === "teams-connected"
        ? "Connected."
        : signIn === "cancelled"
          ? "Sign-in was cancelled."
          : signIn === "expired"
            ? "Sign-in took too long. Try again."
            : signIn === "needs-admin"
              ? "Microsoft says an administrator has to approve this first."
              : signIn;

  // Results remember the range they were read for, so a month change shows as loading until its own read lands.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rangeKey = `${range.from}:${range.to}`;
  const read = useCallback(async () => {
    try {
      const s = await api<Status>("/api/calendar/status");
      setStatus(s);
      const r = await api<Result>("/api/calendar/events", { from: range.from, to: range.to });
      setData(r);
      setStatus({ ...s, ...r.status });
      setFatal("");
    } catch (e) {
      setFatal((e as Error).message);
      setData(null);
    } finally {
      setLoaded(`${range.from}:${range.to}`);
      setRefreshing(false);
    }
  }, [range.from, range.to]);
  const load = () => {
    setRefreshing(true);
    read();
  };
  const loading = refreshing || loaded !== rangeKey;

  useEffect(() => {
    void Promise.resolve().then(read); // reads in a callback, not during the effect
  }, [read]);

  const editable = (data?.calendars ?? []).filter((c) => c.source === "outlook" && c.canEdit);
  const shown = (data?.events ?? []).filter((e) => !hidden.has(e.source));
  const days = byDay(shown, range.from, range.to);
  const list: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) list.push(d);
  const account = status?.outlook.email ?? status?.outlook.account ?? "";

  return (
    <div className="flex flex-col gap-5">
      {(notice ?? signInNotice) && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">{notice ?? signInNotice}</p>}
      <section className="grid gap-3 md:grid-cols-3">
        <Connection
          name="Google Calendar"
          account={status?.google.email ?? null}
          connected={Boolean(status?.google.connected)}
          health={status?.google.health ?? null}
          error={data?.errors.google}
          action={
            status?.google.connected ? (
              <button
                className="text-xs text-zinc-500 underline"
                onClick={async () => {
                  if (!window.confirm("Stop showing Google Calendar here? Gmail bill scanning keeps working.")) return;
                  await api("/api/calendar/google/disconnect", {});
                  load();
                }}
              >
                Stop showing
              </button>
            ) : status?.google.keys ? (
              <a className={ghostButtonClass} href="/api/calendar/google/connect">Connect Google Calendar (read only)</a>
            ) : (
              <Link className="text-xs underline" href="/email-bills">Set up Gmail first</Link>
            )
          }
        />
        <Connection
          name="Gladiator Outlook"
          account={status?.outlook.email ?? status?.outlook.account ?? null}
          connected={Boolean(status?.outlook.connected)}
          health={status?.outlook.health ?? null}
          error={data?.errors.outlook}
          action={<Link className={ghostButtonClass} href="/gladiator">{status?.outlook.connected ? "Gladiator 365" : "Set up Gladiator 365"}</Link>}
        />
        <Connection name="Bills" account="Financial Center due dates" connected health={{ ok: Boolean(data) && !data?.errors.bill, at: null, lastSuccess: data && !data.errors.bill ? new Date().toISOString() : null, error: data?.errors.bill ?? (fatal ? "Not read" : null) }} action={<Link className="text-xs underline" href="/money?tab=bills">Open bills</Link>} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button className={ghostButtonClass} onClick={() => setMonth(addDays(range.from, -1))}>← Previous</button>
        <h2 className="min-w-40 text-center text-lg font-semibold">{new Date(`${range.from}T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
        <button className={ghostButtonClass} onClick={() => setMonth(addDays(range.to, 1))}>Next →</button>
        <button className={ghostButtonClass} onClick={() => setMonth(today)}>Today</button>
        <button className={ghostButtonClass} onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        {editable.length > 0 && (
          <button
            className={buttonClass}
            onClick={() => {
              const day = month.slice(0, 7) === today.slice(0, 7) ? today : range.from;
              setForm({ editing: null, day });
              setFormDraft(draftFrom(null, editable[0].id, day));
            }}
          >
            New event
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {(["google", "outlook", "bill"] as Source[]).map((s) => (
            <label key={s} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${SOURCE_STYLE[s]}`}>
              <input type="checkbox" checked={!hidden.has(s)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(s)) n.delete(s); else n.add(s); return n; })} />
              {SOURCE_LABEL[s]}
            </label>
          ))}
        </div>
      </div>

      {pending && (
        <Confirm
          pending={pending}
          account={account}
          onBack={() => setPending(null)}
          onDone={(m) => {
            setPending(null);
            setForm(null);
            setNotice(m);
            load();
          }}
        />
      )}
      {!pending && form && formDraft && (
        <EventForm key={form.editing?.id ?? "new"} calendars={editable} initial={formDraft} editing={form.editing} onClose={() => setForm(null)} onPreview={setPending} />
      )}

      {fatal ? (
        <p role="alert" className="rounded-lg border border-rose-300 p-4 text-rose-700 dark:border-rose-800 dark:text-rose-300">
          The calendar couldn&apos;t be loaded: {fatal}
        </p>
      ) : !data ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <ol className="flex flex-col gap-4" data-testid="cal-days">
          {list.map((d) => {
            const items = (days.get(d) ?? []).slice().sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
            if (!items.length && d !== today) return null;
            return (
              <li key={d} className={`rounded-xl border p-3 ${d === today ? "border-brand" : "border-zinc-200 dark:border-zinc-800"}`}>
                <h3 className="mb-2 text-sm font-semibold">
                  {dayTitle(d)}
                  {d === today && <span className="ml-2 text-xs text-brand">Today</span>}
                </h3>
                {!items.length ? (
                  <p className="text-sm text-zinc-500">Nothing scheduled.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {items.map((e) => (
                      <li key={`${e.id}@${d}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm" data-testid="cal-event" data-source={e.source}>
                        <span className="w-32 shrink-0 tabular-nums text-zinc-500">{when(e, d)}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${SOURCE_STYLE[e.source]}`}>{SOURCE_LABEL[e.source]}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`font-medium ${e.paid ? "text-zinc-400 line-through" : ""}`}>{e.title}</span>
                          {e.amount !== undefined && <span className="ml-2 tabular-nums">{money(e.amount)}</span>}
                          {e.recurring && <span className="ml-2 text-xs text-zinc-500">repeats</span>}
                          <span className="block text-xs text-zinc-500">
                            {e.calendar}
                            {e.location && ` · ${e.location}`}
                          </span>
                        </span>
                        <span className="flex shrink-0 gap-3 text-xs">
                          {e.joinUrl && <a className="text-brand underline" href={e.joinUrl} target="_blank" rel="noopener noreferrer">Join</a>}
                          {e.url && <a className="underline" href={e.url} target="_blank" rel="noopener noreferrer">{e.source === "bill" ? "Pay" : "Open"}</a>}
                          {e.source === "outlook" && e.editable && (
                            <button
                              className="underline"
                              onClick={() => {
                                setPending(null);
                                setForm({ editing: e, day: d });
                                setFormDraft(draftFrom(e, e.calendarId, d));
                              }}
                            >
                              Change
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {data && Object.entries(data.errors).length > 0 && (
        <p role="alert" className="text-sm text-rose-600">
          Some calendars couldn&apos;t be read, so this view is missing their events: {Object.entries(data.errors).map(([k, v]) => `${SOURCE_LABEL[k as Source]}: ${v}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
