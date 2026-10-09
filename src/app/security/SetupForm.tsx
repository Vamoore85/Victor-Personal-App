"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, inputClass } from "@/features/money/ui";

export function SetupForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.href = "/";
      return;
    }
    const json = res ? await res.json().catch(() => ({})) : {};
    setError(json.error || "Couldn't check the code. Check your connection.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      <input
        className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6-digit code"
      />
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <button className={buttonClass} disabled={code.length !== 6 || busy}>
        {busy ? "Checking…" : "Turn on 2-step sign-in"}
      </button>
    </form>
  );
}
