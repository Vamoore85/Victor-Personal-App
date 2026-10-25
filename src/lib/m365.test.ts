import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, checkPreview, previewToken } from "./write-preview";
import { allowedPath, isGladiatorAccount, missingScopes, GRAPH } from "./microsoft";
import { billEvents, checkDraft, fromGoogle, fromOutlook, graphEventBody, graphUtc } from "./calendar";
import { checkCompose, cleanSearch, safeNextLink } from "./outlook-mail";
import { checkPost, plainText, toMessage } from "./teams";
import { byDay, daysCovered } from "@/features/calendar/days";

// Made-up accounts, events and messages. Nothing here calls Microsoft or Google.
process.env.APP_PASSWORD ||= "test-only";

test("a preview token only fits the exact payload it was made for, for ten minutes", () => {
  const p = { from: "a@x.example", compose: { to: ["b@x.example"], body: "Hi" } };
  const t = previewToken("mail", p, 1_000);
  assert.equal(checkPreview("mail", p, t, 2_000), true);
  assert.equal(checkPreview("mail", { compose: { body: "Hi", to: ["b@x.example"] }, from: "a@x.example" }, t, 2_000), true, "key order doesn't matter");
  assert.equal(checkPreview("mail", { ...p, compose: { ...p.compose, body: "Hi!" } }, t, 2_000), false, "a changed body needs a new preview");
  assert.equal(checkPreview("mail", { ...p, compose: { ...p.compose, to: ["c@x.example"] } }, t, 2_000), false, "a changed recipient needs a new preview");
  assert.equal(checkPreview("teams", p, t, 2_000), false, "a mail preview can't post in Teams");
  assert.equal(checkPreview("mail", p, t, 1_000 + 10 * 60 * 1000 + 1), false, "expired");
  assert.equal(checkPreview("mail", p, "123.abc", 2_000), false);
  assert.equal(checkPreview("mail", p, undefined, 2_000), false);
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
});

test("Graph calls stay on the signed-in account's own data", () => {
  assert.equal(allowedPath("/me/messages?$top=5"), true);
  assert.equal(allowedPath(`${GRAPH}/me/mailFolders/inbox/messages`), true);
  assert.equal(allowedPath("/chats/19:abc@thread.v2/messages"), true);
  assert.equal(allowedPath("/teams/t1/channels/c1/messages"), true);
  assert.equal(allowedPath("/users/someone@x.example/messages"), false);
  assert.equal(allowedPath("/meeting"), false);
  assert.equal(allowedPath("/chats"), false);
  assert.equal(allowedPath("https://evil.example/me/messages"), false);
  assert.equal(allowedPath(`${GRAPH}/users/x/events`), false);
});

test("only the Gladiator account is accepted, and missing permissions are named", () => {
  assert.equal(isGladiatorAccount({ mail: "Vic@GladiatorEmergence.com" }), true);
  assert.equal(isGladiatorAccount({ mail: null, userPrincipalName: "vic@gladiatoremergence.com" }), true);
  assert.equal(isGladiatorAccount({ mail: "other@gladiatoremergence.com", userPrincipalName: "other@gladiatoremergence.com" }), false);
  assert.deepEqual(missingScopes("https://graph.microsoft.com/User.Read Mail.ReadWrite mail.send"), ["Calendars.ReadWrite"]);
  assert.deepEqual(missingScopes("User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite"), []);
});

test("Google events: stable ids, all-day dates kept, cancelled occurrences dropped", () => {
  const cal = { id: "primary", name: "Home" };
  const timed = fromGoogle("me@x.example", cal, { id: "e1_20261102", recurringEventId: "e1", summary: " Gym ", start: { dateTime: "2026-11-02T07:00:00-05:00" }, end: { dateTime: "2026-11-02T08:00:00-05:00" } });
  assert.equal(timed?.id, "google:me@x.example:primary:e1_20261102");
  assert.equal(timed?.start, "2026-11-02T12:00:00.000Z");
  assert.equal(timed?.title, "Gym");
  assert.equal(timed?.recurring, true);
  const allDay = fromGoogle("me@x.example", cal, { id: "e2", start: { date: "2026-11-03" }, end: { date: "2026-11-05" } });
  assert.deepEqual([allDay?.allDay, allDay?.start, allDay?.end, allDay?.title], [true, "2026-11-03", "2026-11-05", "(No title)"]);
  assert.equal(fromGoogle("me@x.example", cal, { id: "e3", status: "cancelled", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } }), null);
});

test("Outlook events: UTC times, Teams join link, cancelled skipped, edit only as organizer", () => {
  const cal = { id: "AAMk", name: "Calendar", canEdit: true };
  const e = fromOutlook("vic@x.example", cal, {
    id: "ev1",
    subject: "Crew sync",
    type: "occurrence",
    isOrganizer: false,
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" },
    start: { dateTime: "2026-11-02T14:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-11-02T14:30:00.0000000", timeZone: "UTC" },
  });
  assert.equal(e?.id, "outlook:vic@x.example:AAMk:ev1");
  assert.equal(e?.start, "2026-11-02T14:00:00.000Z");
  assert.equal(e?.joinUrl, "https://teams.microsoft.com/l/meetup-join/x");
  assert.equal(e?.recurring, true);
  assert.equal(e?.editable, false);
  const allDay = fromOutlook("vic@x.example", cal, { id: "ev2", isAllDay: true, start: { dateTime: "2026-11-03T00:00:00.0000000" }, end: { dateTime: "2026-11-04T00:00:00.0000000" } });
  assert.deepEqual([allDay?.start, allDay?.end], ["2026-11-03", "2026-11-04"]);
  assert.equal(fromOutlook("vic@x.example", cal, { id: "ev3", isCancelled: true, start: { dateTime: "2026-11-03T00:00:00" }, end: { dateTime: "2026-11-03T01:00:00" } }), null);
  assert.equal(graphUtc("2026-11-02T14:00:00+01:00"), "2026-11-02T13:00:00.000Z");
});

test("bill due dates appear once per bill and date, however often the calendar refreshes", () => {
  const data = {
    bills: [
      { id: "b1", name: "Phone", amount: 50, category: "x", frequency: "monthly", nextDue: "2026-11-05", dueDay: 5, accountId: "", autopay: false, url: "", scope: "personal" },
      { id: "b2", name: "No date", amount: 5, category: "x", frequency: "monthly", nextDue: "", dueDay: 1, accountId: "", autopay: false, url: "", scope: "personal" },
    ],
  };
  const a = billEvents(data, "2026-11-01", "2026-12-31");
  const b = billEvents(data, "2026-11-01", "2026-12-31");
  assert.deepEqual(a.map((e) => e.id), ["bill:b1:2026-11-05", "bill:b1:2026-12-05"]);
  assert.deepEqual(a, b);
  assert.equal(a[0].end, "2026-11-06");
  assert.equal(a[0].source, "bill");
});

test("event drafts: Outlook only, end after start, real time zone; Teams link on request", () => {
  const base = { calendarId: "outlook:vic@x.example:AAMk", title: "Visit", start: "2026-11-02T09:00", end: "2026-11-02T10:00", timeZone: "America/New_York" };
  const d = checkDraft({ ...base, teams: true });
  const body = graphEventBody(d);
  assert.deepEqual(body.start, { dateTime: "2026-11-02T09:00:00", timeZone: "America/New_York" });
  assert.equal(body.isOnlineMeeting, true);
  assert.equal("isOnlineMeeting" in graphEventBody(checkDraft(base)), false);
  assert.deepEqual(graphEventBody(checkDraft({ ...base, allDay: true, start: "2026-11-02", end: "2026-11-03" })).end, { dateTime: "2026-11-03T00:00:00", timeZone: "America/New_York" });
  assert.throws(() => checkDraft({ ...base, calendarId: "google:me:primary" }), /Only the Gladiator Outlook calendar/);
  assert.throws(() => checkDraft({ ...base, end: "2026-11-02T08:00" }), /after the start/);
  assert.throws(() => checkDraft({ ...base, timeZone: "Mars/Base" }), /time zone/);
  assert.throws(() => checkDraft({ ...base, title: " " }), /title/);
});

test("emails: checked addresses, required fields, no injected search or next-page links", () => {
  const c = checkCompose({ mode: "new", to: "A@x.example; b@x.example, a@x.example", cc: "", subject: " Hello ", body: "Hi\r\nthere" });
  assert.deepEqual(c.to, ["a@x.example", "b@x.example"]);
  assert.equal(c.subject, "Hello");
  assert.equal(c.body, "Hi\nthere");
  assert.throws(() => checkCompose({ mode: "new", to: "not-an-address", subject: "s", body: "b" }), /isn't an email address/);
  assert.throws(() => checkCompose({ mode: "new", to: "a@x.example", subject: "", body: "b" }), /subject/);
  assert.throws(() => checkCompose({ mode: "reply", replyTo: "bad id", body: "b" }), /reply to/);
  assert.equal(checkCompose({ mode: "reply", replyTo: "AAMkADExample123=", body: "ok" }).to.length, 0);
  assert.throws(() => checkCompose({ mode: "new", to: Array.from({ length: 51 }, (_, i) => `p${i}@x.example`), subject: "s", body: "b" }), /50/);
  assert.equal(cleanSearch('invoice" OR \\x'), "invoice OR x");
  assert.equal(safeNextLink(`${GRAPH}/me/messages?$skip=25`), `${GRAPH}/me/messages?$skip=25`);
  assert.equal(safeNextLink(`${GRAPH}/users/x/messages`), null);
  assert.equal(safeNextLink("https://evil.example/me/"), null);
});

test("Teams: HTML shown as text, replies kept in order, posts need a target and text", () => {
  assert.equal(plainText("<p>Hi&nbsp;<b>team</b></p><p>&lt;script&gt; &amp; more</p>"), "Hi team\n<script> & more");
  const m = toMessage({
    id: "1",
    messageType: "message",
    createdDateTime: "2026-11-01T10:00:00Z",
    from: { user: { displayName: "Sam" } },
    body: { contentType: "html", content: "<p>Root</p>" },
    replies: [
      { id: "3", messageType: "message", createdDateTime: "2026-11-01T12:00:00Z", body: { content: "later" } },
      { id: "2", messageType: "message", createdDateTime: "2026-11-01T11:00:00Z", body: { content: "first" } },
      { id: "4", messageType: "message", deletedDateTime: "2026-11-01T13:00:00Z", body: { content: "gone" } },
    ],
  });
  assert.deepEqual(m?.replies?.map((r) => r.id), ["2", "3"]);
  assert.equal(toMessage({ id: "5", messageType: "systemEventMessage", body: { content: "" } }), null);
  assert.deepEqual(checkPost({ kind: "chat", chatId: "19:abc@thread.v2", text: " hi " }), { kind: "chat", chatId: "19:abc@thread.v2", teamId: "", channelId: "", replyTo: "", text: "hi" });
  assert.throws(() => checkPost({ kind: "channel", teamId: "t-1", channelId: "19:c@thread.tacv2", replyTo: "", text: "hi" }), /message/);
  assert.throws(() => checkPost({ kind: "chat", chatId: "19:abc@thread.v2", text: "  " }), /Write/);
  assert.throws(() => checkPost({ kind: "chat", chatId: "../users", text: "x" }), /can't be opened/);
});

test("calendar days: all-day end is exclusive, midnight endings don't spill over", () => {
  assert.deepEqual(daysCovered({ start: "2026-11-03", end: "2026-11-05", allDay: true }), ["2026-11-03", "2026-11-04"]);
  assert.deepEqual(daysCovered({ start: "2026-11-03", end: "2026-11-03", allDay: true }), ["2026-11-03"]);
  const local = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h).toISOString();
  assert.deepEqual(daysCovered({ start: local(2026, 11, 3, 22), end: local(2026, 11, 4, 0), allDay: false }), ["2026-11-03"]);
  assert.deepEqual(daysCovered({ start: local(2026, 11, 3, 22), end: local(2026, 11, 4, 2), allDay: false }), ["2026-11-03", "2026-11-04"]);
  const map = byDay([{ start: "2026-10-31", end: "2026-11-02", allDay: true }], "2026-11-01", "2026-11-30");
  assert.deepEqual([...map.keys()], ["2026-11-01"]);
});
