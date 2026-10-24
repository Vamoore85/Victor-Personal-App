"use client";

import { useEffect } from "react";
import { hasUnsavedChanges } from "@/features/money/store";

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
const TRIED = "maverick.reloaded-for";

/**
 * A tab left open (or restored by the phone) keeps running the version it
 * loaded. When the site has been updated since, reload into the new version,
 * but only when nothing is waiting to be saved, and only once per update.
 */
export function FreshBuild() {
  useEffect(() => {
    if (BUILD === "dev") return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await res.json()) as { build?: string };
        if (stopped || !build || build === "dev" || build === BUILD) return;
        if (sessionStorage.getItem(TRIED) === build || hasUnsavedChanges()) return;
        sessionStorage.setItem(TRIED, build);
        location.reload();
      } catch {
        /* offline or signed out: try again later */
      }
    };
    void check();
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, []);
  return null;
}
