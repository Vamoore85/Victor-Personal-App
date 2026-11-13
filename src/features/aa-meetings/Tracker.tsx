"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";
import { formatSize } from "@/lib/files";
import { ORGANIZER_EMAIL, SELF_REPORTED, addDays, dateLabel, easternToday, hasStarted, timeLabel, type Kind, type Meeting, type MeetingData, type OrganizerConfirmation, type Rule } from "./model";
import { AUDIO_ACCEPT, MAX_AUDIO_BYTES, MAX_AUDIO_MB, NO_AUDIO, PART_BYTES, TRANSCRIPT_FAILED, extensionOk } from "./audio";

/*
 * The AA Meetings screen. Every change is sent to the server and the screen
 * only shows what the server saved; a failed save is shown as an error and
 * the screen keeps the last saved copy.
 */

type Tab = "check" | "upcoming" | "history" | "records" | "settings";
type SaveResult = { data: MeetingData; added?: number; updated?: number; cancelled?: number };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KINDS: Kind[] = ["AA", "IOP", "Other"];
const field = "flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300";
const input = `${inputClass} min-h-11 text-base lg:min-h-9 lg:text-sm`;

async function call(path: string, init?: RequestInit): Promise<SaveResult> {
  const res = await fetch(path, { ...init, cache: "no-store" }).catch(() => null);
  if (!res) throw new Error("Couldn't reach Maverick. Check your connection; nothing was saved.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't save. Nothing was changed.");
  return body;
}
const postJson = (body: unknown) => call("/api/aa-meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Badge({ tone, children }: { tone: "good" | "bad" | "plain" | "warn"; children: ReactNode }) {
  const c = { good: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", bad: "bg-rose-500/15 text-rose-800 dark:text-rose-300", warn: "bg-amber-500/15 text-amber-900 dark:text-amber-300", plain: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function Tracker() {
  const [data, setData] = useState<MeetingData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("check");
  const [adding, setAdding] = useState(false);
  // Read in the browser only, so the page never bakes a build-time clock in.
  const [now, setNow] = useState<Date | null>(null);

  const run = useCallback(async (work: () => Promise<SaveResult>, done?: (r: SaveResult) => string) => {
    setBusy(true); setError(""); setNotice("");
    try { const r = await work(); setData(r.data); setNow(new Date()); if (done) setNotice(done(r)); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await call("/api/aa-meetings") as unknown as MeetingData;
        if (!live) return;
        setData(loaded); setNow(new Date());
        // Keeps the next six weeks of recurring plans on the list; saves nothing when they're already there.
        const planned = await postJson({ action: "plan" }).catch((e: Error) => { if (live) setError(`Couldn't add upcoming planned meetings: ${e.message}`); return null; });
        if (live && planned) setData(planned.data);
      } catch (e) { if (live) setLoadError((e as Error).message); }
    })();
    return () => { live = false; };
  }, []);

  const lists = useMemo(() => {
    if (!data || !now) return null;
    const active = data.meetings.filter((m) => !m.cancelled);
    const byDate = (a: Meeting, b: Meeting) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
    const today = easternToday(now);
    const attended = active.filter((m) => m.state === "attended");
    return {
      check: active.filter((m) => m.state === "scheduled" && hasStarted(m, now)).sort(byDate).reverse(),
      upcoming: active.filter((m) => m.state === "scheduled" && !hasStarted(m, now)).sort(byDate),
      history: active.filter((m) => m.state !== "scheduled").sort(byDate).reverse(),
      records: data.meetings.filter((m) => m.evidence.length || m.confirmations.length).sort(byDate).reverse(),
      review: data.needsReview.filter((c) => !c.dismissedAt),
      month: attended.filter((m) => m.date.slice(0, 7) === today.slice(0, 7) && m.kind === "AA").length,
      last30: attended.filter((m) => m.date > addDays(today, -30) && m.kind === "AA").length,
    };
  }, [data, now]);

  if (loadError) return <p role="alert" className="rounded-xl bg-rose-500/10 p-4">{loadError}</p>;
  if (!data || !lists || !now) return <p role="status" className="text-zinc-500">Loading your meetings…</p>;

  const next = lists.upcoming[0];
  const tabs: [Tab, string, number?][] = [["check", "Needs check", lists.check.length], ["upcoming", "Upcoming", lists.upcoming.length], ["history", "History"], ["records", "Records & reports", lists.review.length], ["settings", "Settings"]];
  const shared = { data, busy, run, now };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 text-base">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["AA attended this month", String(lists.month)], ["AA attended, last 30 days", String(lists.last30)], ["Needs an answer", String(lists.check.length)], ["Next planned", next ? `${dateLabel(next.date).replace(/, \d{4}$/, "")}${next.time ? ` · ${timeLabel(next.time)}` : ""}` : "None"]].map(([label, value]) => (
          <section key={label} className="rounded-xl border border-zinc-200 bg-surface p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
          </section>
        ))}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <nav aria-label="AA Meetings views" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
          {tabs.map(([id, label, count]) => (
            <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
              className={`min-h-10 shrink-0 rounded-full px-3.5 text-sm ${tab === id ? "bg-brand font-medium text-on-brand" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
              {label}{count ? ` (${count})` : ""}
            </button>
          ))}
        </nav>
        <button className={`${buttonClass} min-h-11 self-start sm:min-h-10 sm:self-auto`} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>{adding ? "Close" : "Add a meeting"}</button>
      </div>

      <div aria-live="polite">
        {busy && <p role="status" className="text-sm text-zinc-500">Saving…</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-900 dark:text-rose-200">{error}</p>}
        {notice && !error && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm">{notice}</p>}
      </div>

      {adding && (
        <Card title="Add a meeting">
          <p className="mb-3 text-sm text-zinc-500">It&apos;s added as planned. Mark it attended once it has happened.</p>
          <MeetingForm data={data} busy={busy} submit="Add meeting" initial={{ date: easternToday(now) }}
            onSubmit={async (f) => { if (await run(() => postJson({ action: "add", ...f }), () => "Meeting added as planned.")) setAdding(false); }} />
        </Card>
      )}

      {tab === "check" && <List empty="Nothing waiting. Past planned meetings show up here so you can answer them." meetings={lists.check} {...shared} />}
      {tab === "upcoming" && <List empty="No planned meetings. Add one, or turn on a recurring plan in Settings." meetings={lists.upcoming} {...shared} />}
      {tab === "history" && <List empty="No answers yet. Meetings you mark attended or did not attend show up here." meetings={lists.history} {...shared} />}
      {tab === "records" && <><ReportBuilder data={data} now={now} /><NeedsReview items={lists.review} {...shared} /><List empty="No supporting records attached yet. Open a meeting and attach a slip or photo." meetings={lists.records} {...shared} /></>}
      {tab === "settings" && <Settings {...shared} />}
    </div>
  );
}

type Shared = { data: MeetingData; busy: boolean; now: Date; run: (work: () => Promise<SaveResult>, done?: (r: SaveResult) => string) => Promise<boolean> };

function List({ meetings, empty, ...shared }: Shared & { meetings: Meeting[]; empty: string }) {
  if (!meetings.length) return <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-700">{empty}</p>;
  return <ul className="flex flex-col gap-3">{meetings.slice(0, 200).map((m) => <li key={m.id}><MeetingCard m={m} {...shared} /></li>)}</ul>;
}

function MeetingCard({ m, data, busy, run, now }: Shared & { m: Meeting }) {
  const [editing, setEditing] = useState(false);
  const started = hasStarted(m, now);
  const status = m.state === "attended" ? <Badge tone="good">Attended</Badge> : m.state === "missed" ? <Badge tone="bad">Did not attend</Badge> : started ? <Badge tone="warn">Needs an answer</Badge> : <Badge tone="plain">Planned</Badge>;
  const setState = (state: string, label: string) => run(() => postJson({ action: "status", id: m.id, state }), () => label);
  const records = m.evidence;

  async function attach(file: File) {
    if (file.size > 4 * 1024 * 1024) { await run(async () => { throw new Error("That file is over 4 MB. Try a photo or a smaller PDF."); }); return; }
    await run(() => call(`/api/aa-meetings/evidence?meetingId=${encodeURIComponent(m.id)}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }),
      () => `Attached "${file.name}". It's kept as your own record; it doesn't change the attendance answer.`);
  }

  return (
    <article className="rounded-xl border border-zinc-200 bg-surface p-3 sm:p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{m.name}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {dateLabel(m.date)}{m.time ? ` · ${timeLabel(m.time)}` : ""}{m.minutes ? ` · ${m.minutes} min` : ""}{m.location ? ` · ${m.location}` : ""}{m.format === "online" ? " · Online" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">{m.kind !== "AA" && <Badge tone="plain">{m.kind}</Badge>}{m.source === "calendar" && <Badge tone="plain">From calendar</Badge>}{status}</div>
      </div>
      {m.topic && <p className="mt-2 text-sm"><span className="text-zinc-500">Topic: </span>{m.topic}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {started && m.state !== "attended" && <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => setState("attended", `Recorded: you attended ${m.name}.`)}>I attended</button>}
        {started && m.state !== "missed" && <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => setState("missed", `Recorded: you did not attend ${m.name}.`)}>Did not attend</button>}
        {m.state !== "scheduled" && <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => setState("scheduled", "Answer cleared. The meeting is planned again.")}>Clear answer</button>}
        {!started && <span className="w-full text-sm text-zinc-500">You can mark this once it starts.</span>}
        <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? "Close edit" : "Edit"}</button>
        <label className={`${ghostButtonClass} inline-flex min-h-11 cursor-pointer items-center lg:min-h-9`}>
          Attach slip or photo
          <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attach(f); }} />
        </label>
        {m.state === "scheduled" && <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => confirm("Remove this meeting from your plan? It stays in the change history.") && run(() => postJson({ action: "cancel", id: m.id }), () => "Removed from the plan.")}>Remove from plan</button>}
      </div>

      <AudioPanel m={m} busy={busy} run={run} />
      {m.confirmations.length > 0 && (
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-sm font-medium">{ORGANIZER_EMAIL}s <span className="font-normal text-zinc-500">(emails you received from the organizer, imported read-only from Gmail; separate from your self-reported answer)</span></p>
          <ul className="mt-1 flex flex-col gap-2">{m.confirmations.map((c) => <li key={c.gmailId}><ConfirmationView c={c} /></li>)}</ul>
        </div>
      )}

      {editing && (
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {m.state !== "scheduled" && <p className="mb-2 text-sm text-amber-800 dark:text-amber-300">Changing the date, time or name clears your answer so you can confirm it again.</p>}
          <MeetingForm data={data} busy={busy} submit="Save changes" initial={m}
            onSubmit={async (f) => { if (await run(() => postJson({ action: "edit", id: m.id, ...f }), () => "Changes saved.")) setEditing(false); }} />
        </div>
      )}

      {records.length > 0 && (
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-sm font-medium">Supporting records <span className="font-normal text-zinc-500">(your own attachments, not third-party verification)</span></p>
          <ul className="mt-1 flex flex-col gap-1">
            {records.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <a className="break-all text-brand underline" href={`/api/aa-meetings/evidence/${e.id}`}>{e.name}</a>
                <span className="text-xs text-zinc-500">{formatSize(e.size)} · added {new Date(e.uploadedAt).toLocaleDateString()} · SHA-256 {e.sha256.slice(0, 12)}…</span>
                {e.withdrawnAt ? <Badge tone="plain">Left out of reports</Badge> : <button className="text-xs text-zinc-500 underline" disabled={busy} onClick={() => confirm(`Leave "${e.name}" out of reports? The original file is kept unchanged.`) && run(() => postJson({ action: "withdraw-evidence", id: m.id, evidenceId: e.id }), () => "That record will be left out of reports. The file is kept.")}>Leave out of reports</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.note && <details className="mt-2 text-sm"><summary className="cursor-pointer text-zinc-500">Private note (never in reports unless you choose)</summary><p className="mt-1 whitespace-pre-wrap">{m.note}</p></details>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-zinc-500">Change history ({m.history.length})</summary>
        <ol className="mt-1 flex flex-col gap-1">
          {[...m.history].reverse().map((h, i) => <li key={i}><span className="text-zinc-500">{new Date(h.at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}</span> · {h.action}</li>)}
        </ol>
      </details>
    </article>
  );
}

function ConfirmationView({ c }: { c: OrganizerConfirmation }) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2"><Badge tone="good">{ORGANIZER_EMAIL}</Badge><span className="font-medium break-words">{c.subject || "(no subject)"}</span></div>
      <p className="text-xs text-zinc-500">From {c.sender} · sent {new Date(c.date).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}{c.matchedBy ? ` · matched by ${c.matchedBy.toLowerCase()}` : ""}</p>
      {c.attachments.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {c.attachments.map((a) => <li key={a.id}><a className="break-all text-brand underline" href={`/api/aa-meetings/confirmation-file/${a.id}?inline=1`} target="_blank" rel="noopener">{a.name}</a> <span className="text-xs text-zinc-500">{formatSize(a.size)} · SHA-256 {a.sha256.slice(0, 12)}…</span></li>)}
        </ul>
      )}
      {c.skippedAttachments.length > 0 && <p className="text-xs text-zinc-500">Not imported (not a PDF or photo, or too large): {c.skippedAttachments.join(", ")}</p>}
      {c.body && <details className="mt-1"><summary className="cursor-pointer text-zinc-500">Email text</summary><p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p></details>}
    </div>
  );
}

function NeedsReview({ items, data, busy, run }: Shared & { items: OrganizerConfirmation[] }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  if (!items.length) return null;
  const options = data.meetings.filter((m) => !m.cancelled).sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time)).slice(0, 300);
  return (
    <Card title={`Needs review: organizer emails (${items.length})`}>
      <p className="mb-3 text-sm text-zinc-500">These emails matched no meeting, or more than one, so nothing was guessed. Choose the meeting each one belongs to, or mark it as not about a meeting.</p>
      <ul className="flex flex-col gap-3">
        {items.map((c) => (
          <li key={c.gmailId} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <ConfirmationView c={c} />
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{c.reviewReason}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select className={`${input} min-w-0 flex-1`} value={pick[c.gmailId] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [c.gmailId]: e.target.value }))} aria-label="Meeting this email belongs to">
                <option value="">Choose a meeting…</option>
                {options.map((m) => <option key={m.id} value={m.id}>{dateLabel(m.date)}{m.time ? ` ${timeLabel(m.time)}` : ""} · {m.name}</option>)}
              </select>
              <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy || !pick[c.gmailId]} onClick={() => run(() => postJson({ action: "assign-confirmation", gmailId: c.gmailId, id: pick[c.gmailId] }), () => "Email attached to that meeting.")}>Attach to meeting</button>
              <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => run(() => postJson({ action: "dismiss-confirmation", gmailId: c.gmailId }), () => "Marked as not about a meeting. It won't be imported again.")}>Not about a meeting</button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const extFor = (type: string) => (type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm");
const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Sends audio in parts (each under Vercel's 4.5 MB request limit), then asks the server to check and attach it. */
async function sendAudio(meetingId: string, blob: Blob, name: string, source: "recording" | "import", replace: boolean, times: { startedAt?: string; stoppedAt?: string }, progress: (s: string) => void) {
  const uploadId = crypto.randomUUID();
  const base = `/api/aa-meetings/audio?meetingId=${encodeURIComponent(meetingId)}&uploadId=${uploadId}`;
  const parts = Math.max(1, Math.ceil(blob.size / PART_BYTES));
  for (let i = 0; i < parts; i++) {
    progress(`Uploading audio, part ${i + 1} of ${parts}…`);
    await call(`${base}&part=${i}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob.slice(i * PART_BYTES, (i + 1) * PART_BYTES) });
  }
  progress("Checking the audio…");
  return call(`${base}&finish=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts, name, type: blob.type, source, replace, ...times }) });
}

type Rec = { phase: "idle" | "consent" | "recording" | "saving" | "unsaved"; replace: boolean; startedAt?: string; stoppedAt?: string; blob?: Blob; error?: string };

function AudioPanel({ m, busy, run }: { m: Meeting; busy: boolean; run: Shared["run"] }) {
  const [rec, setRec] = useState<Rec>({ phase: "idle", replace: false });
  const [consented, setConsented] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState("");
  const [names, setNames] = useState((m.participants ?? []).join(", "));
  const [times, setTimes] = useState({ joined: m.selfTimes?.joined ?? "", left: m.selfTimes?.left ?? "" });
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  // Read by the recorder's stop handler, which outlives the render that created it.
  const meta = useRef({ replace: false, startedAt: "", stoppedAt: "" });
  const a = m.audio;

  const stopTracks = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => { if (recorder.current?.state === "recording") recorder.current.stop(); stopTracks(); }, []);
  useEffect(() => {
    if (rec.phase !== "recording") return;
    const started = Date.parse(rec.startedAt!);
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", leave);
    return () => { clearInterval(tick); window.removeEventListener("beforeunload", leave); };
  }, [rec.phase, rec.startedAt]);

  async function listInputs() {
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput")); } catch { setDevices([]); }
  }
  function askToRecord() {
    if (a && !confirm(`This meeting already has audio ("${a.name}"). Record a new one? It replaces the old audio and its transcript only after the new recording is saved.`)) return;
    meta.current = { replace: Boolean(a), startedAt: "", stoppedAt: "" };
    setConsented(false); setRec({ phase: "consent", replace: Boolean(a) }); void listInputs();
  }
  async function start() {
    if (!consented) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setRec((r) => ({ ...r, error: "This browser can't record audio." })); return; }
    try {
      // Audio only, from the input you picked. Voice processing is off so a loopback of the meeting's sound is kept as is.
      const s = await navigator.mediaDevices.getUserMedia({ video: false, audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      stream.current = s;
      const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stopTracks();
        const blob = new Blob(chunks.current, { type: (r.mimeType || mimeType || "audio/webm").split(";")[0] });
        meta.current.stoppedAt = new Date().toISOString();
        setRec((x) => ({ ...x, phase: "unsaved", stoppedAt: meta.current.stoppedAt, blob }));
        void save(blob);
      };
      recorder.current = r;
      r.start(10000);
      setElapsed(0);
      meta.current.startedAt = new Date().toISOString();
      setRec((x) => ({ ...x, phase: "recording", startedAt: meta.current.startedAt, error: undefined }));
      void listInputs(); // names of inputs are only available after permission
    } catch { stopTracks(); setRec((x) => ({ ...x, error: "Couldn't use that input. Check the browser's microphone permission and the input you picked." })); }
  }
  function stop() { if (recorder.current?.state === "recording") recorder.current.stop(); }

  async function save(blob: Blob) {
    const { replace, startedAt, stoppedAt } = meta.current;
    if (blob.size > MAX_AUDIO_BYTES) { setRec((x) => ({ ...x, phase: "unsaved", error: `The recording is over ${MAX_AUDIO_MB} MB, so it can't be stored. Save a copy to this device.` })); return; }
    setRec((x) => ({ ...x, phase: "saving", error: undefined }));
    const ok = await run(() => sendAudio(m.id, blob, `recording-${m.date}.${extFor(blob.type)}`, "recording", replace, { startedAt, stoppedAt }, setProgress),
      () => "Recording saved privately. It's waiting for the transcript on your Mac.");
    setProgress("");
    setRec((x) => (ok ? { phase: "idle", replace: false } : { ...x, phase: "unsaved", error: "The recording wasn't saved yet. Try again, or save a copy to this device." }));
  }

  async function importFile(file: File) {
    const fail = (message: string) => run(async () => { throw new Error(message); });
    if (!extensionOk(file.name) || !/\.[A-Za-z0-9]{1,5}$/.test(file.name)) { await fail("Use an audio file: M4A, MP3, WAV, WebM or OGG."); return; }
    if (file.size > MAX_AUDIO_BYTES) { await fail(`That file is over ${MAX_AUDIO_MB} MB.`); return; }
    if (a && !confirm(`Replace this meeting's audio ("${a.name}") and its transcript with "${file.name}"?`)) return;
    await run(() => sendAudio(m.id, file, file.name, "import", Boolean(a), {}, setProgress), () => `Imported "${file.name}" privately. It's waiting for the transcript on your Mac.`);
    setProgress("");
  }

  const status = !a ? null
    : a.status === "awaiting-transcript" ? <Badge tone="warn">Awaiting transcript</Badge>
    : a.status === "transcribed" ? <Badge tone="good">Transcribed</Badge>
    : a.status === "no-audio" ? <Badge tone="plain">{NO_AUDIO}</Badge> : <Badge tone="bad">{TRANSCRIPT_FAILED}</Badge>;

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <p className="text-sm font-medium">Meeting audio <span className="font-normal text-zinc-500">(private; audio only; transcribed on your Mac)</span></p>
      {a && (
        <div className="mt-1 flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">{status}<span className="break-all">{a.name}</span><span className="text-xs text-zinc-500">{formatSize(a.size)} · {a.source === "recording" ? "recorded" : "imported"} {new Date(a.uploadedAt).toLocaleDateString()} · SHA-256 {a.sha256.slice(0, 12)}…</span></div>
          {a.reason && <p className="text-xs text-zinc-500">{a.status === "failed" ? "Reason" : "Note"}: {a.reason}</p>}
          {a.status === "transcribed" && (
            <>
              <p className="rounded-lg bg-zinc-500/5 p-2"><span className="block text-xs text-zinc-500">Takeaway ({a.takeawayEngine === "claude" ? "Claude, turned on for this meeting" : "local model on your Mac"})</span>{a.takeaway}</p>
              {a.hasTranscript && <a className="text-brand underline" href={`/api/aa-meetings/audio?meetingId=${encodeURIComponent(m.id)}`} target="_blank" rel="noopener">View transcript</a>}
            </>
          )}
        </div>
      )}
      {m.selfTimes && <p className="mt-1 text-sm">Joined {timeLabel(m.selfTimes.joined)} · left {timeLabel(m.selfTimes.left)} <Badge tone="plain">{SELF_REPORTED}</Badge> <span className="text-xs text-zinc-500">{m.selfTimes.source === "recording" ? "from your own Start and Stop" : "entered by you"}</span></p>}

      {rec.phase === "consent" && (
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Before you record</p>
          <p className="mt-1">Get the host&apos;s consent and the group&apos;s consent before recording, and follow the meeting&apos;s rules. Many meetings don&apos;t allow recording; if this one doesn&apos;t, don&apos;t record.</p>
          <label className={`${field} mt-2`}>Input to record (your microphone, or a loopback of the meeting&apos;s sound)
            <select className={input} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Default input</option>
              {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>)}
            </select>
          </label>
          <label className="mt-2 flex min-h-11 items-start gap-2"><input type="checkbox" className="mt-1" checked={consented} onChange={(e) => setConsented(e.target.checked)} />I have the host&apos;s and the group&apos;s consent, and I&apos;ll follow the meeting&apos;s rules.</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={!consented} onClick={() => void start()}>Start recording</button>
            <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} onClick={() => setRec({ phase: "idle", replace: false })}>Cancel</button>
          </div>
        </div>
      )}
      {rec.phase === "recording" && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-3" role="status" aria-live="polite">
          <span className="inline-flex items-center gap-2 font-semibold text-rose-700 dark:text-rose-300"><span className="h-3 w-3 animate-pulse rounded-full bg-rose-600" aria-hidden />Recording</span>
          <span className="tabular-nums">{clock(elapsed)}</span>
          <button className={`${buttonClass} min-h-11 lg:min-h-9`} onClick={stop}>Stop</button>
        </div>
      )}
      {(rec.phase === "saving" || progress) && <p role="status" className="mt-2 text-sm text-zinc-500">{progress || "Saving the recording…"}</p>}
      {rec.error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{rec.error}</p>}
      {rec.phase === "unsaved" && rec.blob && (
        <div className="mt-2 flex flex-wrap gap-2">
          {rec.blob.size <= MAX_AUDIO_BYTES && <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => void save(rec.blob!)}>Try saving again</button>}
          <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} onClick={() => download(rec.blob!, `recording-${m.date}.${extFor(rec.blob!.type)}`)}>Save a copy to this device</button>
          <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} onClick={() => confirm("Discard this recording? It hasn't been saved.") && setRec({ phase: "idle", replace: false })}>Discard</button>
        </div>
      )}

      {rec.phase === "idle" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={askToRecord}>Start recording</button>
          <label className={`${ghostButtonClass} inline-flex min-h-11 cursor-pointer items-center lg:min-h-9`}>
            Import existing audio
            <input type="file" className="sr-only" accept={AUDIO_ACCEPT} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
          </label>
          {a && <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => confirm("Delete this meeting's audio and transcript? This can't be undone.") && run(() => postJson({ action: "delete-audio", id: m.id }), () => "Audio and transcript deleted.")}>Delete audio</button>}
        </div>
      )}
      <p className="mt-1 text-xs text-zinc-500">M4A, MP3, WAV, WebM or OGG, up to {MAX_AUDIO_MB} MB. One audio file per meeting.</p>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-zinc-500">Takeaway and attendance times</summary>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex min-h-11 items-start gap-2">
            <input type="checkbox" className="mt-1" checked={m.useClaudeTakeaway === true} disabled={busy}
              onChange={(e) => run(() => postJson({ action: "audio-settings", id: m.id, useClaudeTakeaway: e.target.checked }), () => e.target.checked ? "Claude will write this meeting's takeaway." : "The local model on your Mac will write this meeting's takeaway.")} />
            <span>Use Claude for this takeaway<span className="block text-xs text-zinc-500">Off: the four-sentence takeaway is written by the local model on your Mac, and the transcript never leaves it. On: the transcript is sent to Claude on your plan for this meeting only.</span></span>
          </label>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => postJson({ action: "audio-settings", id: m.id, useClaudeTakeaway: m.useClaudeTakeaway === true, participants: names.split(",") }), () => "Saved. Those names are replaced with \"a member\" in the takeaway."); }}>
            <label className={`${field} min-w-0 flex-1`}>Names to keep out of the takeaway (comma separated, private)<input className={input} value={names} onChange={(e) => setNames(e.target.value)} maxLength={1500} /></label>
            <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy}>Save names</button>
          </form>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => postJson({ action: "self-times", id: m.id, ...times }), () => "Join and leave times saved as self-reported."); }}>
            <label className={field}>Joined<input className={input} type="time" required value={times.joined} onChange={(e) => setTimes({ ...times, joined: e.target.value })} /></label>
            <label className={field}>Left<input className={input} type="time" required value={times.left} onChange={(e) => setTimes({ ...times, left: e.target.value })} /></label>
            <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={busy}>Save times ({SELF_REPORTED.toLowerCase()})</button>
          </form>
        </div>
      </details>
    </div>
  );
}

type FormValues = { date: string; time: string; name: string; location: string; format: string; minutes: string; kind: Kind; topic: string; note: string };
function MeetingForm({ data, busy, initial, submit, onSubmit }: { data: MeetingData; busy: boolean; initial: Partial<Meeting>; submit: string; onSubmit: (f: FormValues) => void }) {
  const [f, setF] = useState<FormValues>({
    date: initial.date ?? "", time: initial.time ?? "", name: initial.name ?? "", location: initial.location ?? "", format: initial.format ?? "in-person",
    minutes: initial.minutes ? String(initial.minutes) : "", kind: initial.kind ?? "AA", topic: initial.topic ?? "", note: initial.note ?? "",
  });
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const names = [...new Set([...data.rules.map((r) => r.name), ...data.meetings.map((m) => m.name)])].slice(0, 50);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <label className={field}>Meeting name<input className={input} required value={f.name} onChange={set("name")} list="aa-names" maxLength={180} /></label>
      <datalist id="aa-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="grid grid-cols-2 gap-3">
        <label className={field}>Date<input className={input} type="date" required value={f.date} onChange={set("date")} /></label>
        <label className={field}>Start time<input className={input} type="time" value={f.time} onChange={set("time")} /></label>
      </div>
      <label className={field}>Location<input className={input} value={f.location} onChange={set("location")} maxLength={180} placeholder="Place, or Online" /></label>
      <div className="grid grid-cols-3 gap-3">
        <label className={field}>Minutes<input className={input} type="number" min={1} max={720} inputMode="numeric" value={f.minutes} onChange={set("minutes")} /></label>
        <label className={field}>Type<select className={input} value={f.kind} onChange={set("kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className={field}>Format<select className={input} value={f.format} onChange={set("format")}><option value="in-person">In person</option><option value="online">Online</option></select></label>
      </div>
      <label className={`${field} sm:col-span-2`}>Topic (optional)<input className={input} value={f.topic} onChange={set("topic")} list="aa-topics" maxLength={300} /></label>
      <datalist id="aa-topics">{data.topics.map((t) => <option key={t} value={t} />)}</datalist>
      <label className={`${field} sm:col-span-2`}>Private note (kept out of reports)<textarea className={`${input} min-h-20`} value={f.note} onChange={set("note")} maxLength={4000} /></label>
      <div className="sm:col-span-2"><button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy}>{busy ? "Saving…" : submit}</button></div>
    </form>
  );
}

function ReportBuilder({ data, now }: { data: MeetingData; now: Date }) {
  const today = easternToday(now);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [through, setThrough] = useState(today);
  const [kinds, setKinds] = useState<Kind[]>(["AA"]);
  const [topics, setTopics] = useState(false);
  const [notes, setNotes] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});
  async function get(format: string) {
    setState({ busy: true });
    const q = new URLSearchParams({ from, through, format, kinds: kinds.join(","), ...(topics ? { topics: "1" } : {}), ...(notes ? { notes: "1" } : {}) });
    try {
      const res = await fetch(`/api/aa-meetings/report?${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't make the report.");
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `aa-report.${format}`;
      download(await res.blob(), name);
      setState({ done: `Downloaded ${name}. Nothing was sent anywhere.` });
    } catch (e) { setState({ error: e instanceof TypeError ? "Couldn't reach Maverick." : (e as Error).message }); }
  }
  return (
    <Card title="Court report">
      <p className="mb-3 text-sm text-zinc-500">Lists only meetings you marked “I attended”, labeled self-reported, with your attached records referenced by file name and fingerprint. No stamps, signatures or certifications are added, and it is never emailed or submitted for you.</p>
      {!data.profile.name && <p className="mb-3 rounded-lg bg-amber-500/10 p-2 text-sm">Add your name and case details under Settings before making a PDF.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className={field}>From<input className={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={field}>Through<input className={input} type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></label>
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="sr-only">Meeting types</legend>
          {KINDS.map((k) => <label key={k} className="flex min-h-11 items-center gap-1.5"><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds((x) => e.target.checked ? [...x, k] : x.filter((y) => y !== k))} />{k}</label>)}
        </fieldset>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 text-sm">
        <label className="flex min-h-11 items-center gap-1.5"><input type="checkbox" checked={topics} onChange={(e) => setTopics(e.target.checked)} />Include topics</label>
        <label className="flex min-h-11 items-center gap-1.5"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />Include private notes</label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={state.busy || !kinds.length} onClick={() => get("pdf")}>Download PDF</button>
        <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={state.busy || !kinds.length} onClick={() => get("csv")}>CSV</button>
        <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={state.busy || !kinds.length} onClick={() => get("json")}>JSON</button>
        <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} disabled={state.busy} onClick={() => get("backup")}>Full backup (JSON)</button>
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{state.error}</p>}
      {state.done && <p role="status" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{state.done}</p>}
    </Card>
  );
}

function Settings({ data, busy, run, now }: Shared) {
  const [profile, setProfile] = useState(data.profile);
  const [rules, setRules] = useState<Rule[]>(data.rules);
  const [topics, setTopics] = useState(data.topics);
  const [newTopic, setNewTopic] = useState("");
  const today = easternToday(now);
  const [cal, setCal] = useState({ match: data.rules.map((r) => r.name).join(", ") + ", AA, IOP", from: addDays(today, -90), through: addDays(today, 60) });
  const [file, setFile] = useState<File | null>(null);
  const setRule = (i: number, k: keyof Rule, v: unknown) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="flex flex-col gap-4">
      <Card title="Report details (private)">
        <p className="mb-3 text-sm text-zinc-500">Saved only in your private Maverick storage and printed on reports you download.</p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(() => postJson({ action: "settings", ...profile }), () => "Report details saved."); }}>
          <label className={field}>Your name as it should appear<input className={input} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={120} /></label>
          <label className={field}>Report title<input className={input} value={profile.reportTitle} onChange={(e) => setProfile({ ...profile, reportTitle: e.target.value })} maxLength={120} /></label>
          <label className={field}>Court<input className={input} value={profile.court} onChange={(e) => setProfile({ ...profile, court: e.target.value })} maxLength={180} /></label>
          <label className={field}>Case number(s)<input className={input} value={profile.caseNumbers} onChange={(e) => setProfile({ ...profile, caseNumbers: e.target.value })} maxLength={180} /></label>
          <div className="sm:col-span-2"><button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy}>Save report details</button></div>
        </form>
      </Card>

      <Card title="Recurring plans">
        <p className="mb-3 text-sm text-zinc-500">Plans add the next six weeks as planned meetings. They are never marked attended for you.</p>
        <div className="flex flex-col gap-3">
          {rules.map((r, i) => (
            <div key={r.id} className="grid gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-6 dark:border-zinc-800">
              <label className={`${field} sm:col-span-2`}>Name<input className={input} value={r.name} onChange={(e) => setRule(i, "name", e.target.value)} /></label>
              <label className={field}>Day<select className={input} value={r.weekday} onChange={(e) => setRule(i, "weekday", Number(e.target.value))}>{WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select></label>
              <label className={field}>Time<input className={input} type="time" value={r.time} onChange={(e) => setRule(i, "time", e.target.value)} /></label>
              <label className={field}>Minutes<input className={input} type="number" min={1} max={720} value={r.minutes ?? ""} onChange={(e) => setRule(i, "minutes", e.target.value === "" ? null : Number(e.target.value))} /></label>
              <label className={field}>Type<select className={input} value={r.kind} onChange={(e) => setRule(i, "kind", e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
              <label className={`${field} sm:col-span-3`}>Location<input className={input} value={r.location} onChange={(e) => setRule(i, "location", e.target.value)} /></label>
              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={r.enabled} onChange={(e) => setRule(i, "enabled", e.target.checked)} />Plan this every week</label>
              <button type="button" className="min-h-11 text-left text-sm text-zinc-500 underline" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>Delete plan</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={`${ghostButtonClass} min-h-11 lg:min-h-9`} onClick={() => setRules((rs) => [...rs, { id: "", name: "", weekday: 0, time: "", location: "", format: "in-person", minutes: null, kind: "AA", enabled: true }])}>Add a plan</button>
          <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={async () => {
            if (await run(() => postJson({ action: "rules", rules }), () => "Plans saved.")) await run(() => postJson({ action: "plan" }), (r) => `Plans saved. ${r.added ? `${r.added} upcoming meetings added.` : "Upcoming meetings were already listed."}`);
          }}>Save plans</button>
        </div>
      </Card>

      <Card title="Discussion topics">
        <p className="mb-3 text-sm text-zinc-500">Topics to pick from when you log a meeting. A topic is not a record that a meeting happened.</p>
        <ul className="flex flex-col gap-2">
          {topics.map((t, i) => <li key={`${i}-${t}`} className="flex items-start justify-between gap-3 text-sm"><span>{i + 1}. {t}</span><button className="shrink-0 text-zinc-500 underline" onClick={() => setTopics((x) => x.filter((_, j) => j !== i))}>Remove</button></li>)}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={`${input} min-w-0 flex-1`} value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Add a topic" maxLength={300} />
          <button className={`${ghostButtonClass} min-h-11 lg:min-h-9`} onClick={() => { if (newTopic.trim()) { setTopics((x) => [...x, newTopic.trim()]); setNewTopic(""); } }}>Add</button>
          <button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy} onClick={() => run(() => postJson({ action: "topics", topics }), () => "Topics saved.")}>Save topics</button>
        </div>
      </Card>

      <Card title="Import from a calendar file">
        <p className="mb-3 text-sm text-zinc-500">Live calendar sync isn&apos;t connected. Export your calendar as an .ics file (Google Calendar: Settings › Import & export; Outlook: Save calendar) and import it here. Matching events come in as planned meetings only. They&apos;re scheduling evidence, not attendance. Importing the same file again won&apos;t add duplicates, and cancelled or removed events are taken off the plan.</p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          if (file.size > 1.8 * 1024 * 1024) { await run(async () => { throw new Error("That calendar file is too large. Export a shorter date range."); }); return; }
          const ics = await file.text();
          await run(() => postJson({ action: "import-calendar", ics, ...cal }), (r) => `Calendar imported: ${r.added ?? 0} added, ${r.updated ?? 0} updated, ${r.cancelled ?? 0} taken off the plan. All are planned only.`);
        }}>
          <label className={`${field} sm:col-span-2`}>Calendar file (.ics)<input className={input} type="file" accept=".ics,text/calendar" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label className={`${field} sm:col-span-2`}>Import events whose title contains (comma separated)<input className={input} value={cal.match} onChange={(e) => setCal({ ...cal, match: e.target.value })} /></label>
          <label className={field}>From<input className={input} type="date" value={cal.from} onChange={(e) => setCal({ ...cal, from: e.target.value })} /></label>
          <label className={field}>Through<input className={input} type="date" value={cal.through} onChange={(e) => setCal({ ...cal, through: e.target.value })} /></label>
          <div className="sm:col-span-2"><button className={`${buttonClass} min-h-11 lg:min-h-9`} disabled={busy || !file}>Import calendar</button></div>
        </form>
      </Card>
    </div>
  );
}
