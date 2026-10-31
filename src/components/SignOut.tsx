"use client";

import { useState, type ReactNode } from "react";

export function SignOut({ className = "hover:text-brand", children = "Sign out" }: { className?: string; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError("");
        // An open Wade frame signs Maverick out of Wade first; wait briefly for it, never forever.
        const waits: Promise<unknown>[] = [];
        window.dispatchEvent(new CustomEvent("maverick-sign-out", { detail: { waitFor: (p: Promise<unknown>) => waits.push(p) } }));
        if (waits.length) await Promise.race([Promise.allSettled(waits), new Promise((r) => setTimeout(r, 4000))]);
        const response = await fetch("/api/logout", { method: "POST" }).catch(() => null);
        if (!response?.ok) {
          setError("Couldn't sign out. Check your connection and try again.");
          setBusy(false);
          return;
        }
        window.location.href = "/login";
      }}
    >
      {busy ? "Signing out…" : children}
    </button>
    {error && <span role="alert" className="block text-sm text-rose-600 dark:text-rose-400">{error}</span>}
    </>
  );
}
