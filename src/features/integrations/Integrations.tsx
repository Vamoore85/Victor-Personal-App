"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { createCloudDoc } from "@/lib/cloud-doc";
import { CAPABILITIES, EMPTY, merge, normalize, setAllowed } from "./consent";

const consents = createCloudDoc("integrations", EMPTY, normalize, merge);

type Status = {
  database?: boolean;
  error?: string;
  banks?: { connections: number; institutions: string[]; problems: number; lastSync: string | null; accounts: { name: string; last4: string; company: string }[] };
  gmail?: { keys: boolean; connected: boolean; connectedAt: string | null; lastScan: string | null; review: number } | null;
  quickbooks?: { connected: boolean; companyName: string | null; connectedAt: string | null } | null;
  googleCalendar?: { connected: boolean; email: string | null; lastRead: string | null } | null;
  microsoft?: { account: string; keys: boolean; connected: boolean; email: string | null; connectedAt: string | null; teams: boolean; lastCalendarRead: string | null } | null;
};

function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

type Tone = "on" | "warn" | "off" | "planned";
const TONE: Record<Tone, string> = {
  on: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  off: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  planned: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

function IntegrationCard({
  name,
  state,
  tone,
  purpose,
  rows,
  permissions,
  action,
  children,
  testId,
}: {
  name: string;
  state: string;
  tone: Tone;
  purpose: string;
  rows?: [string, ReactNode][];
  permissions: string;
  action?: ReactNode;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-surface p-4 sm:p-5 dark:border-zinc-800" data-testid={testId}>
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">{name}</h3>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{state}</span>
      </header>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{purpose}</p>
      {rows && rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-zinc-500">
        <span className="font-medium">Permissions: </span>
        {permissions}
      </p>
      {children}
      {action && <div className="mt-auto flex flex-wrap gap-2 pt-1">{action}</div>}
    </article>
  );
}

const btn = "rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:border-brand hover:text-brand dark:border-zinc-700";
const btnOff = "rounded-full border border-dashed border-zinc-300 px-4 py-1.5 text-sm text-zinc-400 dark:border-zinc-700";

const HOME_KINDS = ["Alarms and locks", "Lights", "Thermostats", "Garage doors", "Sensors"];

export function IntegrationsScreen() {
  const [s, setS] = useState<Status | null>(null);
  const { data: c } = consents.use();
  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS({ error: "Couldn't load connection status." }));
  }, []);
  const banks = s?.banks;
  const qb = s?.quickbooks;
  const gm = s?.gmail;
  const gc = s?.googleCalendar;
  const ms = s?.microsoft;
  const ring = c.apps.ring?.allowed ?? {};

  return (
    <div className="flex flex-col gap-6" data-testid="integrations">
      {s?.error && <p className="rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/40">{s.error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Money and work</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <IntegrationCard
            testId="int-plaid"
            name="Banks (Plaid)"
            state={!s ? "Checking…" : !banks?.connections ? "Not connected" : banks.problems ? "Needs attention" : "Connected"}
            tone={!banks?.connections ? "off" : banks.problems ? "warn" : "on"}
            purpose="Brings in balances and transactions for your Personal, Maverick and Gladiator accounts so the Financial Center stays current."
            rows={
              banks?.connections
                ? [
                    ["Bank", banks.institutions.join(", ") || "Connected bank"],
                    ["Accounts", banks.accounts.length ? banks.accounts.map((a) => `${a.name}${a.last4 && !a.name.includes(a.last4) ? ` ··${a.last4}` : ""} (${a.company})`).join(", ") : "None shared yet"],
                    ["Last sync", ago(banks.lastSync)],
                  ]
                : []
            }
            permissions="Read-only. Plaid can see balances and transactions; it can't move money."
            action={
              <Link href="/money" className={btn}>
                {banks?.connections ? "Manage or reconnect" : "Connect a bank"}
              </Link>
            }
          />
          <IntegrationCard
            testId="int-qbo"
            name="QuickBooks (Gladiator)"
            state={!s ? "Checking…" : qb?.connected ? "Connected" : "Not connected"}
            tone={qb?.connected ? "on" : "off"}
            purpose="Reads Gladiator's books from your bookkeeper's QuickBooks so its profit and loss shows next to Maverick's."
            rows={qb?.connected ? [["Company", qb.companyName ?? "Connected"], ["Connected", ago(qb.connectedAt)]] : []}
            permissions="Read-only reports. Maverick never changes your QuickBooks."
            action={
              <Link href="/money" className={btn}>
                {qb?.connected ? "Manage" : "Connect"}
              </Link>
            }
          />
          <IntegrationCard
            testId="int-gmail"
            name="Gmail (bills and receipts)"
            state={!s ? "Checking…" : gm?.connected ? "Connected" : gm?.keys ? "Not connected" : "Needs setup"}
            tone={gm?.connected ? "on" : "off"}
            purpose="Finds bills and receipts in your Gmail for the date range you pick, for you to review and assign to Personal, Maverick or Gladiator."
            rows={gm?.connected ? [["Connected", ago(gm.connectedAt)], ["Last scan", ago(gm.lastScan)], ["To review", String(gm.review)]] : []}
            permissions="Read-only, bill and receipt emails only. Maverick can't send, delete or move email."
            action={
              <Link href="/email-bills" className={btn}>
                {gm?.connected ? "Open email bills" : "Set up"}
              </Link>
            }
          />
          <IntegrationCard
            testId="int-docs"
            name="Documents"
            state="Built in"
            tone="on"
            purpose="Receipts, bank statements and tax documents you upload are kept in your private database."
            permissions="Only what you upload. Nothing is pulled from other services."
            action={
              <Link href="/money" className={btn}>
                Open
              </Link>
            }
          />
          <IntegrationCard
            testId="int-google-cal"
            name="Google Calendar"
            state={gc?.connected ? "Connected" : "Built, not connected"}
            tone={gc?.connected ? "on" : "off"}
            purpose={gc?.connected ? `${gc.email ?? "Your Google account"}, last read ${ago(gc.lastRead)}. Shown on the Calendar labeled Google.` : "Your Gmail account's calendars on the Calendar page, labeled Google."}
            permissions="Read-only. Disconnecting it doesn't touch the Gmail bill scans."
            action={<Link href="/calendar" className={btn}>{gc?.connected ? "Open" : "Set up"}</Link>}
          />
          <IntegrationCard
            testId="int-outlook-mail"
            name="Gladiator Outlook mail and calendar"
            state={ms?.connected ? "Connected" : "Built, not connected"}
            tone={ms?.connected ? "on" : "off"}
            purpose={
              ms?.connected
                ? `${ms.email}, connected ${ago(ms.connectedAt)}. Calendar last read ${ago(ms.lastCalendarRead)}.`
                : `Read, search, reply and send from ${ms?.account ?? "vic@gladiatoremergence.com"}, and add or change Gladiator meetings.`
            }
            permissions="Only that one mailbox. Every email, draft or event change shows you a preview first and happens only when you confirm. Nothing is deleted."
            action={<Link href="/gladiator" className={btn}>{ms?.connected ? "Open" : "Set up"}</Link>}
          />
          <IntegrationCard
            testId="int-teams"
            name="Microsoft Teams (Gladiator)"
            state={ms?.teams ? "Connected" : "Built, not connected"}
            tone={ms?.teams ? "on" : "off"}
            purpose="Your Gladiator chats and channel conversations with replies, linked back to Teams. Teams meetings show once, from Outlook."
            permissions="Only chats and channels you're already in. Replies post only after your preview. Reading channels needs a one-time admin OK."
            action={<Link href="/gladiator" className={btn}>{ms?.teams ? "Open" : "Set up"}</Link>}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Home apps</h2>
          <p className="text-sm text-zinc-500">Read-only by default. Anything that shows video or changes a device needs its own yes below.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <IntegrationCard
            testId="int-ring"
            name="Ring"
            state="Not connected"
            tone="off"
            purpose="Doorbells, cameras and alarm: see device status and recent rings and motion in one place."
            rows={[
              ["Devices", "None yet"],
              ["Last event", "None yet"],
            ]}
            permissions={
              Object.values(ring).some(Boolean)
                ? `You've allowed: ${CAPABILITIES.filter((x) => ring[x.id]).map((x) => x.label.toLowerCase()).join(", ")}.`
                : "Nothing allowed yet. Everything starts off."
            }
            action={<span className={btnOff}>Connect (not available yet)</span>}
          >
            <fieldset className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/60" data-testid="ring-consent">
              <legend className="sr-only">What Ring may do</legend>
              {CAPABILITIES.map((cap) => (
                <label key={cap.id} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--brand)]"
                    checked={!!ring[cap.id]}
                    onChange={(e) => {
                      if (e.target.checked && cap.sensitive && !window.confirm(`Allow Ring: ${cap.label.toLowerCase()}?\n\n${cap.detail}`)) return;
                      consents.set((d) => setAllowed(d, "ring", cap.id, e.target.checked));
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {cap.label}
                      {cap.sensitive && <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">needs your yes</span>}
                    </span>
                    <span className="block text-xs text-zinc-500">{cap.detail}</span>
                  </span>
                </label>
              ))}
              <p className="text-xs text-zinc-500">
                Ring doesn&apos;t offer an official connection for personal apps yet, and Maverick won&apos;t ask for your Ring password. Your choices here are saved and used once a safe connection exists.
              </p>
            </fieldset>
          </IntegrationCard>
          {HOME_KINDS.map((k) => (
            <IntegrationCard key={k} testId={`int-home-${k}`} name={k} state="Not connected" tone="off" purpose="Room for the app you use. Same rules: read-only first, and anything that changes a device needs your yes." permissions="Nothing allowed." />
          ))}
        </div>
      </section>
    </div>
  );
}
