"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "@/features/money/calc";
import { Card, Empty, ghostButtonClass, buttonClass } from "@/features/money/ui";
import { prettyDate } from "@/lib/dates";
import { gmailLink } from "@/features/gmail/match";
import { SECTION_LABEL, SECTIONS, type FolderEntry, type Section, type YearSummary } from "./folders";

/*
 * Receipt folders: one folder per year, each split into Personal, Maverick,
 * Gladiator and Needs review, with a ZIP download of the originals. This
 * screen only reads; confirming emails happens on Email bills, and nothing
 * here marks a bill paid.
 */

// Company colors, as on the Bills page: Maverick blue, Personal green, Gladiator orange.
const TONE: Record<Section, { box: string; dot: string }> = {
  personal: { box: "border-green-200 dark:border-green-900", dot: "bg-green-600" },
  business: { box: "border-blue-200 dark:border-blue-900", dot: "bg-blue-600" },
  gladiator: { box: "border-orange-200 dark:border-orange-900", dot: "bg-orange-500" },
  review: { box: "border-amber-300 dark:border-amber-800", dot: "bg-amber-500" },
};

type Loaded = { years: YearSummary[]; entries: FolderEntry[]; email: string | null };

const zipUrl = (year: string, section?: Section) => `/api/receipt-folders/zip?year=${year}${section ? `&section=${section}` : ""}`;

export function ReceiptFolders({ selectedYear, onYearChange, refreshKey }: { selectedYear?: string; onYearChange?: (year: string) => void; refreshKey?: string } = {}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [open, setOpen] = useState<Section | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/receipt-folders", { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json.error || "Couldn't load your receipt folders.");
        return json as Loaded;
      })
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const shownYear = selectedYear ?? year ?? data?.years[0]?.year ?? null;
  const summary = data?.years.find((y) => y.year === shownYear);
  const inYear = data?.entries.filter((e) => e.year === shownYear) ?? [];

  return (
    <Card
      title="Receipt folders"
      action={
        shownYear && (
          <a className={buttonClass} href={zipUrl(shownYear)} data-testid="zip-year">
            Download {shownYear} ZIP
          </a>
        )
      }
    >
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : data.years.length === 0 ? (
        <Empty>
          No receipts yet. Add receipt photos below, or find bills and receipts in <Link className="text-brand underline" href="/email-bills">Email bills</Link>.
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Year">
            {data.years.map((y) => (
              <button
                key={y.year}
                role="tab"
                aria-selected={y.year === shownYear}
                onClick={() => {
                  setYear(y.year);
                  onYearChange?.(y.year);
                  setOpen(null);
                }}
                className={`rounded-full px-3 py-1 text-sm ${y.year === shownYear ? "bg-brand text-on-brand" : "border border-zinc-300 dark:border-zinc-700"}`}
              >
                📁 {y.year}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            {SECTIONS.map((s) => {
              const t = summary?.sections[s] ?? { count: 0, total: 0 };
              return (
                <div key={s} className={`flex flex-col gap-2 rounded-xl border-2 p-3 ${TONE[s].box} ${open === s ? "ring-2 ring-brand" : ""}`} data-testid={`folder-${s}`}>
                  <button className="flex items-center gap-2 text-left" onClick={() => setOpen(open === s ? null : s)} aria-expanded={open === s}>
                    <span className={`h-2.5 w-2.5 rounded-full ${TONE[s].dot}`} />
                    <span className="font-medium">{SECTION_LABEL[s]}</span>
                    <span className="ml-auto text-xs text-zinc-500">{open === s ? "Hide" : "Open"}</span>
                  </button>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {t.count} {t.count === 1 ? "item" : "items"}
                    {t.total > 0 && ` · ${money(t.total)}`}
                  </p>
                  {t.count > 0 && (
                    <a className={`${ghostButtonClass} self-start`} href={zipUrl(shownYear!, s)}>
                      Download ZIP
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {open && (
            <FolderList
              section={open}
              entries={inYear.filter((e) => e.section === open)}
              email={data.email}
            />
          )}

          <p className="text-xs text-zinc-500">
            Folders only file what you have; they never confirm an email or mark a bill paid. Needs review holds email finds you haven&apos;t confirmed on{" "}
            <Link className="underline" href="/email-bills">Email bills</Link> and receipts with no company or amount. The ZIP has the original emails (.eml) and
            receipt files unchanged, plus an index.csv.
          </p>
        </div>
      )}
    </Card>
  );
}

function FolderList({ section, entries, email }: { section: Section; entries: FolderEntry[]; email: string | null }) {
  if (entries.length === 0) return <Empty>Nothing in {SECTION_LABEL[section]} for this year.</Empty>;
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {entries.map((e) => (
        <li key={e.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
          <span className="w-24 shrink-0 text-zinc-500">{prettyDate(e.date, { month: "short", day: "numeric" })}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{e.merchant}</span>
            <span className="ml-2 text-xs text-zinc-500">
              {e.source === "email" ? `${e.kind === "bill" ? "Bill" : "Receipt"} from Gmail` : "Uploaded receipt"}
              {section === "review" && e.scope && ` · ${SECTION_LABEL[e.scope]}?`}
            </span>
            {e.why && <span className="block text-xs text-amber-700 dark:text-amber-400">{e.why}</span>}
          </span>
          <span className="tabular-nums">{e.amount === null ? "No amount" : money(e.amount)}</span>
          {e.source === "email" && e.gmailId ? (
            <a className="text-xs text-brand underline" href={gmailLink({ id: e.gmailId, messageId: e.messageId }, email)} target="_blank" rel="noreferrer">
              Open in Gmail
            </a>
          ) : e.fileId ? (
            <a className="text-xs text-brand underline" href={`/api/receipts/${e.fileId}`} target="_blank" rel="noopener noreferrer">
              Open file
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
