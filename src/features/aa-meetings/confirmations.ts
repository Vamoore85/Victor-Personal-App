import { TIME_ZONE, validDate, type Meeting, type MeetingData } from "./model";

/*
 * Matching an organizer's confirmation email to a meeting. A match needs a
 * single meeting on the email's meeting date (a date written in the email, or
 * else the day it was sent), narrowed by the meeting's name or start time
 * when more than one meeting is on that date. Anything else goes to "Needs
 * review" with the reason; nothing is guessed.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return validDate(s) ? s : null;
};

/** Dates written in the text: 2026-11-12, 11/12/2026, 11/12/26, November 12, 2026, Nov 12 (year from the email). */
export function datesIn(text: string, fallbackYear: number): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) { const d = iso(+m[1], +m[2], +m[3]); if (d) out.add(d); }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const d = iso(y, +m[1], +m[2]); if (d) out.add(d);
  }
  for (const m of text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/gi)) {
    const month = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3))) + 1;
    const d = iso(m[3] ? +m[3] : fallbackYear, month, +m[2]); if (d) out.add(d);
  }
  return [...out];
}

/** Times written in the text as 24-hour HH:MM: "7:00 PM", "7 pm", "19:00". */
export function timesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?\b/gi)) {
    let h = +m[1] % 12; if (m[3].toLowerCase() === "p") h += 12;
    if (+m[1] >= 1 && +m[1] <= 12) out.add(`${pad(h)}:${m[2] ?? "00"}`);
  }
  for (const m of text.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?m)/gi)) out.add(`${m[1]}:${m[2]}`);
  return [...out];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nameIn = (m: Meeting, text: string) => norm(m.name).length >= 4 && ` ${norm(text)} `.includes(` ${norm(m.name)} `);

export function easternDate(when: string) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export type Match = { meetingId: string; by: string } | { reason: string };

export function matchConfirmation(data: MeetingData, c: { subject: string; body: string; date: string }): Match {
  const text = `${c.subject}\n${c.body}`;
  const sent = easternDate(c.date);
  const year = Number((sent ?? "").slice(0, 4)) || new Date().getUTCFullYear();
  const written = datesIn(text, year);
  const dates = written.length ? written : sent ? [sent] : [];
  if (!dates.length) return { reason: "The email has no readable date." };
  if (written.length > 1) return { reason: `The email mentions ${written.length} different dates.` };
  const date = dates[0];
  const active = data.meetings.filter((m) => !m.cancelled);
  const onDay = active.filter((m) => m.date === date);
  const byName = onDay.filter((m) => nameIn(m, text));
  const times = timesIn(text);
  const byTime = onDay.filter((m) => m.time && times.includes(m.time));
  const how = written.length ? "date written in the email" : "date the email was sent";
  if (onDay.length === 1) {
    const m = onDay[0];
    // A written time or name that contradicts the only meeting that day is not a match.
    if (times.length && m.time && !times.includes(m.time) && !nameIn(m, text)) return { reason: `The email's time doesn't match the only meeting on ${date}.` };
    return { meetingId: m.id, by: `Only meeting on the ${how} (${date})` };
  }
  if (!onDay.length) {
    const named = active.filter((m) => nameIn(m, text));
    return { reason: named.length ? `No meeting on ${date}; the email names a meeting on another date.` : `No meeting in the tracker on ${date}.` };
  }
  if (byName.length === 1) return { meetingId: byName[0].id, by: `Meeting name and the ${how} (${date})` };
  if (byTime.length === 1) return { meetingId: byTime[0].id, by: `Start time and the ${how} (${date})` };
  return { reason: `${onDay.length} meetings on ${date}; the email doesn't say which one.` };
}

/** Every Gmail id already imported, matched or waiting for review. */
export function knownGmailIds(data: MeetingData) {
  return new Set([...data.needsReview.map((c) => c.gmailId), ...data.meetings.flatMap((m) => m.confirmations.map((c) => c.gmailId))]);
}
