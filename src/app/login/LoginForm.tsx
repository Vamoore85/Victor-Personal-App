"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { buttonClass, inputClass } from "@/features/money/ui";

export function LoginForm() {
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      // Only follow same-site paths.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      return;
    }
    const json = res ? await res.json().catch(() => ({})) : {};
    setError(json.error || "Couldn't sign in. Check your connection.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        type="password"
        className={inputClass}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        autoFocus
        aria-label="Password"
      />
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <button className={buttonClass} disabled={!password || busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
