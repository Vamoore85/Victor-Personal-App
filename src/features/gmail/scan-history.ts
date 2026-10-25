export const SCAN_BATCH_SIZE = 40;

export type ScanCursor = {
  page?: string;
  retryIds: string[];
  looked: number;
  kept: number;
  complete: boolean;
  lease?: { id: string; until: number };
};

export function scanRange(days: number, today: string, year?: number) {
  if (year !== undefined) {
    if (!Number.isInteger(year) || year < 2004 || year > Number(today.slice(0, 4))) throw new Error("Choose a year from 2004 through this year.");
    return { from: `${year}-01-01`, to: year === Number(today.slice(0, 4)) ? today : `${year}-12-31` };
  }
  const span = Math.min(180, Math.max(1, Math.round(Number.isFinite(days) ? days : 90)));
  return { from: new Date(Date.parse(`${today}T00:00:00Z`) - (span - 1) * 86400000).toISOString().slice(0, 10), to: today };
}

export const scanKey = (from: string, to: string) => `v1:${from}:${to}`;

export function claimScan(previous: ScanCursor | undefined, id: string, now: number, restart = false): ScanCursor {
  if (previous?.lease && previous.lease.until > now) throw new Error("A scan for this period is already running. Wait for it to finish.");
  const cursor = restart || !previous || previous.complete ? { retryIds: [], looked: 0, kept: 0, complete: false } : previous;
  return { ...cursor, lease: { id, until: now + 150000 } };
}

export async function collectScanBatch(cursor: ScanCursor, list: (page: string | undefined, limit: number) => Promise<{ ids: string[]; page?: string }>, limit = SCAN_BATCH_SIZE) {
  const ids = [...cursor.retryIds];
  let page = cursor.page;
  let listed = 0;
  // A retry-only batch must not accidentally restart the Gmail query from its first page.
  let hasMore = Boolean(page) || (cursor.looked === 0 && !cursor.retryIds.length);
  while (hasMore && ids.length < limit) {
    const result = await list(page, Math.min(100, limit - ids.length));
    ids.push(...result.ids);
    listed += result.ids.length;
    page = result.page;
    hasMore = Boolean(page);
  }
  return { ids: [...new Set(ids)], page, listed };
}
