import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbConfigured, readDoc, writeDoc } from "@/lib/db";
import { getKeys as getGoogleKeys } from "@/lib/gmail";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { billDatesBetween } from "@/features/money/calc";
import { graph, MicrosoftError, status as microsoftStatus } from "@/lib/microsoft";

/*
 * One calendar from three sources, each labeled where it came from:
 *
 *  - Google Calendar (read only). Reuses the Google OAuth client set up for
 *    Gmail, with its own sign-in that asks only for calendar.readonly. Its
 *    tokens are kept apart from Gmail's, and disconnecting it only forgets
 *    them here: revoking at Google would end the shared grant and stop
 *    Gmail's automatic bill scans too.
 *  - Gladiator's Outlook calendar (read and write) through the Gladiator
 *    Microsoft 365 connection in microsoft.ts. Teams meetings are Outlook
 *    events with a join link, so they appear once, on their event.
 *  - Bill due dates from the Financial Center, worked out from the saved
 *    bills each time, so refreshing never adds copies.
 *
 * Events are read when the page asks for a date range and are not stored.
 * Only title, time, place, calendar name and links reach the page.
 */

export type Source = "google" | "outlook" | "bill";

export type CalendarEvent = {
  id: string; // provider + account/calendar + provider event id: stable across refreshes
  source: Source;
  calendar: string;
  calendarId: string;
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day events
  end: string; // exclusive: an all-day event on the 5th ends on the 6th
  allDay: boolean;
  location: string;
  url: string;
  joinUrl?: string; // Teams or other online meeting
  recurring?: boolean;
  editable?: boolean; // Outlook events Gladiator owns
  amount?: number; // bills
  paid?: boolean; // bills: a date already past its due
};

export type CalendarInfo = { id: string; name: string; source: Source; account: string; canEdit: boolean };
export type Health = { ok: boolean; at: string | null; lastSuccess: string | null; error: string | null };

export const MAX_RANGE_DAYS = 62;
const MAX_EVENTS_PER_CALENDAR = 1000;

export class CalendarError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/* ---- Google Calendar sign-in (read only) ---- */

type Keys = { clientId: string; secret: string };
type Tokens = { access: string; accessExpires: number; refresh: string; scope: string };
type Connection = { sealed: string; email: string; connectedAt: string };

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_DOC = "calendar-google-connection";
const HEALTH_DOC = "calendar-health";

const sealKey = () => createHash("sha256").update(`maverick-calendar:${process.env.APP_PASSWORD}`).digest();

function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function unseal<T>(sealed: string): T {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", sealKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as T;
}

async function put(key: string, update: (current: unknown) => unknown) {
  for (let i = 0; i < 3; i++) {
    const current = await readDoc(key);
    if ((await writeDoc(key, current?.rev ?? 0, update(current?.data ?? null))).ok) return;
  }
  throw new CalendarError("Couldn't save to the database. Try again.", 503);
}

function needDb() {
  if (!dbConfigured()) throw new CalendarError("Calendars need the online database, which isn't set up.", 503);
}

export const googleRedirectUri = (origin: string) => `${origin}/api/calendar/google/callback`;
const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const googleKeys = (): Promise<Keys | null> => getGoogleKeys();

export function googleAuthorizeUrl(keys: Keys, origin: string, state: string, verifier: string) {
  const q = new URLSearchParams({
    client_id: keys.clientId,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    redirect_uri: googleRedirectUri(origin),
    state,
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH}?${q}`;
}

async function googleToken(keys: Keys, form: Record<string, string>): Promise<Tokens> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: keys.clientId, client_secret: keys.secret, ...form }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (json.error === "invalid_client") throw new CalendarError("Google didn't accept the client ID or secret.", 400);
    if (json.error === "invalid_grant") throw new CalendarError("Google signed Maverick out of Google Calendar. Press Connect Google Calendar again.", 401);
    throw new CalendarError(`Google sign-in failed (${String(json.error ?? res.status)}).`, 502);
  }
  return {
    access: String(json.access_token),
    accessExpires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    refresh: json.refresh_token ? String(json.refresh_token) : "",
    scope: String(json.scope ?? ""),
  };
}

async function readGoogle(): Promise<{ conn: Connection; tokens: Tokens } | null> {
  if (!dbConfigured()) return null;
  const conn = (await readDoc(GOOGLE_DOC))?.data as Connection | null;
  if (!conn?.sealed) return null;
  try {
    return { conn, tokens: unseal<Tokens>(conn.sealed) };
  } catch {
    return null;
  }
}

const saveGoogle = (tokens: Tokens, email: string, connectedAt: string) => put(GOOGLE_DOC, () => ({ sealed: seal(tokens), email, connectedAt }) satisfies Connection);

async function googleApi<T>(tokens: Tokens, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GOOGLE_API}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${tokens.access}` }, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) throw new CalendarError("Google signed Maverick out of Google Calendar. Press Connect Google Calendar again.", 401);
    if (res.status === 403) throw new CalendarError("Google refused calendar access. The Google Calendar API may need turning on in the Maverick Google Cloud project.", 403);
    if (res.status === 410) throw new CalendarError("Google's calendar list changed while reading. Refresh.", 409);
    throw new CalendarError(`Google Calendar didn't answer (${res.status}). Try again.`, 502);
  }
}

export async function finishGoogle(origin: string, code: string, verifier: string) {
  needDb();
  const keys = await googleKeys();
  if (!keys) throw new CalendarError("Set up Gmail's Google keys first.");
  const t = await googleToken(keys, { grant_type: "authorization_code", code, redirect_uri: googleRedirectUri(origin), code_verifier: verifier });
  if (!t.scope.split(" ").includes(GOOGLE_SCOPE)) throw new CalendarError("Google didn't give permission to read your calendar. Connect again and tick the calendar box.");
  if (!t.refresh) throw new CalendarError("Google didn't give a lasting sign-in. Connect again.");
  const primary = await googleApi<{ id?: string }>(t, "/calendars/primary").catch(() => ({}) as { id?: string });
  await saveGoogle(t, primary.id ?? "", new Date().toISOString());
}

async function googleTokens() {
  const keys = await googleKeys();
  if (!keys) throw new CalendarError("Google keys aren't set up.", 409);
  const found = await readGoogle();
  if (!found) throw new CalendarError("Google Calendar isn't connected.", 409);
  const { conn, tokens } = found;
  if (tokens.accessExpires - Date.now() > 60_000) return { tokens, email: conn.email };
  const t = await googleToken(keys, { grant_type: "refresh_token", refresh_token: tokens.refresh });
  const next: Tokens = { ...t, refresh: t.refresh || tokens.refresh, scope: t.scope || tokens.scope };
  await saveGoogle(next, conn.email, conn.connectedAt);
  return { tokens: next, email: conn.email };
}

/**
 * Forgets the Google Calendar sign-in here only. Not revoked at Google: the
 * grant is shared with Gmail on the same Google client, and revoking it would
 * stop Gmail's automatic scans. Remove access entirely at myaccount.google.com.
 */
export async function disconnectGoogle() {
  if (dbConfigured()) await put(GOOGLE_DOC, () => ({}));
}

/* ---- Health ---- */

type HealthDoc = Partial<Record<"google" | "outlook", Health>>;

async function readHealth(): Promise<HealthDoc> {
  if (!dbConfigured()) return {};
  return (((await readDoc(HEALTH_DOC))?.data as HealthDoc | null) ?? {}) as HealthDoc;
}

async function recordHealth(update: HealthDoc) {
  const at = new Date().toISOString();
  await put(HEALTH_DOC, (current) => {
    const next = { ...((current as HealthDoc | null) ?? {}) };
    for (const [k, h] of Object.entries(update) as ["google" | "outlook", Health][]) {
      next[k] = { ok: h.ok, at, error: h.ok ? null : h.error, lastSuccess: h.ok ? at : (next[k]?.lastSuccess ?? null) };
    }
    return next;
  }).catch(() => undefined); // health is a convenience; never fail a read over it
}

export async function status() {
  const [keys, google, ms, health] = await Promise.all([googleKeys().catch(() => null), readGoogle().catch(() => null), microsoftStatus().catch(() => null), readHealth().catch(() => ({}) as HealthDoc)]);
  return {
    database: dbConfigured(),
    google: { keys: Boolean(keys), connected: Boolean(google), email: google?.conn.email || null, connectedAt: google?.conn.connectedAt ?? null, health: health.google ?? null },
    outlook: {
      keys: Boolean(ms?.keys),
      connected: Boolean(ms?.connected),
      email: ms?.email ?? null,
      account: ms?.account ?? null,
      connectedAt: ms?.connectedAt ?? null,
      missing: ms?.missing ?? [],
      health: health.outlook ?? null,
    },
  };
}

/* ---- Reading ---- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function checkRange(from: unknown, to: unknown) {
  if (typeof from !== "string" || typeof to !== "string" || !YMD.test(from) || !YMD.test(to)) throw new CalendarError("Pick a date range.");
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) throw new CalendarError("Pick a date range.");
  if ((b - a) / 86_400_000 + 1 > MAX_RANGE_DAYS) throw new CalendarError(`Pick ${MAX_RANGE_DAYS} days or fewer.`);
  return { from, to };
}

// Widen by a day each side so no time zone cuts off an event; the page places events on its own days.
export function bounds(from: string, to: string) {
  return {
    min: new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString(),
    max: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString(),
  };
}

const addDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type GoogleCalendar = { id: string; summary?: string; summaryOverride?: string; selected?: boolean; hidden?: boolean; deleted?: boolean };
export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export function fromGoogle(account: string, cal: { id: string; name: string }, e: GoogleEvent): CalendarEvent | null {
  if (e.status === "cancelled") return null; // includes cancelled single occurrences of a recurring event
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime ?? e.start?.date;
  const end = e.end?.dateTime ?? e.end?.date ?? start;
  if (!start || !end) return null;
  return {
    id: `google:${account}:${cal.id}:${e.id}`,
    source: "google",
    calendar: cal.name,
    calendarId: `google:${account}:${cal.id}`,
    title: e.summary?.trim() || "(No title)",
    start: allDay ? start : new Date(start).toISOString(),
    end: allDay ? end : new Date(end).toISOString(),
    allDay,
    location: e.location?.trim() ?? "",
    url: e.htmlLink ?? "",
    joinUrl: e.hangoutLink || undefined,
    recurring: Boolean(e.recurringEventId),
  };
}

async function googleEvents(from: string, to: string) {
  const { tokens, email } = await googleTokens();
  const account = email || "google";
  const list = await googleApi<{ items?: GoogleCalendar[] }>(tokens, "/users/me/calendarList?minAccessRole=reader&maxResults=250");
  const cals = (list.items ?? []).filter((c) => c.selected !== false && !c.hidden && !c.deleted).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || "Calendar" }));
  const { min, max } = bounds(from, to);
  const events: CalendarEvent[] = [];
  for (const cal of cals) {
    let pageToken = "";
    let count = 0;
    do {
      // singleEvents expands recurring series into occurrences, with moved and cancelled exceptions applied.
      const q = new URLSearchParams({ timeMin: min, timeMax: max, singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: "nextPageToken,items(id,status,summary,location,htmlLink,hangoutLink,recurringEventId,start,end)" });
      if (pageToken) q.set("pageToken", pageToken);
      const page = await googleApi<{ items?: GoogleEvent[]; nextPageToken?: string }>(tokens, `/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      for (const e of page.items ?? []) {
        const ev = fromGoogle(account, cal, e);
        if (ev) events.push(ev);
      }
      count += page.items?.length ?? 0;
      pageToken = page.nextPageToken ?? "";
    } while (pageToken && count < MAX_EVENTS_PER_CALENDAR);
  }
  const calendars: CalendarInfo[] = cals.map((c) => ({ id: `google:${account}:${c.id}`, name: c.name, source: "google", account, canEdit: false }));
  return { calendars, events };
}

type OutlookCalendar = { id: string; name?: string; canEdit?: boolean; isDefaultCalendar?: boolean };
export type OutlookEvent = {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  type?: string; // singleInstance, occurrence, exception, seriesMaster
  webLink?: string;
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
};

// Graph returns "2026-10-25T14:00:00.0000000" in the zone asked for (UTC here).
export const graphUtc = (s: string) => new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).toISOString();

export function fromOutlook(account: string, cal: { id: string; name: string; canEdit: boolean }, e: OutlookEvent): CalendarEvent | null {
  if (e.isCancelled || !e.start?.dateTime || !e.end?.dateTime) return null;
  const allDay = Boolean(e.isAllDay);
  return {
    id: `outlook:${account}:${cal.id}:${e.id}`,
    source: "outlook",
    calendar: cal.name,
    calendarId: `outlook:${account}:${cal.id}`,
    title: e.subject?.trim() || "(No title)",
    // All-day events run midnight to midnight; keep just the dates, like Google.
    start: allDay ? e.start.dateTime.slice(0, 10) : graphUtc(e.start.dateTime),
    end: allDay ? e.end.dateTime.slice(0, 10) : graphUtc(e.end.dateTime),
    allDay,
    location: e.location?.displayName?.trim() ?? "",
    url: e.webLink ?? "",
    joinUrl: e.onlineMeeting?.joinUrl || undefined,
    recurring: e.type === "occurrence" || e.type === "exception",
    editable: cal.canEdit && e.isOrganizer !== false,
  };
}

async function outlookEvents(from: string, to: string, account: string) {
  const list = await graph<{ value?: OutlookCalendar[] }>("/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100");
  const cals = (list.value ?? []).map((c) => ({ id: c.id, name: c.name || "Calendar", canEdit: Boolean(c.canEdit), isDefault: Boolean(c.isDefaultCalendar) }));
  const { min, max } = bounds(from, to);
  const events: CalendarEvent[] = [];
  for (const cal of cals) {
    // calendarView expands recurring series into occurrences and exceptions.
    let url: string | undefined =
      `/me/calendars/${encodeURIComponent(cal.id)}/calendarView?` +
      new URLSearchParams({ startDateTime: min, endDateTime: max, $select: "id,subject,isAllDay,isCancelled,isOrganizer,type,webLink,location,onlineMeeting,start,end", $orderby: "start/dateTime", $top: "250" });
    let count = 0;
    while (url && count < MAX_EVENTS_PER_CALENDAR) {
      const page: { value?: OutlookEvent[]; "@odata.nextLink"?: string } = await graph(url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      for (const e of page.value ?? []) {
        const ev = fromOutlook(account, cal, e);
        if (ev) events.push(ev);
      }
      count += page.value?.length ?? 0;
      url = page["@odata.nextLink"];
    }
  }
  const calendars: CalendarInfo[] = cals
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    .map((c) => ({ id: `outlook:${account}:${c.id}`, name: c.name, source: "outlook", account, canEdit: c.canEdit }));
  return { calendars, events };
}

/** Bill due dates from the Financial Center; ids are bill + date, so the same bill never appears twice. */
export function billEvents(data: unknown, from: string, to: string): CalendarEvent[] {
  const money = asMoney(data);
  const out: CalendarEvent[] = [];
  for (const bill of money.bills ?? []) {
    if (!bill.nextDue) continue;
    const seen = new Set<string>();
    for (const d of billDatesBetween(bill, from, to)) {
      if (seen.has(d.date)) continue;
      seen.add(d.date);
      out.push({
        id: `bill:${bill.id}:${d.date}`,
        source: "bill",
        calendar: "Bills",
        calendarId: "bill",
        title: bill.name,
        start: d.date,
        end: addDay(d.date, 1),
        allDay: true,
        location: "",
        url: bill.url ?? "",
        amount: bill.amount,
        paid: d.paid,
      });
    }
  }
  return out;
}

/** Everything in the range. A source that fails says so; it never comes back as an empty calendar. */
export async function events(from: string, to: string) {
  const range = checkRange(from, to);
  needDb();
  const s = await status();
  const calendars: CalendarInfo[] = [{ id: "bill", name: "Bills", source: "bill", account: "Financial Center", canEdit: false }];
  const all: CalendarEvent[] = [];
  const errors: Partial<Record<Source, string>> = {};
  const health: HealthDoc = {};
  const jobs: Promise<void>[] = [
    readDoc(MONEY_DOC).then(
      (doc) => void all.push(...billEvents(doc?.data ?? null, range.from, range.to)),
      () => void (errors.bill = "Bills couldn't be read. Try again."),
    ),
  ];
  if (s.google.connected) {
    jobs.push(
      googleEvents(range.from, range.to).then(
        (r) => {
          calendars.push(...r.calendars);
          all.push(...r.events);
          health.google = { ok: true, at: null, lastSuccess: null, error: null };
        },
        (e) => {
          errors.google = e instanceof CalendarError ? e.message : "Google Calendar couldn't be read. Try again.";
          if (!(e instanceof CalendarError)) console.error("calendar google", (e as Error)?.name ?? "error");
          health.google = { ok: false, at: null, lastSuccess: null, error: errors.google };
        },
      ),
    );
  }
  if (s.outlook.connected) {
    jobs.push(
      outlookEvents(range.from, range.to, s.outlook.email ?? "gladiator").then(
        (r) => {
          calendars.push(...r.calendars);
          all.push(...r.events);
          health.outlook = { ok: true, at: null, lastSuccess: null, error: null };
        },
        (e) => {
          errors.outlook = e instanceof MicrosoftError || e instanceof CalendarError ? e.message : "Outlook calendar couldn't be read. Try again.";
          if (!(e instanceof MicrosoftError || e instanceof CalendarError)) console.error("calendar outlook", (e as Error)?.name ?? "error");
          health.outlook = { ok: false, at: null, lastSuccess: null, error: errors.outlook };
        },
      ),
    );
  }
  await Promise.all(jobs);
  if (Object.keys(health).length) await recordHealth(health);
  // Same provider id twice (a calendar shared into two lists) shows once.
  const unique = [...new Map(all.map((e) => [e.id, e])).values()];
  unique.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const latest = await status().catch(() => s);
  return { range, calendars, events: unique, errors, status: latest };
}

/* ---- Writing (Gladiator's Outlook calendar only, always from a preview) ---- */

export type EventDraft = {
  calendarId: string; // "outlook:<account>:<id>"
  title: string;
  start: string; // local date-time "YYYY-MM-DDTHH:mm" or date "YYYY-MM-DD" for all day
  end: string;
  timeZone: string; // IANA, from the browser
  allDay: boolean;
  location: string;
  teams: boolean; // add a Teams meeting link
};

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function checkDraft(raw: unknown): EventDraft {
  const d = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const draft: EventDraft = {
    calendarId: str(d.calendarId, 400),
    title: str(d.title, 255),
    start: str(d.start, 16),
    end: str(d.end, 16),
    timeZone: str(d.timeZone, 64) || "America/New_York",
    allDay: d.allDay === true,
    location: str(d.location, 255),
    teams: d.teams === true,
  };
  if (!draft.calendarId.startsWith("outlook:")) throw new CalendarError("Only the Gladiator Outlook calendar can be changed from Maverick.");
  if (!draft.title) throw new CalendarError("Give the event a title.");
  const shape = draft.allDay ? YMD : LOCAL;
  if (!shape.test(draft.start) || !shape.test(draft.end)) throw new CalendarError("Pick a start and end.");
  if (draft.allDay ? draft.end <= draft.start : draft.end <= draft.start) throw new CalendarError("The end has to be after the start.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: draft.timeZone });
  } catch {
    throw new CalendarError("Unknown time zone.");
  }
  return draft;
}

/** Microsoft Graph's event body for a draft. All-day events run midnight to midnight. */
export function graphEventBody(d: EventDraft) {
  const at = (v: string) => (d.allDay ? `${v}T00:00:00` : `${v}:00`);
  return {
    subject: d.title,
    isAllDay: d.allDay,
    start: { dateTime: at(d.start), timeZone: d.timeZone },
    end: { dateTime: at(d.end), timeZone: d.timeZone },
    location: { displayName: d.location },
    ...(d.teams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
}

function outlookIds(calendarId: string, eventId?: string) {
  const [source, , ...rest] = calendarId.split(":");
  const calId = rest.join(":");
  if (source !== "outlook" || !calId) throw new CalendarError("Only the Gladiator Outlook calendar can be changed from Maverick.");
  if (eventId !== undefined) {
    const prefix = `${calendarId}:`;
    if (!eventId.startsWith(prefix) || eventId.length <= prefix.length) throw new CalendarError("That event isn't on the Gladiator Outlook calendar.");
    return { calId, evId: eventId.slice(prefix.length) };
  }
  return { calId, evId: "" };
}

async function confirmedAccount() {
  const s = await microsoftStatus();
  if (!s.connected || !s.email) throw new CalendarError("Connect Gladiator 365 first.", 409);
  return s.email;
}

function ownCalendar(calendarId: string, account: string) {
  if (calendarId.split(":")[1] !== account) throw new CalendarError(`That calendar isn't ${account}'s.`);
}

export async function createEvent(raw: unknown) {
  const d = checkDraft(raw);
  const account = await confirmedAccount();
  ownCalendar(d.calendarId, account);
  const { calId } = outlookIds(d.calendarId);
  const made = await graph<{ id: string; webLink?: string }>(`/me/calendars/${encodeURIComponent(calId)}/events`, { method: "POST", body: JSON.stringify(graphEventBody(d)) });
  return { id: `${d.calendarId}:${made.id}`, url: made.webLink ?? "" };
}

export async function updateEvent(eventId: unknown, raw: unknown) {
  const d = checkDraft(raw);
  const account = await confirmedAccount();
  ownCalendar(d.calendarId, account);
  const { evId } = outlookIds(d.calendarId, String(eventId ?? ""));
  const body = graphEventBody(d);
  if (!d.teams) delete (body as Record<string, unknown>).isOnlineMeeting; // never remove an existing meeting link by omission
  await graph(`/me/events/${encodeURIComponent(evId)}`, { method: "PATCH", body: JSON.stringify(body) });
  return { ok: true };
}

/** Cancels an event Gladiator organizes: attendees get Microsoft's cancellation notice with the note. */
export async function cancelEvent(calendarId: unknown, eventId: unknown, comment: unknown) {
  const cal = String(calendarId ?? "");
  const account = await confirmedAccount();
  ownCalendar(cal, account);
  const { evId } = outlookIds(cal, String(eventId ?? ""));
  await graph(`/me/events/${encodeURIComponent(evId)}/cancel`, { method: "POST", body: JSON.stringify({ comment: typeof comment === "string" ? comment.slice(0, 1000) : "" }) });
  return { ok: true };
}
