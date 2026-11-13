/*
 * AA meeting tracker data, kept as one private cloud document ("aa-meetings").
 *
 * A meeting is only ever "attended" because the owner said so, one meeting at
 * a time. Recurring plans and calendar imports create "scheduled" entries,
 * which are plans or scheduling evidence and never count toward a report.
 * Every date and time is wall-clock time in America/New_York.
 */

export const TIME_ZONE = "America/New_York";
export const FIRST_TOPIC = "What was the first thing you did when you felt tempted in your early days of recovery?";

export type Attendance = "scheduled" | "attended" | "missed";
export type Kind = "AA" | "IOP" | "Other";
export type Evidence = {
  id: string; name: string; type: string; size: number; sha256: string; uploadedAt: string;
  // Hidden from reports by the owner; the original bytes are kept unchanged.
  withdrawnAt?: string;
};
export type HistoryEntry = { at: string; action: string };

/** How a fact about attendance is known. "Host-verified" exists only for an imported Zoom host report (not built). */
export const SELF_REPORTED = "Self-reported";
export const ORGANIZER_EMAIL = "Organizer email confirmation";

export type AudioPart = { index: number; size: number; sha256: string };
export type AudioStatus = "awaiting-transcript" | "transcribed" | "no-audio" | "failed";
/** One audio file per meeting, recorded or imported by the owner, stored privately in parts. */
export type MeetingAudio = {
  id: string; source: "recording" | "import"; name: string; type: string; size: number; sha256: string; parts: AudioPart[];
  uploadedAt: string; status: AudioStatus;
  // Set by the Mac worker: a fixed result label, an optional technical reason, the takeaway and which engine wrote it.
  result?: string; reason?: string; takeaway?: string; takeawayEngine?: "local" | "claude"; hasTranscript?: boolean; processedAt?: string;
};
/** Join and leave times (Eastern HH:MM) from the owner's own Start/Stop or typed by hand. Always self-reported. */
export type SelfTimes = { joined: string; left: string; source: "recording" | "manual"; at: string };
export type ConfirmationFile = { id: string; name: string; type: string; size: number; sha256: string };
/** An organizer's confirmation email imported read-only from the owner's Gmail; the Gmail message id is the dedupe key. */
export type OrganizerConfirmation = {
  gmailId: string; subject: string; sender: string; date: string; body: string;
  attachments: ConfirmationFile[]; skippedAttachments: string[]; importedAt: string;
  matchedBy?: string; reviewReason?: string; dismissedAt?: string;
};
export type Meeting = {
  id: string; date: string; time: string; name: string; location: string;
  format: "in-person" | "online"; minutes: number | null; kind: Kind; state: Attendance;
  topic: string; note: string; source: "manual" | "recurring-plan" | "calendar"; sourceId?: string;
  cancelled?: boolean; confirmedAt?: string; createdAt: string; updatedAt: string;
  evidence: Evidence[]; history: HistoryEntry[];
  audio?: MeetingAudio; selfTimes?: SelfTimes; confirmations: OrganizerConfirmation[];
  // Off unless the owner turns it on for this meeting: the takeaway is otherwise written by the local model on the Mac.
  useClaudeTakeaway?: boolean;
  // Names the takeaway must never contain (other attendees). Private; never in reports.
  participants?: string[];
};
export type Rule = {
  id: string; name: string; weekday: number; time: string; location: string;
  format: "in-person" | "online"; minutes: number | null; kind: Kind; enabled: boolean;
};
export type Profile = { name: string; reportTitle: string; court: string; caseNumbers: string };
export type MeetingData = {
  version: 1; meetings: Meeting[]; rules: Rule[]; profile: Profile; topics: string[];
  // Organizer emails that matched no meeting, or more than one: the owner decides; nothing is guessed.
  needsReview: OrganizerConfirmation[];
};

const SEED_RULES: Rule[] = [
  { id: "sunday-alumni", name: "Right Turn Alumni", weekday: 0, time: "", location: "", format: "in-person", minutes: null, kind: "AA", enabled: true },
  { id: "tuesday-night", name: "Eldersburg Tuesday Night", weekday: 2, time: "", location: "Eldersburg", format: "in-person", minutes: null, kind: "AA", enabled: true },
];
export const EMPTY: MeetingData = {
  version: 1, meetings: [], rules: SEED_RULES, topics: [FIRST_TOPIC], needsReview: [],
  profile: { name: "", reportTitle: "AA Meeting Attendance Record", court: "", caseNumbers: "" },
};

const eastern = (now: Date, opts: Intl.DateTimeFormatOptions, locale = "en-CA") => new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...opts }).format(now);
export function easternToday(now = new Date()) {
  return eastern(now, { year: "numeric", month: "2-digit", day: "2-digit" });
}
export function easternTime(now = new Date()) {
  return eastern(now, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "en-GB");
}
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + "T12:00:00Z"))
    && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function dateLabel(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function timeLabel(time: string) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** True once the meeting's start (or its day, with no time) has arrived in Eastern time. */
export function hasStarted(m: Pick<Meeting, "date" | "time">, now = new Date()) {
  const today = easternToday(now);
  return m.date < today || (m.date === today && (!m.time || m.time <= easternTime(now)));
}

function text(value: unknown, max = 180) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
const kindOf = (v: unknown): Kind => (v === "IOP" || v === "Other" ? v : "AA");
const formatOf = (v: unknown) => (v === "online" ? "online" as const : "in-person" as const);
function minutesOf(v: unknown) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 720) throw new Error("Duration must be between 1 and 720 minutes, or blank.");
  return n;
}
function timeOf(v: unknown) {
  const time = text(v, 5);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Use a valid meeting time.");
  return time;
}

/** Guesses AA vs IOP from a calendar title. IOP is treatment, never counted as an AA meeting. */
export function guessKind(title: string): Kind {
  if (/\bIOP\b|intensive out-?patient/i.test(title)) return "IOP";
  return "AA";
}

function normalizeConfirmation(c: Partial<OrganizerConfirmation>): OrganizerConfirmation {
  return { ...(c as OrganizerConfirmation), attachments: Array.isArray(c.attachments) ? c.attachments : [], skippedAttachments: Array.isArray(c.skippedAttachments) ? c.skippedAttachments : [] };
}

function normalizeMeeting(raw: Partial<Meeting>): Meeting {
  return {
    ...(raw as Meeting), topic: typeof raw.topic === "string" ? raw.topic : "", kind: kindOf(raw.kind),
    note: typeof raw.note === "string" ? raw.note : "", time: typeof raw.time === "string" ? raw.time : "",
    location: typeof raw.location === "string" ? raw.location : "", format: formatOf(raw.format), minutes: raw.minutes ?? null,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map((e) => ({ ...e, size: Number(e.size) || 0 })) : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    confirmations: Array.isArray(raw.confirmations) ? raw.confirmations.map(normalizeConfirmation) : [],
    useClaudeTakeaway: raw.useClaudeTakeaway === true,
    participants: Array.isArray(raw.participants) ? raw.participants.filter((p) => typeof p === "string") : [],
  };
}
export function normalize(raw: unknown): MeetingData {
  if (!raw || typeof raw !== "object") return structuredClone(EMPTY);
  const d = raw as Partial<MeetingData>;
  return {
    version: 1,
    meetings: Array.isArray(d.meetings) ? d.meetings.map(normalizeMeeting) : [],
    rules: Array.isArray(d.rules) ? d.rules.map((r) => ({ ...SEED_RULES[0], ...r, kind: kindOf(r.kind), format: formatOf(r.format) })) : structuredClone(SEED_RULES),
    // Seeded once; after that the owner's list is kept as saved, even if emptied.
    topics: Array.isArray(d.topics) ? d.topics.filter((t) => typeof t === "string") : [FIRST_TOPIC],
    profile: { ...EMPTY.profile, ...d.profile },
    needsReview: Array.isArray(d.needsReview) ? d.needsReview.map(normalizeConfirmation) : [],
  };
}

export function meetingInput(raw: Record<string, unknown>) {
  if (!validDate(raw.date)) throw new Error("Choose a valid meeting date.");
  const name = text(raw.name); if (!name) throw new Error("Enter the meeting name.");
  return {
    date: raw.date, time: timeOf(raw.time), name, location: text(raw.location), format: formatOf(raw.format),
    minutes: minutesOf(raw.minutes), kind: kindOf(raw.kind), topic: text(raw.topic, 300),
    note: typeof raw.note === "string" ? raw.note.trim().slice(0, 4000) : "",
  };
}

export function ruleInput(raw: Record<string, unknown>, id: string): Rule {
  const name = text(raw.name); if (!name) throw new Error("Enter the plan's meeting name.");
  const weekday = Number(raw.weekday);
  if (raw.weekday === "" || raw.weekday == null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("Choose the plan's day of the week.");
  return { id, name, weekday, time: timeOf(raw.time), location: text(raw.location), format: formatOf(raw.format), minutes: minutesOf(raw.minutes), kind: kindOf(raw.kind), enabled: raw.enabled !== false };
}

const normName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Same meeting: same day and name, and the same time unless one of them has none yet. */
export function sameMeeting(a: Pick<Meeting, "date" | "name" | "time">, b: Pick<Meeting, "date" | "name" | "time">) {
  return a.date === b.date && normName(a.name) === normName(b.name) && (!a.time || !b.time || a.time === b.time);
}

export function createMeeting(raw: Record<string, unknown>, id: string, now: string, source: Meeting["source"] = "manual"): Meeting {
  const label = source === "manual" ? "Added by owner as planned" : source === "calendar" ? "Imported from a calendar file as planned (scheduling evidence only)" : "Created from a recurring plan";
  return { ...meetingInput(raw), id, source, sourceId: text(raw.sourceId, 500) || undefined, state: "scheduled", evidence: [], confirmations: [], history: [{ at: now, action: label }], createdAt: now, updatedAt: now };
}

const log = (m: Meeting, now: string, action: string): Meeting => ({ ...m, updatedAt: now, history: [...m.history, { at: now, action }].slice(-200) });

export function transition(m: Meeting, state: Attendance, now: string): Meeting {
  if (!["scheduled", "attended", "missed"].includes(state)) throw new Error("Choose an attendance status.");
  if (state !== "scheduled" && !hasStarted(m, new Date(now))) throw new Error(state === "attended" ? "A future meeting cannot be marked attended." : "A future meeting cannot be marked as missed yet.");
  if (state === m.state && !m.cancelled) return m;
  const action = state === "attended" ? "Owner confirmed: I attended" : state === "missed" ? "Owner recorded: did not attend" : "Owner reset to planned";
  return { ...log(m, now, action), state, cancelled: false, confirmedAt: state === "attended" ? now : undefined };
}

export function cancel(m: Meeting, now: string): Meeting {
  if (m.state !== "scheduled") throw new Error("Only a planned meeting can be removed from the plan.");
  if (m.cancelled) return m;
  return { ...log(m, now, "Owner removed this from the plan"), cancelled: true };
}

const FIELD_LABEL: Record<string, string> = { date: "date", time: "time", name: "name", location: "location", format: "format", minutes: "duration", kind: "type", topic: "topic", note: "private note" };
export function edit(m: Meeting, raw: Record<string, unknown>, others: Meeting[], now: string): Meeting {
  const fields = meetingInput(raw);
  const next = { ...m, ...fields };
  if (others.some((x) => x.id !== m.id && !x.cancelled && sameMeeting(x, next))) throw new Error("That meeting is already in your tracker.");
  const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => m[k] !== next[k]);
  if (!changed.length) return m;
  const shown = (k: string, v: unknown) => (k === "note" ? "(private)" : v === null || v === "" ? "blank" : String(v));
  const summary = changed.map((k) => `${FIELD_LABEL[k]} ${shown(k, m[k])} → ${shown(k, next[k])}`).join("; ");
  // Changing when or which meeting it was clears an attendance answer: it has to be confirmed again.
  const identity = changed.some((k) => k === "date" || k === "time" || k === "name");
  if (identity && m.state !== "scheduled") {
    return { ...log(next, now, `Owner edited ${summary}. Attendance answer cleared; confirm again.`), state: "scheduled", confirmedAt: undefined };
  }
  return log(next, now, `Owner edited ${summary}`);
}

/**
 * Adds meetings that aren't already tracked. A calendar entry for a meeting
 * that's already planned fills in a missing time or location instead.
 */
export function appendMeetings(data: MeetingData, incoming: Meeting[], now = new Date().toISOString()) {
  const meetings = [...data.meetings];
  const bySource = new Map(meetings.map((m, i) => [m.sourceId, i] as const).filter(([s]) => s));
  let added = 0, updated = 0;
  for (const m of incoming) {
    let i = m.sourceId ? bySource.get(m.sourceId) : undefined;
    i ??= meetings.findIndex((x) => !x.cancelled && sameMeeting(x, m));
    if (i < 0) {
      meetings.push(m); added++;
      if (m.sourceId) bySource.set(m.sourceId, meetings.length - 1);
      continue;
    }
    const cur = meetings[i];
    // Only a still-planned entry follows the calendar; owner answers are never overwritten.
    if (m.source !== "calendar" || cur.state !== "scheduled") continue;
    const fill: Partial<Meeting> = {};
    if (cur.source === "calendar" && cur.sourceId === m.sourceId) {
      for (const k of ["date", "time", "name", "location"] as const) if (cur[k] !== m[k]) fill[k] = m[k];
      if (cur.cancelled) fill.cancelled = false;
    } else {
      if (!cur.time && m.time) fill.time = m.time;
      if (!cur.location && m.location) fill.location = m.location;
    }
    const keys = Object.keys(fill);
    if (!keys.length) continue;
    meetings[i] = log({ ...cur, ...fill }, now, `Calendar import updated ${keys.join(", ")}`);
    updated++;
  }
  if (meetings.length > 10000) throw new Error("The tracker has reached 10,000 meetings. Export a backup before adding more.");
  return { data: { ...data, meetings }, added, updated };
}

/** Marks still-planned calendar entries as cancelled when the calendar file cancels them. */
export function applyCancellations(data: MeetingData, sourceIds: Set<string>, now: string) {
  let cancelled = 0;
  const meetings = data.meetings.map((m) => {
    if (!m.sourceId || !sourceIds.has(m.sourceId) || m.state !== "scheduled" || m.cancelled) return m;
    cancelled++;
    return { ...log(m, now, "Cancelled in the imported calendar"), cancelled: true };
  });
  return { data: { ...data, meetings }, cancelled };
}

export function plannedMeetings(data: MeetingData, from: string, through: string, now: string, id: () => string) {
  if (!validDate(from) || !validDate(through) || through < from || through > addDays(from, 93)) throw new Error("Choose a planning window of up to 93 days.");
  const incoming: Meeting[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) {
    for (const rule of data.rules.filter((r) => r.enabled && r.weekday === new Date(date + "T12:00:00Z").getUTCDay())) {
      const sourceId = `${rule.id}:${date}`;
      // A plan entry the owner already has (even one removed from the plan) is never re-created.
      if (data.meetings.some((m) => m.sourceId === sourceId)) continue;
      incoming.push(createMeeting({ date, name: rule.name, time: rule.time, location: rule.location, format: rule.format, minutes: rule.minutes, kind: rule.kind, sourceId }, id(), now, "recurring-plan"));
    }
  }
  return appendMeetings(data, incoming, now);
}

/**
 * After the owner changes the recurring plans, upcoming unanswered entries
 * made from a plan follow it: new details are filled in, and entries whose
 * plan was turned off, deleted or moved to another day leave the plan.
 * Past entries and anything already answered are left alone.
 */
export function syncPlans(data: MeetingData, rules: Rule[], now: string) {
  const at = new Date(now);
  const meetings = data.meetings.map((m) => {
    if (m.source !== "recurring-plan" || m.state !== "scheduled" || m.cancelled || !m.sourceId || hasStarted(m, at)) return m;
    const rule = rules.find((r) => m.sourceId!.startsWith(`${r.id}:`));
    if (!rule || !rule.enabled || rule.weekday !== new Date(m.date + "T12:00:00Z").getUTCDay()) return { ...log(m, now, "Recurring plan changed; removed from the plan"), cancelled: true };
    const fill: Partial<Meeting> = {};
    for (const k of ["name", "time", "location", "format", "minutes", "kind"] as const) if (m[k] !== rule[k]) (fill as Record<string, unknown>)[k] = rule[k];
    return Object.keys(fill).length ? log({ ...m, ...fill }, now, `Recurring plan changed: updated ${Object.keys(fill).join(", ")}`) : m;
  });
  return { ...data, rules, meetings };
}

/** Only meetings the owner explicitly confirmed as attended, within the range and of the chosen kinds. */
export function reportMeetings(data: MeetingData, from: string, through: string, kinds: Kind[] = ["AA"]) {
  if (!validDate(from) || !validDate(through) || through < from) throw new Error("Choose a valid report date range.");
  return data.meetings
    .filter((m) => m.state === "attended" && m.confirmedAt && !m.cancelled && kinds.includes(m.kind) && m.date >= from && m.date <= through)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}
