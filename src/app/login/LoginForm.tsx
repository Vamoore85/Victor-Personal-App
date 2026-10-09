"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { buttonClass, inputClass } from "@/features/money/ui";

export function LoginForm() {
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(needCode ? { password, code } : { password }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && json.setup) {
      window.location.href = "/security";
      return;
    }
    if (res?.ok && json.needCode) {
      setNeedCode(true);
      setBusy(false);
      return;
    }
    if (res?.ok) {
      // Only follow same-site paths.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      return;
    }
    setError(json.error || "Couldn't sign in. Check your connection.");
    setBusy(false);
  }

  if (needCode) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-center text-sm text-zinc-500">Enter the 6-digit code from your authenticator app.</p>
        <input
          className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-label="6-digit code"
        />
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <button className={buttonClass} disabled={code.length !== 6 || busy}>
          {busy ? "Checking…" : "Verify"}
        </button>
        <button
          type="button"
          className="text-xs text-zinc-500 hover:text-brand"
          onClick={() => {
            setNeedCode(false);
            setCode("");
            setError("");
          }}
        >
          Back
        </button>
      </form>
    );
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
