"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushCloud, reloadFromCloud } from "@/features/money/store";
import { BILL_FREQUENCIES } from "@/features/money/types";
import type { EmailRecurringBill } from "./recurring";

export function RecurringEmailBills() {
  const [groups, setGroups] = useState<EmailRecurringBill[]>([]);
  const [error, setError] = useState("");
  const running = useRef(false);
  const load = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await flushCloud();
      const res = await fetch("/api/gmail/recurring", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Couldn't update recurring email bills.");
      setGroups(result.groups);
      setError("");
      // Pick up bills saved by a scan in another tab, including its newer revision.
      await reloadFromCloud();
    } catch (e) { setError((e as Error).message); }
    finally { running.current = false; }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  if (error) return <p role="status" className="text-sm text-amber-700">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>;
  if (!groups.length) return null;
  return (
    <details className="rounded-xl border border-zinc-200 bg-surface px-4 py-3 dark:border-zinc-800" data-testid="email-recurring-bills">
      <summary className="cursor-pointer font-medium">Recurring bills from email · {groups.length}</summary>
      <p className="my-2 text-sm text-zinc-500">Current bills with a clear company and due date join Bills and its calendar. Older or unclear items stay here to check.</p>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {groups.map(group => <li key={group.key} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="min-w-0"><p className="font-medium">{group.name} · {BILL_FREQUENCIES.find(f => f.value === group.frequency)?.label}</p><p className="text-zinc-500">{group.reason}</p></div>
          <Link className="shrink-0 text-brand underline" href={`/email-bills#email-${group.latest.id}`}>{group.billId ? "Source" : "Check details"}</Link>
        </li>)}
      </ul>
    </details>
  );
}
