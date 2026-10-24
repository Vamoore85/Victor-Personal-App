/*
 * What you've allowed each home app to do. Everything starts off; read-only
 * status and events is the base, and camera viewing, recordings, automations
 * and device control each need their own yes.
 */

export type Capability = "status" | "camera" | "recordings" | "automations" | "control";
export const CAPABILITIES: { id: Capability; label: string; detail: string; sensitive: boolean }[] = [
  { id: "status", label: "Device status and events", detail: "Which devices you have, battery, online/offline, doorbell rings and motion alerts. Read-only.", sensitive: false },
  { id: "camera", label: "Live camera viewing", detail: "Open a live view from inside Maverick.", sensitive: true },
  { id: "recordings", label: "Recordings", detail: "Play back saved video clips.", sensitive: true },
  { id: "automations", label: "Automations", detail: "Run routines you set up (for example, lights on when the doorbell rings).", sensitive: true },
  { id: "control", label: "Device control", detail: "Arm or disarm, lock or unlock, and other actions that change a device.", sensitive: true },
];

export type AppConsent = { allowed: Partial<Record<Capability, boolean>>; updatedAt: string };
export type Consents = { apps: Record<string, AppConsent> };
export const EMPTY: Consents = { apps: {} };

export function setAllowed(c: Consents, app: string, cap: Capability, on: boolean, now = new Date().toISOString()): Consents {
  const prev = c.apps[app]?.allowed ?? {};
  // Without read-only status nothing else can work, so turning it off turns the rest off too.
  const allowed: AppConsent["allowed"] = cap === "status" && !on ? {} : { ...prev, [cap]: on, ...(on && cap !== "status" ? { status: true } : {}) };
  return { apps: { ...c.apps, [app]: { allowed, updatedAt: now } } };
}

export function normalize(raw: unknown): Consents {
  const v = raw as Consents | null;
  return v && typeof v.apps === "object" && v.apps ? { apps: v.apps } : EMPTY;
}

export function merge(mine: Consents, theirs: Consents): Consents {
  const apps = { ...theirs.apps };
  for (const [k, a] of Object.entries(mine.apps)) if (!apps[k] || a.updatedAt >= apps[k].updatedAt) apps[k] = a;
  return { apps };
}
