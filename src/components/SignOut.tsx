"use client";

import type { ReactNode } from "react";

export function SignOut({ className = "hover:text-brand", children = "Sign out" }: { className?: string; children?: ReactNode }) {
  return (
    <button
      className={className}
      onClick={async () => {
        // An open Wade frame signs Maverick out of Wade first; wait briefly for it, never forever.
        const waits: Promise<unknown>[] = [];
        window.dispatchEvent(new CustomEvent("maverick-sign-out", { detail: { waitFor: (p: Promise<unknown>) => waits.push(p) } }));
        if (waits.length) await Promise.race([Promise.allSettled(waits), new Promise((r) => setTimeout(r, 4000))]);
        await fetch("/api/logout", { method: "POST" }).catch(() => null);
        window.location.href = "/login";
      }}
    >
      {children}
    </button>
  );
}
