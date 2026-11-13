import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { ORGANIZER_EMAIL, SELF_REPORTED, TIME_ZONE, dateLabel, reportMeetings, timeLabel, type Kind, type MeetingData } from "./model";

/*
 * The court attendance report. It lists only meetings the owner explicitly
 * confirmed as attended, says plainly that they are self-reported, and refers
 * to supporting records by name and SHA-256 hash. It adds no stamp,
 * signature or certification, and is only ever downloaded, never sent.
 * Private notes and topics stay out unless the owner asks for them.
 */

export type ReportOptions = { from: string; through: string; kinds: Kind[]; includeTopics: boolean; includeNotes: boolean };
export type ReportRecord = { ref: string; id: string; name: string; type: string; size: number; sha256: string; uploadedAt: string };
export type ReportConfirmation = {
  ref: string; label: typeof ORGANIZER_EMAIL; subject: string; sender: string; date: string; importedAt: string; gmailId: string;
  attachments: { id: string; name: string; type: string; size: number; sha256: string }[];
};
export type ReportRow = {
  date: string; time: string; name: string; location: string; format: string; minutes: number | null; kind: Kind;
  basis: string; confirmedAt: string; records: ReportRecord[]; confirmations: ReportConfirmation[];
  selfTimes?: { joined: string; left: string; label: typeof SELF_REPORTED; source: string };
  topic?: string; note?: string;
};
export type Report = ReturnType<typeof buildReport>;

export const STATEMENT = [
  "Each meeting listed was marked \"I attended\" by the account owner in Maverick Personal. Entries are self-reported.",
  "Where a supporting record is listed, the owner attached that file; it is referenced by name and SHA-256 hash so the original can be matched. An attached file is not independent verification by this app.",
  "Where an organizer email confirmation is listed, it is an email the owner received, imported unchanged from the owner's Gmail and shown as received; it is not host verification. Join and leave times are self-reported.",
  "Planned meetings, calendar entries and meetings marked \"did not attend\" are not included. This document carries no signature, stamp or certification.",
];

export function parseOptions(q: URLSearchParams): ReportOptions {
  const kinds = (q.get("kinds") ?? "AA").split(",").filter((k): k is Kind => k === "AA" || k === "IOP" || k === "Other");
  return { from: q.get("from") ?? "", through: q.get("through") ?? "", kinds: kinds.length ? kinds : ["AA"], includeTopics: q.get("topics") === "1", includeNotes: q.get("notes") === "1" };
}

// An online meeting's join link or passcode never goes into a report.
const publicLocation = (s: string) => (/https?:|www\.|zoom\.|teams\.|meet\.|pwd=|passcode|password/i.test(s) ? "Online (link withheld)" : s);

export function buildReport(data: MeetingData, rev: number, o: ReportOptions, now = new Date()) {
  let n = 0, e = 0;
  const rows: ReportRow[] = reportMeetings(data, o.from, o.through, o.kinds).map((m) => {
    const records = m.evidence.filter((x) => !x.withdrawnAt).map((x) => ({ ref: `R${++n}`, id: x.id, name: x.name, type: x.type, size: x.size, sha256: x.sha256, uploadedAt: x.uploadedAt }));
    const confirmations: ReportConfirmation[] = m.confirmations.map((c) => ({
      ref: `E${++e}`, label: ORGANIZER_EMAIL, subject: c.subject, sender: c.sender, date: c.date, importedAt: c.importedAt, gmailId: c.gmailId,
      attachments: c.attachments.map((a) => ({ id: a.id, name: a.name, type: a.type, size: a.size, sha256: a.sha256 })),
    }));
    const basis = [SELF_REPORTED, records.length ? `supporting record ${records.map((r) => r.ref).join(", ")}` : "", confirmations.length ? `${ORGANIZER_EMAIL} ${confirmations.map((c) => c.ref).join(", ")}` : ""].filter(Boolean).join("; ");
    return {
      date: m.date, time: m.time, name: m.name, location: publicLocation(m.location), format: m.format, minutes: m.minutes, kind: m.kind,
      basis, confirmedAt: m.confirmedAt!, records, confirmations,
      ...(m.selfTimes ? { selfTimes: { joined: m.selfTimes.joined, left: m.selfTimes.left, label: SELF_REPORTED, source: m.selfTimes.source === "recording" ? "owner's own recording start and stop" : "entered by owner" } } : {}),
      ...(o.includeTopics && m.topic ? { topic: m.topic } : {}),
      ...(o.includeNotes && m.note ? { note: m.note } : {}),
    };
  });
  const p = data.profile;
  return {
    title: p.reportTitle || "AA Meeting Attendance Record",
    name: p.name, court: p.court, caseNumbers: p.caseNumbers,
    from: o.from, through: o.through, kinds: o.kinds,
    generatedAt: now.toISOString(),
    generatedAtLocal: now.toLocaleString("en-US", { timeZone: TIME_ZONE, dateStyle: "long", timeStyle: "short" }) + " Eastern",
    source: `Maverick Personal, AA Meetings tracker (owner-entered records), data revision ${rev}`,
    timeZone: TIME_ZONE,
    rows,
    totals: {
      meetings: rows.length,
      minutes: rows.reduce((s, r) => s + (r.minutes ?? 0), 0),
      withoutDuration: rows.filter((r) => r.minutes === null).length,
      withRecords: rows.filter((r) => r.records.length).length,
      withOrganizerEmail: rows.filter((r) => r.confirmations.length).length,
      selfReportedOnly: rows.filter((r) => !r.records.length && !r.confirmations.length).length,
    },
    statement: STATEMENT,
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function reportCsv(r: Report) {
  const topics = r.rows.some((x) => x.topic), notes = r.rows.some((x) => x.note);
  const head = ["Date", "Time (Eastern)", "Meeting", "Type", "Location", "Format", "Minutes", "Basis", "Owner confirmed at", "Supporting records (ref name sha256)", "Organizer email confirmations (ref date sender subject)", "Join and leave (self-reported)", ...(topics ? ["Topic"] : []), ...(notes ? ["Private note"] : [])];
  const rows = r.rows.map((x) => [x.date, x.time, x.name, x.kind, x.location, x.format, x.minutes ?? "", x.basis, x.confirmedAt,
    x.records.map((r) => `${r.ref} ${r.name} ${r.sha256}`).join("; "),
    x.confirmations.map((c) => `${c.ref} ${c.date} ${c.sender} ${c.subject}${c.attachments.length ? ` [attachments: ${c.attachments.map((a) => `${a.name} ${a.sha256}`).join(", ")}]` : ""}`).join("; "),
    x.selfTimes ? `${x.selfTimes.joined}-${x.selfTimes.left} (${x.selfTimes.source})` : "", ...(topics ? [x.topic ?? ""] : []), ...(notes ? [x.note ?? ""] : [])]);
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// The standard PDF fonts only cover Latin-1; anything else is spelled out or replaced.
const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-").replace(/…/g, "...").replace(/→/g, "->")
  .replace(/[\t\r]/g, " ").replace(/[^\n\x20-\x7e\xa0-\xff]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of winAnsi(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) { // a word longer than the column
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, cut)); w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (line && font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = w; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export class ReportError extends Error {}

export async function reportPdf(r: Report) {
  if (!r.name.trim()) throw new ReportError("Enter your name under Report settings before making a court report.");
  if (!r.rows.length) throw new ReportError("No confirmed attendance in this date range. Mark the meetings you attended first.");
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(r.title)); doc.setProducer("Maverick Personal"); doc.setCreator("Maverick Personal AA Meetings");
  doc.setCreationDate(new Date(r.generatedAt)); doc.setModificationDate(new Date(r.generatedAt));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 48, ink = rgb(0.1, 0.1, 0.1), muted = rgb(0.36, 0.36, 0.36), rule = rgb(0.8, 0.8, 0.8);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (h: number) => { if (y - h < M + 20) { page = doc.addPage([W, H]); y = H - M; return true; } return false; };
  const para = (text: string, size = 10, f = font, color = ink, gap = 4) => {
    for (const line of wrap(text, f, size, W - 2 * M)) { ensure(size + 3); page.drawText(line, { x: M, y: y - size, size, font: f, color }); y -= size + 3; }
    y -= gap;
  };

  para(r.title, 17, bold, ink, 6);
  const facts: [string, string][] = [
    ["Name", r.name || "(not entered)"], ["Court", r.court || "(not entered)"], ["Case number(s)", r.caseNumbers || "(not entered)"],
    ["Period", `${dateLabel(r.from)} through ${dateLabel(r.through)}`], ["Meeting types", r.kinds.join(", ")],
    ["Times", "Eastern (America/New_York)"],
  ];
  for (const [k, v] of facts) {
    const lines = wrap(v, font, 10, W - 2 * M - 105);
    ensure(lines.length * 13);
    page.drawText(k, { x: M, y: y - 10, size: 10, font: bold, color: ink });
    lines.forEach((l, i) => page.drawText(l, { x: M + 105, y: y - 10 - i * 13, size: 10, font, color: ink }));
    y -= lines.length * 13 + 2;
  }
  y -= 6;
  const t = r.totals;
  para(`Meetings attended: ${t.meetings}.  With a supporting record: ${t.withRecords}.  With an organizer email confirmation: ${t.withOrganizerEmail}.  Self-reported only: ${t.selfReportedOnly}.  Recorded duration: ${t.minutes} minutes${t.withoutDuration ? ` (${t.withoutDuration} without a duration)` : ""}.`, 10, bold, ink, 8);
  y -= 8;

  const cols = [{ h: "Date", w: 82 }, { h: "Time", w: 50 }, { h: "Meeting", w: 140 }, { h: "Location", w: 100 }, { h: "Min", w: 28 }, { h: "Basis", w: W - 2 * M - 400 }];
  const header = () => {
    ensure(30);
    let x = M;
    for (const c of cols) { page.drawText(c.h, { x, y: y - 9, size: 9, font: bold, color: ink }); x += c.w; }
    y -= 14; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: ink }); y -= 4;
  };
  header();
  if (!r.rows.length) para("No owner-confirmed attendance in this period.", 10, font, muted);
  for (const row of r.rows) {
    const cells = [dateLabel(row.date), timeLabel(row.time) || "-", `${row.name}${row.kind !== "AA" ? ` (${row.kind})` : ""}${row.format === "online" ? " - online" : ""}`, row.location || "-", row.minutes == null ? "-" : String(row.minutes), row.basis]
      .map((c, i) => wrap(c, font, 8.5, cols[i].w - 6));
    const extra = [`Owner confirmed attendance ${row.confirmedAt}`,
      row.selfTimes ? `Join ${timeLabel(row.selfTimes.joined)}, leave ${timeLabel(row.selfTimes.left)} (${row.selfTimes.label}: ${row.selfTimes.source})` : "",
      ...row.confirmations.map((c) => `${c.ref} ${c.label}: "${c.subject}" from ${c.sender}, ${c.date}`),
      row.topic ? `Topic: ${row.topic}` : "", row.note ? `Private note: ${row.note}` : ""].filter(Boolean)
      .flatMap((s) => wrap(s, font, 8.5, W - 2 * M - cols[0].w));
    const tall = Math.max(...cells.map((c) => c.length));
    // The row's cells and its first detail line stay together; longer topics or notes continue on the next page.
    if (ensure(tall * 11 + 11 + 6)) header();
    let x = M;
    cells.forEach((lines, i) => { lines.forEach((l, j) => page.drawText(l, { x, y: y - 9 - j * 11, size: 8.5, font, color: ink })); x += cols[i].w; });
    y -= tall * 11;
    for (const l of extra) {
      if (ensure(11)) {
        header();
        page.drawText(wrap(`${dateLabel(row.date)} ${row.name} (continued)`, bold, 8.5, W - 2 * M)[0], { x: M, y: y - 9, size: 8.5, font: bold, color: ink }); y -= 12;
      }
      page.drawText(l, { x: M + cols[0].w, y: y - 8.5, size: 8.5, font, color: muted }); y -= 11;
    }
    y -= 3; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rule }); y -= 3;
  }

  const records = r.rows.flatMap((row) => row.records.map((e) => ({ ...e, meeting: `${dateLabel(row.date)} ${row.name}` })));
  if (records.length) {
    y -= 14; ensure(60);
    para("Supporting records referenced", 12, bold, ink, 2);
    for (const e of records) {
      const lines = [`${e.ref}  ${e.name}  (${e.type}, ${Math.max(1, Math.round(e.size / 1024))} KB)  for ${e.meeting}`, `Attached ${e.uploadedAt}   File id ${e.id}`, `SHA-256 ${e.sha256}`]
        .map((s, i) => ({ i, lines: wrap(s, i ? font : bold, 8, W - 2 * M) }));
      ensure(lines.reduce((s, l) => s + l.lines.length, 0) * 10 + 6);
      for (const l of lines) for (const text of l.lines) { page.drawText(text, { x: M, y: y - 8, size: 8, font: l.i ? font : bold, color: l.i ? muted : ink }); y -= 10; }
      y -= 6;
    }
  }

  const emails = r.rows.flatMap((row) => row.confirmations.map((c) => ({ ...c, meeting: `${dateLabel(row.date)} ${row.name}` })));
  if (emails.length) {
    y -= 14; ensure(60);
    para("Organizer email confirmations", 12, bold, ink, 2);
    para("Emails the owner received from meeting organizers, imported read-only from the owner's Gmail and kept with their attachments in private Maverick storage. Shown as received; not host verification.", 8.5, font, muted, 6);
    for (const c of emails) {
      const lines = [`${c.ref}  ${c.subject}  for ${c.meeting}`, `From ${c.sender}, sent ${c.date}. Imported ${c.importedAt}. Gmail id ${c.gmailId}`,
        ...c.attachments.map((a) => `Attachment ${a.name} (${a.type}) SHA-256 ${a.sha256}`)]
        .map((s, i) => ({ i, lines: wrap(s, i ? font : bold, 8, W - 2 * M) }));
      ensure(lines.reduce((s, l) => s + l.lines.length, 0) * 10 + 6);
      for (const l of lines) for (const text of l.lines) { page.drawText(text, { x: M, y: y - 8, size: 8, font: l.i ? font : bold, color: l.i ? muted : ink }); y -= 10; }
      y -= 6;
    }
  }

  const pages = doc.getPages();
  // One footer line: the page count always shows, and a long title or name is shortened to fit.
  const fit = (text: string, width: number) => {
    let t = winAnsi(text);
    if (font.widthOfTextAtSize(t, 8) <= width) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, 8) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  pages.forEach((p, i) => {
    const right = `${r.from} to ${r.through} - Page ${i + 1} of ${pages.length}`;
    const rw = font.widthOfTextAtSize(right, 8);
    p.drawText(fit(`${r.title} - ${r.name || "Owner"}`, W - 2 * M - rw - 12), { x: M, y: 26, size: 8, font, color: muted });
    p.drawText(right, { x: W - M - rw, y: 26, size: 8, font, color: muted });
  });
  return doc.save();
}
