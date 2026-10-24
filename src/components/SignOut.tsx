"use client";

import type { ReactNode } from "react";

export function SignOut({ className = "hover:text-brand", children = "Sign out" }: { className?: string; children?: ReactNode }) {
  return (
    <button
      className={className}
      onClick={async () => {
        await fetch("/api/logout", { method: "POST" }).catch(() => null);
        window.location.href = "/login";
      }}
    >
      {children}
    </button>
  );
}
