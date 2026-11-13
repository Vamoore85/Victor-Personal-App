import { TIME_ZONE, timeLabel, type Meeting, type MeetingData } from "./model";

/*
 * One meeting's own record: what it was, when, the topic, whether the owner
 * attended, whether the organizer's email confirmation has arrived, and the
 * takeaway. Shown on the Meeting records tab and downloadable as PDF or Word
 * (record.ts). No libraries here, so the screen can use it too.
 */

// An online meeting's join link or passcode never goes into a record or report.
export const publicLocation = (s: string) => (/https?:|www\.|zoom\.|teams\.|meet\.|pwd=|passcode|password/i.test(s) ? "Online (link withheld)" : s);

export type MeetingRecord = { title: string; rows: [string, string][]; takeaway: string; fileBase: string };

const longDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function meetingRecord(m: Meeting, data: Pick<MeetingData, "profile">): MeetingRecord {
  const place = publicLocation(m.location);
  const where = m.format === "online" ? ` (online${place ? `, ${place}` : ""})` : place ? ` (${place})` : "";
  const received = m.confirmations.filter((c) => !c.dismissedAt).map((c) => new Date(c.date)).filter((d) => !Number.isNaN(d.getTime()));
  const confirmation = received.length
    ? `Received ${received[0].toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TIME_ZONE })}`
    : "Pending (email from the meeting organizer not yet received)";
  const hour = m.time ? timeLabel(m.time).replace(":00 ", " ") : "";
  return {
    title: "AA Meeting Record",
    rows: [
      ["Meeting", m.name + where],
      ["Date", longDate(m.date)],
      ["Start time", m.time ? `${timeLabel(m.time)} Eastern` : "Not recorded"],
      ["Topic", m.topic || "Not recorded"],
      ["Attendee", data.profile.name || "Not entered (add your name under Settings)"],
      ["Attendance", m.state === "attended" ? "Attended" : m.state === "missed" ? "Did not attend" : "Not answered yet"],
      ["Organizer confirmation", confirmation],
    ],
    takeaway: m.takeaway || m.audio?.takeaway || "",
    fileBase: `${m.date}${hour ? ` ${hour}` : ""} - ${m.name}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").slice(0, 120),
  };
}

