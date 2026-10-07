/** Today's date as YYYY-MM-DD in local time. */
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number) {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}

export function prettyDate(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  if (!ymd) return "Date not set";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", opts);
}
