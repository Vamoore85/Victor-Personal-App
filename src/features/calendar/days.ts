/** Calendar day math in the viewer's own time zone. Pure, so it can be tested. */

export type DayEvent = { start: string; end: string; allDay: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
export const localYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return localYmd(new Date(y, m - 1, d + n));
}

export function monthRange(ymd: string) {
  const [y, m] = ymd.split("-").map(Number);
  return { from: localYmd(new Date(y, m - 1, 1)), to: localYmd(new Date(y, m, 0)) };
}

/**
 * The local days an event covers. All-day events end on the day after their
 * last day; a timed event ending exactly at midnight doesn't spill into the next day.
 */
export function daysCovered(e: DayEvent, tzOffsetFor: (iso: string) => Date = (iso) => new Date(iso)): string[] {
  let first: string;
  let last: string;
  if (e.allDay) {
    first = e.start.slice(0, 10);
    last = addDays(e.end.slice(0, 10), -1);
    if (last < first) last = first;
  } else {
    const s = tzOffsetFor(e.start);
    const en = tzOffsetFor(e.end);
    first = localYmd(s);
    const endsAtMidnight = en.getHours() === 0 && en.getMinutes() === 0 && en.getSeconds() === 0;
    last = localYmd(endsAtMidnight && en.getTime() > s.getTime() ? new Date(en.getTime() - 1) : en);
    if (last < first) last = first;
  }
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Groups events by the local days they cover, limited to [from, to]. */
export function byDay<T extends DayEvent>(events: T[], from: string, to: string) {
  const map = new Map<string, T[]>();
  for (const e of events) {
    for (const d of daysCovered(e)) {
      if (d < from || d > to) continue;
      const list = map.get(d) ?? [];
      list.push(e);
      map.set(d, list);
    }
  }
  return map;
}
