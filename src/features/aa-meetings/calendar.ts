import ICAL from "ical.js";
import { TIME_ZONE, createMeeting, guessKind, validDate, type Meeting, type MeetingData } from "./model";

/*
 * Reads an exported calendar file (.ics). Only events whose title matches one
 * of the owner's terms are imported, always as planned meetings: a calendar
 * entry is scheduling evidence, never proof of attendance. Recurring series,
 * moved or cancelled occurrences, EXDATEs and each event's own time zone are
 * honored; times are stored as Eastern wall-clock time.
 */

export type CalendarImport = {
  meetings: Meeting[];
  /** Occurrences the file marks STATUS:CANCELLED. */
  cancelled: Set<string>;
  /** Every in-range occurrence the file still lists, for spotting ones it dropped. */
  seen: Set<string>;
  uids: Set<string>;
  from: string; through: string;
};

const validZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

// The instant at which a wall-clock time occurs in an IANA zone (two passes settle DST changes).
function zonedInstant(t: ICAL.Time, tz: string) {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
    guess += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return new Date(guess);
}

function easternParts(d: Date) {
  const f = (o: Intl.DateTimeFormatOptions, l: string) => new Intl.DateTimeFormat(l, { timeZone: TIME_ZONE, ...o }).format(d);
  return { date: f({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA"), time: f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "en-GB") };
}

function startParts(start: ICAL.Time, tzid: string | undefined): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = { date: `${start.year}-${pad(start.month)}-${pad(start.day)}`, time: `${pad(start.hour)}:${pad(start.minute)}` };
  if (start.isDate) return { date: wall.date, time: "" };
  const zone = start.zone?.tzid;
  if (zone === "UTC") return easternParts(start.toJSDate());
  if (tzid && validZone(tzid)) return easternParts(zonedInstant(start, tzid));
  if (zone && zone !== "floating") return easternParts(start.toJSDate()); // defined by the file's VTIMEZONE
  if (tzid) throw new Error(`The calendar uses the time zone "${tzid}" without defining it. Export it again with time zones included.`);
  return wall; // floating time: shown as written, which is local time
}

export function importCalendar(ics: string, match: string, from: string, through: string, now: string, id: () => string): CalendarImport {
  if (!validDate(from) || !validDate(through) || through < from) throw new Error("Choose the calendar import dates.");
  const terms = match.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!terms.length) throw new Error("Enter the meeting names to match, separated by commas.");
  let root: ICAL.Component;
  try { root = new ICAL.Component(ICAL.parse(ics)); } catch { throw new Error("That file isn't a readable calendar (.ics) file."); }
  if (root.name !== "vcalendar") throw new Error("That file isn't a readable calendar (.ics) file.");

  // The file's own time zone definitions, used while reading it and then removed again.
  const registered: string[] = [];
  for (const c of root.getAllSubcomponents("vtimezone")) {
    const tzid = String(c.getFirstPropertyValue("tzid") ?? "");
    if (tzid && !ICAL.TimezoneService.has(tzid)) { ICAL.TimezoneService.register(new ICAL.Timezone(c)); registered.push(tzid); }
  }
  const result: CalendarImport = { meetings: [], cancelled: new Set(), seen: new Set(), uids: new Set(), from, through };
  try {
    const components = root.getAllSubcomponents("vevent");
    let steps = 0;
    for (const component of components) {
      if (component.hasProperty("recurrence-id")) continue;
      const event = new ICAL.Event(component);
      const title = event.summary ?? "";
      if (!terms.some((t) => title.toLowerCase().includes(t))) continue;
      result.uids.add(event.uid);
      for (const exception of components.filter((c) => c.hasProperty("recurrence-id") && c.getFirstPropertyValue("uid") === event.uid)) event.relateException(new ICAL.Event(exception));
      const seriesCancelled = String(component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
      const iterator = event.iterator();
      for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
        if (++steps > 30000 || result.meetings.length >= 1000) throw new Error("This calendar is too large. Export a narrower date range.");
        const detail = event.getOccurrenceDetails(occurrence);
        const item = detail.item.component;
        const tzid = item.getFirstProperty("dtstart")?.getParameter("tzid") as string | undefined;
        const parts = startParts(detail.startDate, tzid);
        // Occurrences come in order of their original start; stop once well past the range.
        if (occurrence.toString().slice(0, 10) > through && parts.date > through) break;
        const sourceId = `${event.uid}#${occurrence.toString()}`;
        result.seen.add(sourceId);
        if (parts.date < from || parts.date > through) continue;
        if (seriesCancelled || String(item.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") { result.cancelled.add(sourceId); continue; }
        const summary = detail.item.summary || title;
        const minutes = Math.round((detail.endDate.toUnixTime() - detail.startDate.toUnixTime()) / 60);
        result.meetings.push(createMeeting({
          ...parts, name: summary, location: detail.item.location ?? "", kind: guessKind(summary), sourceId,
          minutes: !detail.startDate.isDate && minutes > 0 && minutes <= 720 ? minutes : null,
        }, id(), now, "calendar"));
        if (!event.isRecurring()) break;
      }
    }
  } finally {
    for (const tzid of registered) ICAL.TimezoneService.remove(tzid);
  }
  return result;
}

/**
 * Planned calendar entries to mark cancelled: ones the file cancels, plus
 * in-range occurrences of a series it still contains but no longer lists (an
 * EXDATE or a deleted occurrence).
 */
export function calendarCancellations(data: MeetingData, r: CalendarImport) {
  const out = new Set(r.cancelled);
  for (const m of data.meetings) {
    if (m.source !== "calendar" || !m.sourceId || m.date < r.from || m.date > r.through) continue;
    const uid = m.sourceId.slice(0, m.sourceId.lastIndexOf("#"));
    if (r.uids.has(uid) && !r.seen.has(m.sourceId)) out.add(m.sourceId);
  }
  return out;
}
