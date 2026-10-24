"use client";

import { BUCKETS, bucketOf, scopeForBucket, type Bucket } from "./bill-intel";
import type { Scope } from "./types";
import { Field, inputClass } from "./ui";

/** The two owners of bills, never mixed: Personal / Maverick and Gladiator. */
export function BucketChip({ bucket, scope }: { bucket?: Bucket | "all"; scope?: Scope }) {
  const b = bucket ?? bucketOf(scope);
  if (b === "all") return <span className="inline-flex shrink-0 items-center rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-300">All entities</span>;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        b === "gladiator" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-ember/15 text-brand"
      }`}
    >
      {b === "gladiator" ? "Gladiator" : "Personal / Maverick"}
    </span>
  );
}

/** Pick the owner of a bill. Keeps Maverick as Maverick when it stays in Personal / Maverick. */
export function BucketField({ value, onChange, label = "Belongs to" }: { value: Scope; onChange: (s: Scope) => void; label?: string }) {
  return (
    <Field label={label}>
      <select className={inputClass} value={bucketOf(value)} onChange={(e) => onChange(scopeForBucket(e.target.value as Bucket, value))}>
        {BUCKETS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Account owner, with the three books grouped under the two bill owners. */
export function AccountOwnerSelect({ value, onChange, className = inputClass }: { value: Scope; onChange: (s: Scope) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value as Scope)} aria-label="Account belongs to">
      <optgroup label="Personal / Maverick">
        <option value="personal">Personal</option>
        <option value="business">Maverick</option>
      </optgroup>
      <optgroup label="Gladiator">
        <option value="gladiator">Gladiator</option>
      </optgroup>
    </select>
  );
}
