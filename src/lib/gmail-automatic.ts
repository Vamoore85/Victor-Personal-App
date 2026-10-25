import { AUTO_SCAN_DAYS, AUTO_SCAN_LABEL, type AutomaticMailState } from "@/features/gmail/automatic";
import { dbConfigured, readDoc, writeDoc } from "./db";
import { connectedEmail, GmailError, routeRecurringBills, scan } from "./gmail";

const KEY = "gmail-automatic";

async function patch(change: Partial<AutomaticMailState>) {
  for (let i=0;i<5;i++) {
    const doc = await readDoc(KEY);
    const data = { enabled:false, ...doc?.data as Partial<AutomaticMailState>, ...change };
    if ((await writeDoc(KEY,doc?.rev ?? 0,data)).ok) return data;
  }
  throw new GmailError("Couldn't save automatic email settings. Try again.",503);
}

export async function automaticStatus() {
  const doc = dbConfigured() ? await readDoc(KEY) : null;
  return { enabled:false, ...doc?.data as Partial<AutomaticMailState>, configured:Boolean(process.env.CRON_SECRET), schedule:AUTO_SCAN_LABEL };
}

export async function setAutomaticMail(enabled: boolean) {
  if (!dbConfigured() || !process.env.CRON_SECRET) throw new GmailError("Background email checks aren't configured yet.",503);
  if (enabled && !await connectedEmail()) throw new GmailError("Connect Gmail before turning on automatic checks.",400);
  await patch({enabled});
  return automaticStatus();
}

/** One bounded batch. The next scheduled invocation resumes its saved cursor. */
export async function runAutomaticMail() {
  const state = await automaticStatus();
  if (!state.enabled) return {skipped:"paused"};
  const at = new Date().toISOString();
  const today = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  await patch({lastCheck:at});
  try {
    if (!await connectedEmail()) throw new GmailError("Gmail needs to be reconnected.",401);
    const result = await scan(AUTO_SCAN_DAYS,today,{automatic:true});
    const routed = await routeRecurringBills(today);
    await patch({lastSuccess:at,lastError:result.failed ? `${result.failed} emails will retry on the next check.` : "",lastNote:result.capped ? "Saved this batch; more mail remains for the next check." : "Recent financial emails are up to date.",looked:result.looked,kept:result.kept});
    return {looked:result.looked,kept:result.kept,billsAdded:routed.added,more:result.capped};
  } catch (e) {
    if (e instanceof GmailError && e.status === 409) {
      await patch({lastError:"",lastNote:"Another email scan is running. Automatic checks will retry on the next schedule."});
      return {skipped:"scan-running"};
    }
    await patch({lastError:e instanceof GmailError ? e.message : "The automatic check failed. It will retry on the next schedule."});
    throw e;
  }
}
