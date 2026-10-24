"use client";

import { useSyncExternalStore } from "react";
import { OWNER_FIRST_NAME } from "@/config/app";

// The hour comes from the viewer's own clock, so it's read only in the browser.
const noop = () => () => {};
const hourNow = () => new Date().getHours();
const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export function Greeting() {
  const hour = useSyncExternalStore(noop, hourNow, () => null);
  const date = useSyncExternalStore(noop, today, () => "");
  const part = hour === null ? "Welcome" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <p className="text-xs text-zinc-500">{date || " "}</p>
      <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
        {part}, {OWNER_FIRST_NAME}
      </h1>
    </>
  );
}
