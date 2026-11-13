import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY, FIRST_TOPIC, appendMeetings, cancel, createMeeting, edit, normalize, plannedMeetings, reportMeetings, syncPlans, transition } from "./model";

// Times are UTC instants; 2026-11-12T23:00Z is 6:00 PM Eastern on Nov 12.
const now = "2026-11-12T23:00:00Z";
let n = 0; const id = () => `m${++n}`;

test("a new tracker seeds both recurring plans and the first discussion topic", () => {
  const d = normalize(null);
  assert.deepEqual(d.rules.map((r) => [r.name, r.weekday]), [["Right Turn Alumni", 0], ["Eldersburg Tuesday Night", 2]]);
  assert.deepEqual(d.topics, [FIRST_TOPIC]);
  assert.deepEqual(normalize({ ...EMPTY, topics: [] }).topics, [], "a cleared topic list stays cleared");
});

test("recurring plans create planned meetings only, never attendance, and never twice", () => {
  const r = plannedMeetings(structuredClone(EMPTY), "2026-11-01", "2026-11-14", now, id);
  assert.equal(r.added, 4); // two Sundays, two Tuesdays
  assert.ok(r.data.meetings.every((m) => m.state === "scheduled" && !m.confirmedAt));
  assert.equal(reportMeetings(r.data, "2026-11-01", "2026-11-14").length, 0);
  assert.equal(plannedMeetings(r.data, "2026-11-01", "2026-11-14", now, id).added, 0);
  // A plan entry removed by the owner isn't re-created.
  const removed = { ...r.data, meetings: r.data.meetings.map((m, i) => (i === 0 ? cancel(m, now) : m)) };
  assert.equal(plannedMeetings(removed, "2026-11-01", "2026-11-14", now, id).added, 0);
});

test("future meetings cannot be marked attended or missed; past ones can, in one step", () => {
  const later = createMeeting({ date: "2026-11-12", time: "19:00", name: "Tonight" }, "a", now);
  assert.throws(() => transition(later, "attended", now), /future/);
  assert.throws(() => transition(createMeeting({ date: "2026-11-13", name: "Tomorrow" }, "b", now), "missed", now), /future/);
  const earlier = transition(createMeeting({ date: "2026-11-12", time: "18:00", name: "Now" }, "c", now), "attended", now);
  assert.equal(earlier.state, "attended"); assert.equal(earlier.confirmedAt, now);
  assert.match(earlier.history.at(-1)!.action, /I attended/);
  const missed = transition(earlier, "missed", now);
  assert.equal(missed.confirmedAt, undefined);
  assert.throws(() => transition(earlier, "bogus" as never, now));
});

test("manual additions deduplicate, including a plan with no time against a timed entry", () => {
  const plan = createMeeting({ date: "2026-11-08", name: "Right Turn Alumni" }, "p", now, "recurring-plan");
  const d = { ...structuredClone(EMPTY), meetings: [plan] };
  assert.equal(appendMeetings(d, [createMeeting({ date: "2026-11-08", time: "18:00", name: "right turn  alumni" }, "x", now)]).added, 0);
  assert.equal(appendMeetings(d, [createMeeting({ date: "2026-11-09", name: "Right Turn Alumni" }, "y", now)]).added, 1);
  // Two meetings with the same name on one day at different times are different meetings.
  const timed = { ...d, meetings: [createMeeting({ date: "2026-11-08", time: "10:00", name: "Step" }, "s1", now)] };
  assert.equal(appendMeetings(timed, [createMeeting({ date: "2026-11-08", time: "19:00", name: "Step" }, "s2", now)]).added, 1);
});

test("edits persist with a dated change history; changing when it was clears attendance", () => {
  const base = transition(createMeeting({ date: "2026-11-10", time: "19:00", name: "Eldersburg Tuesday Night" }, "e", now), "attended", now);
  const t2 = "2026-11-12T23:30:00Z";
  const topic = edit(base, { ...base, topic: "What was the first thing you did?", minutes: 60 }, [base], t2);
  assert.equal(topic.state, "attended"); assert.equal(topic.minutes, 60);
  assert.equal(topic.history.at(-1)!.at, t2); assert.match(topic.history.at(-1)!.action, /duration blank → 60/);
  const moved = edit(topic, { ...topic, time: "19:30" }, [topic], t2);
  assert.equal(moved.state, "scheduled"); assert.equal(moved.confirmedAt, undefined);
  assert.match(moved.history.at(-1)!.action, /confirm again/);
  const note = edit(base, { ...base, note: "secret" }, [base], t2);
  assert.doesNotMatch(note.history.at(-1)!.action, /secret/, "private notes never appear in history");
  const other = createMeeting({ date: "2026-11-11", name: "Other" }, "o", now);
  assert.throws(() => edit(other, { ...other, date: "2026-11-10", name: "Eldersburg Tuesday Night", time: "19:00" }, [base, other], t2), /already/);
  assert.throws(() => edit(other, { ...other, date: "2026-02-30" }, [other], t2), /valid meeting date/);
  assert.throws(() => edit(other, { ...other, minutes: 9999 }, [other], t2), /Duration/);
});

test("reports include only owner-confirmed attendance of the chosen kinds", () => {
  const meetings = [
    transition(createMeeting({ date: "2026-11-01", name: "AA" }, "1", now), "attended", now),
    transition(createMeeting({ date: "2026-11-02", name: "IOP group", kind: "IOP" }, "2", now), "attended", now),
    transition(createMeeting({ date: "2026-11-03", name: "Skipped" }, "3", now), "missed", now),
    createMeeting({ date: "2026-11-04", name: "Planned" }, "4", now),
  ];
  const d = { ...structuredClone(EMPTY), meetings };
  assert.deepEqual(reportMeetings(d, "2026-11-01", "2026-11-30").map((m) => m.id), ["1"]);
  assert.deepEqual(reportMeetings(d, "2026-11-01", "2026-11-30", ["AA", "IOP"]).map((m) => m.id), ["1", "2"]);
  assert.throws(() => reportMeetings(d, "2026-11-30", "2026-11-01"));
});

test("changing a recurring plan updates only upcoming unanswered entries made from it", () => {
  const d = plannedMeetings(structuredClone(EMPTY), "2026-11-08", "2026-11-22", now, id).data; // Sundays 8, 15, 22; Tuesdays 10, 17
  const answered = { ...d, meetings: d.meetings.map((m) => (m.date === "2026-11-08" ? transition(m, "attended", now) : m)) };
  const rules = answered.rules.map((r) => (r.id === "sunday-alumni" ? { ...r, time: "18:00", minutes: 60 } : { ...r, enabled: false }));
  const synced = syncPlans(answered, rules, now);
  const by = (date: string) => synced.meetings.find((m) => m.date === date)!;
  assert.equal(by("2026-11-08").time, "", "a past, answered entry is untouched");
  assert.equal(by("2026-11-15").time, "18:00"); assert.equal(by("2026-11-22").minutes, 60);
  assert.ok(by("2026-11-17").cancelled, "a turned-off plan leaves upcoming entries off the plan");
  assert.match(by("2026-11-15").history.at(-1)!.action, /Recurring plan changed/);
});
