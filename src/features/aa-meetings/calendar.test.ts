import test from "node:test";
import assert from "node:assert/strict";
import { appendMeetings, applyCancellations, createMeeting, EMPTY, transition } from "./model";
import { calendarCancellations, importCalendar } from "./calendar";

// Synthetic calendar files only.
const now = "2026-11-12T23:00:00Z";
let n = 0; const id = () => `c${++n}`;
const ics = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const series = vevent("UID:alumni-1", "SUMMARY:Right Turn Alumni", "LOCATION:Room 2",
  // Weekly across the Nov 1 DST change, with one week removed and one moved.
  "DTSTART;TZID=America/New_York:20261025T180000", "DTEND;TZID=America/New_York:20261025T190000",
  "RRULE:FREQ=WEEKLY;COUNT=5", "EXDATE;TZID=America/New_York:20261108T180000");
const moved = vevent("UID:alumni-1", "RECURRENCE-ID;TZID=America/New_York:20261115T180000", "SUMMARY:Right Turn Alumni", "DTSTART;TZID=America/New_York:20261115T193000", "DTEND;TZID=America/New_York:20261115T203000");
const cancelled = vevent("UID:alumni-1", "RECURRENCE-ID;TZID=America/New_York:20261122T180000", "SUMMARY:Right Turn Alumni", "STATUS:CANCELLED", "DTSTART;TZID=America/New_York:20261122T180000");
const iop = vevent("UID:iop-1", "SUMMARY:Evening IOP group", "DTSTART:20261103T230000Z", "DTEND:20261104T020000Z");
const unrelated = vevent("UID:dentist", "SUMMARY:Dentist", "DTSTART:20261104T150000Z");

test("recurring events keep Eastern wall time across DST, honor EXDATE, moves and cancellations", () => {
  const r = importCalendar(ics(series, moved, cancelled, iop, unrelated), "alumni, IOP", "2026-10-01", "2026-12-31", now, id);
  const rows = r.meetings.map((m) => [m.date, m.time, m.name, m.kind, m.minutes]);
  assert.deepEqual(rows, [
    ["2026-10-25", "18:00", "Right Turn Alumni", "AA", 60],
    ["2026-11-01", "18:00", "Right Turn Alumni", "AA", 60],
    ["2026-11-15", "19:30", "Right Turn Alumni", "AA", 60],
    ["2026-11-03", "18:00", "Evening IOP group", "IOP", 180],
  ]);
  assert.ok(r.meetings.every((m) => m.state === "scheduled" && m.source === "calendar"), "a calendar never asserts attendance");
  assert.equal(r.cancelled.size, 1);
});

test("floating times and a time zone defined inside the file are both handled", () => {
  const vtz = ["BEGIN:VTIMEZONE", "TZID:Eastern Standard Time", "BEGIN:STANDARD", "DTSTART:16011104T020000", "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:16010311T020000", "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "END:DAYLIGHT", "END:VTIMEZONE"].join("\r\n");
  const outlook = vevent("UID:o1", "SUMMARY:Eldersburg Tuesday Night", "DTSTART;TZID=Eastern Standard Time:20261110T193000", "DTEND;TZID=Eastern Standard Time:20261110T203000");
  const floating = vevent("UID:f1", "SUMMARY:Eldersburg Tuesday Night", "DTSTART:20261117T193000");
  const r = importCalendar(ics(vtz, outlook, floating), "eldersburg", "2026-11-01", "2026-11-30", now, id);
  assert.deepEqual(r.meetings.map((m) => [m.date, m.time]), [["2026-11-10", "19:30"], ["2026-11-17", "19:30"]]);
  assert.throws(() => importCalendar(ics(vevent("UID:x", "SUMMARY:Eldersburg", "DTSTART;TZID=Nowhere Zone:20261110T193000")), "eldersburg", "2026-11-01", "2026-11-30", now, id), /time zone/);
  assert.throws(() => importCalendar("not a calendar", "x", "2026-11-01", "2026-11-30", now, id), /calendar/);
  assert.throws(() => importCalendar(ics(), "", "2026-11-01", "2026-11-30", now, id), /meeting names/);
});

test("re-importing is idempotent, follows calendar changes, and never touches owner answers", () => {
  const file = ics(series, moved, cancelled);
  const first = importCalendar(file, "alumni", "2026-10-01", "2026-12-31", now, id);
  let d = appendMeetings(structuredClone(EMPTY), first.meetings, now).data;
  assert.equal(d.meetings.length, 3);
  assert.equal(appendMeetings(d, importCalendar(file, "alumni", "2026-10-01", "2026-12-31", now, id).meetings, now).added, 0);

  // The owner confirms Oct 25; later the calendar drops Nov 1 and Oct 25 with a new EXDATE list.
  d = { ...d, meetings: d.meetings.map((m) => (m.date === "2026-10-25" ? transition(m, "attended", now) : m)) };
  const changed = ics(series.replace("EXDATE;TZID=America/New_York:20261108T180000", "EXDATE;TZID=America/New_York:20261025T180000,20261101T180000,20261108T180000"), moved, cancelled);
  const again = importCalendar(changed, "alumni", "2026-10-01", "2026-12-31", now, id);
  const c = applyCancellations(appendMeetings(d, again.meetings, now).data, calendarCancellations(d, again), now);
  assert.equal(c.cancelled, 1, "only the still-planned Nov 1 entry is cancelled");
  const oct25 = c.data.meetings.find((m) => m.date === "2026-10-25")!;
  assert.equal(oct25.state, "attended"); assert.ok(!oct25.cancelled);
  assert.ok(c.data.meetings.find((m) => m.date === "2026-11-01")!.cancelled);
});

test("an imported timed meeting fills in an untimed plan instead of counting twice", () => {
  const plan = createMeeting({ date: "2026-11-01", name: "Right Turn Alumni" }, "plan", now, "recurring-plan");
  const r = importCalendar(ics(series), "alumni", "2026-11-01", "2026-11-01", now, id);
  const merged = appendMeetings({ ...structuredClone(EMPTY), meetings: [plan] }, r.meetings, now);
  assert.equal(merged.added, 0); assert.equal(merged.updated, 1);
  assert.deepEqual(merged.data.meetings.map((m) => [m.id, m.time, m.location]), [["plan", "18:00", "Room 2"]]);
  assert.match(merged.data.meetings[0].history.at(-1)!.action, /Calendar import updated time, location/);
});
