import { easternDate, historyProgress, HISTORY_SCHEDULE, type HistoryImportState } from "@/features/gmail/history-import";
import { dbConfigured, readDoc, writeDoc } from "./db";
import { connectedEmail, GmailError, readItems, routeRecurringBills, scan } from "./gmail";

const KEY = "gmail-history-import";

async function patch(change: Partial<HistoryImportState>) {
  for (let i=0;i<5;i++) {
    const doc = await readDoc(KEY);
    const data = {enabled:false,...doc?.data as Partial<HistoryImportState>,...change};
    if ((await writeDoc(KEY,doc?.rev ?? 0,data)).ok) return data;
  }
  throw new GmailError("Couldn't save the older-receipt import settings. Try again.",503);
}

export async function historyImportStatus() {
  const [doc,mail] = await Promise.all([dbConfigured() ? readDoc(KEY) : null,readItems()]);
  const state = {enabled:false,...doc?.data as Partial<HistoryImportState>};
  const progress = historyProgress(state.asOf ?? easternDate(),mail.scans ?? {});
  return {...state,...progress,enabled:state.enabled && !progress.complete,configured:Boolean(process.env.CRON_SECRET),schedule:HISTORY_SCHEDULE};
}

export async function setHistoryImport(enabled: boolean) {
  if (!dbConfigured() || !process.env.CRON_SECRET) throw new GmailError("Background history imports aren't configured yet.",503);
  if (enabled && !await connectedEmail()) throw new GmailError("Connect Gmail before starting the older-receipt import.");
  const current = await historyImportStatus();
  await patch({enabled,asOf:current.asOf ?? easternDate(),startedAt:current.startedAt ?? new Date().toISOString()});
  return historyImportStatus();
}

/** One saved full-year batch per invocation; finished years are never restarted. */
export async function runHistoryImport() {
  const state = await historyImportStatus();
  if (state.complete) return {skipped:"complete"};
  if (!state.enabled || state.year === null || !state.asOf) return {skipped:"paused"};
  const at = new Date().toISOString();
  await patch({lastCheck:at});
  try {
    if (!await connectedEmail()) throw new GmailError("Gmail needs to be reconnected.",401);
    const result = await scan(90,state.asOf,{year:state.year,automatic:true});
    let routingError = "";
    try { await routeRecurringBills(easternDate()); } catch {routingError="Receipt progress is saved; recurring bills will retry routing on the next batch.";}
    const progress = await historyImportStatus();
    await patch({lastSuccess:at,lastError:routingError || (result.failed ? `${result.failed} emails will retry on the next batch.` : ""),lastNote:progress.complete ? "Older email history has been imported." : result.capped ? `Saved another batch from ${state.year}.` : `Finished ${state.year}; continuing with earlier years.`,...(progress.complete ? {enabled:false} : {})});
    return {year:state.year,looked:result.looked,kept:result.kept,complete:progress.complete};
  } catch (e) {
    if (e instanceof GmailError && e.status === 409) {
      await patch({lastError:"",lastNote:"Another email scan is running. The history import will retry on its next schedule."});
      return {skipped:"scan-running"};
    }
    await patch({lastError:e instanceof GmailError ? e.message : "The history batch failed. Saved progress will retry on the next schedule."});
    throw e;
  }
}
