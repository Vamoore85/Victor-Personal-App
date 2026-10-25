import { scanKey, type ScanCursor } from "./scan-history";

export const HISTORY_THROUGH_YEAR = 2004;
export const HISTORY_SCHEDULE = "Every 5 minutes";

export type HistoryImportState = {
  enabled: boolean;
  asOf?: string;
  startedAt?: string;
  lastCheck?: string;
  lastSuccess?: string;
  lastError?: string;
  lastNote?: string;
};

export function easternDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}

/** A fixed snapshot keeps the current-year cursor valid across midnight and New Year. */
export function historyProgress(asOf: string, scans: Record<string, ScanCursor>) {
  const startYear = Number(asOf.slice(0,4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isInteger(startYear) || startYear < HISTORY_THROUGH_YEAR) throw new Error("Invalid history snapshot date.");
  const years = Array.from({length:startYear-HISTORY_THROUGH_YEAR+1},(_,i)=>startYear-i);
  const cursorFor = (year: number) => scans[scanKey(`${year}-01-01`,year === startYear ? asOf : `${year}-12-31`)];
  const completedYears = years.filter(year=>cursorFor(year)?.complete);
  const year = years.find(year=>!cursorFor(year)?.complete) ?? null;
  return {
    startYear, throughYear:HISTORY_THROUGH_YEAR, year,
    completedYears, totalYears:years.length, complete:year === null,
    examined:years.reduce((sum,year)=>sum+(cursorFor(year)?.looked ?? 0),0),
    currentExamined:year === null ? 0 : cursorFor(year)?.looked ?? 0,
  };
}

export type HistoryImportStatus = HistoryImportState & ReturnType<typeof historyProgress> & {configured:boolean;schedule:string};
