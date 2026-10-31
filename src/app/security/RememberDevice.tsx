"use client";

import { useState } from "react";
import { SignOut } from "@/components/SignOut";
import { buttonClass } from "@/features/money/ui";

export function RememberDevice({ initialUntil }: { initialUntil: number | null }) {
  const [until, setUntil] = useState(initialUntil);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remember() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/session/remember", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remember: true }),
      });
      const json = await res.json();
      if (!res.ok || typeof json.rememberedUntil !== "number") throw new Error(json.error || "Couldn't remember this device. Try again.");
      setUntil(json.rememberedUntil);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remember this device. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="remember-heading" className="mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 id="remember-heading" className="text-lg font-semibold">Remember this Mac</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        Stay signed in for 90 days when you close and reopen this browser or installed app. Only use this on your own device.
      </p>
      <p className="mt-2 text-sm text-zinc-500">Other browsers and devices still need their own sign-in. Signing out or clearing cookies ends it here.</p>
      {until ? (
        <>
          <p role="status" className="mt-4 font-medium text-emerald-700 dark:text-emerald-400">
            This browser or app is remembered until {new Date(until).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.
          </p>
          <SignOut className="mt-3 text-sm underline">Forget this browser and sign out</SignOut>
        </>
      ) : (
        <button className={`${buttonClass} mt-4`} disabled={busy} onClick={remember}>
          {busy ? "Remembering…" : "Remember this Mac for 90 days"}
        </button>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </section>
  );
}
