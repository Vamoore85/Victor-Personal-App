"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buttonClass, ghostButtonClass } from "@/features/money/ui";
import { normalizeCode } from "@/lib/wade-code";

type Link = { id: string; userCode: string; status: string; createdAt: number; approvedAt: number | null; expiresAt: number; lastUsedAt: number | null };

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "never");

/** Approve or disconnect Wade's read-only access to the Financial Center. */
export function MoneyAccess() {
  const code = normalizeCode(useSearchParams().get("code"));
  const [links, setLinks] = useState<Link[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/wade/link/list", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!live) return;
        if (ok) setLinks(j.links);
        else setMessage(j.error ?? "Couldn't load Wade's access.");
      })
      .catch(() => live && setMessage("Couldn't load Wade's access."));
    return () => { live = false; };
  }, []);

  async function post(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setMessage(j.error ?? "That didn't work.");
      setLinks(j.links);
      setMessage(done);
    } finally {
      setBusy(false);
    }
  }

  const waiting = code ? links?.find((l) => l.userCode === code && l.status === "pending") : undefined;
  const active = (links ?? []).filter((l) => l.status === "approved");

  return (
    <div className="flex flex-col gap-4">
      {code && (
        <section className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800" data-testid="wade-approve">
          <p className="text-lg font-semibold">Let Wade read your money?</p>
          <p className="mt-1 text-sm text-zinc-500">
            Wade on your Mac asked to read balances, transactions, bills and budgets for Personal, Maverick and Gladiator.
            Read only: no payments, transfers or changes, and never your logins, vault, receipts or tax files.
          </p>
          <p className="mt-3 font-mono text-2xl tracking-widest">{code}</p>
          <p className="mt-1 text-sm text-zinc-500">Only approve if Wade on your Mac is showing this same code right now.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={buttonClass} disabled={busy || !waiting}
              onClick={() => post("/api/wade/link/approve", { code }, "Approved. Wade can now read your money.")}>
              Approve
            </button>
          </div>
          {links && !waiting && <p className="mt-2 text-sm text-zinc-500">This code isn&apos;t waiting anymore. Start again from Wade.</p>}
        </section>
      )}
      <section className="rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <p className="font-semibold">Wade&apos;s money access</p>
        {links === null ? <p className="text-sm text-zinc-500">Loading…</p> : active.length === 0 ? (
          <p className="text-sm text-zinc-500">Wade can&apos;t read your money right now.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {active.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>Approved {when(l.approvedAt)} · last read {when(l.lastUsedAt)} · ends {when(l.expiresAt)}</span>
                <button type="button" className={ghostButtonClass} disabled={busy}
                  onClick={() => post("/api/wade/link/revoke", { id: l.id }, "Disconnected. Wade can no longer read your money.")}>
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {message && <p className="text-sm" role="status">{message}</p>}
    </div>
  );
}
