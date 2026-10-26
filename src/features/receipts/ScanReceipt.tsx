"use client";

import { useEffect, useRef, useState } from "react";
import { money, today } from "@/features/money/calc";
import { setMoneyData, useMoneyData } from "@/features/money/store";
import { COMPANIES, type MoneyData, type Scope } from "@/features/money/types";
import { likelyMatches, updateReceipt, uploadReceipt } from "@/features/money/receipts";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";
import { readReceiptPhoto, warmReader } from "./ocr";
import { SECTION_LABEL } from "./folders";

/*
 * One tap to scan a receipt: the phone's camera opens, the photo is saved right
 * away (so nothing is lost if you walk off), and the store, date and total are
 * read off it on the phone for you to check. Until you check it and pick whose
 * it is, the receipt sits in Needs review. Scanning never touches a bill and
 * never marks anything paid.
 */

const WHOSE: { value: Scope; label: string }[] = [{ value: "personal", label: "Personal" }, ...COMPANIES.map((c) => ({ value: c.value, label: c.label }))];

type Step = "idle" | "saving" | "reading" | "check" | "done";

const parseAmount = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

export function ScanReceipt({ data, big = false }: { data: MoneyData; big?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("idle");
  const [id, setId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [readNothing, setReadNothing] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [scope, setScope] = useState<Scope | null>(null);
  const [linked, setLinked] = useState<string | undefined>(undefined);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const receipt = id ? data.receipts.find((r) => r.id === id) : undefined;

  function reset() {
    setStep("idle");
    setId(null);
    setPreview(null);
    setError(null);
    setReadNothing(false);
    setMerchant("");
    setAmount("");
    setDate(today());
    setScope(null);
    setLinked(undefined);
    setProgress(0);
  }

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (camera.current) camera.current.value = "";
    if (library.current) library.current.value = "";
    if (!file) return;
    reset();
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setStep("saving");
    const reading = readReceiptPhoto(file, today(), setProgress);
    let saved;
    try {
      saved = await uploadReceipt(file, { date: today(), scope: undefined });
    } catch (e) {
      setError((e as Error).message);
      setStep("idle");
      return;
    }
    setMoneyData((d) => ({ ...d, receipts: [{ ...saved, unchecked: true }, ...d.receipts] }));
    setId(saved.id);
    setStep("reading");
    const guess = await reading;
    const patch = { merchant: guess.merchant, date: guess.date ?? saved.date, amount: guess.amount };
    updateReceipt(saved.id, patch);
    setMerchant(patch.merchant);
    setDate(patch.date);
    setAmount(patch.amount === null ? "" : patch.amount.toFixed(2));
    setReadNothing(!guess.merchant && !guess.date && guess.amount === null);
    setStep("check");
  }

  function save() {
    if (!id || !scope) return;
    const n = parseAmount(amount);
    updateReceipt(id, { merchant: merchant.trim(), date, amount: n, scope, transactionId: linked, unchecked: n === null });
    setStep("done");
  }

  const n = parseAmount(amount);
  const matches = receipt && step === "check" ? likelyMatches(data, { ...receipt, amount: n, date }) : [];
  const busy = step === "saving" || step === "reading";

  return (
    <Card title="Scan a receipt">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files)} />
      <input ref={library} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onPick(e.target.files)} />

      {(step === "idle" || step === "done") && (
        <div className="flex flex-col gap-3">
          {step === "done" && receipt && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              ✓ Saved{receipt.merchant ? ` ${receipt.merchant}` : ""}
              {receipt.amount !== null ? `, ${money(receipt.amount)}` : ""} to {receipt.date.slice(0, 4)} ›{" "}
              {receipt.unchecked ? SECTION_LABEL.review : SECTION_LABEL[receipt.scope ?? "review"]}.
            </p>
          )}
          <button
            className={`${buttonClass} flex items-center justify-center gap-2 ${big ? "py-5 text-lg lg:py-4" : "py-3 text-base"}`}
            onClick={() => {
              camera.current?.click();
              warmReader(); // loads while you line up the shot
            }}
          >
            <span aria-hidden="true">📷</span> {step === "done" ? "Scan another receipt" : "Scan receipt"}
          </button>
          <button className="self-center text-sm text-zinc-500 underline-offset-2 hover:underline" onClick={() => {
            library.current?.click();
            warmReader();
          }}>
            Or pick a photo or PDF you already have
          </button>
          {step === "idle" && (
            <p className="text-center text-xs text-zinc-500">
              Lay it flat in good light and fill the screen. The store, date and total are read on your phone for you to check.
            </p>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      )}

      {(busy || step === "check") && (
        <div className="flex flex-col gap-4 sm:flex-row">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local photo you just took
            <img src={preview} alt="Your receipt" className="max-h-48 w-full rounded-lg sm:max-h-72 border border-zinc-200 object-contain sm:w-48 dark:border-zinc-800" />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500 sm:w-48 dark:border-zinc-800">PDF</div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {busy ? (
              <div className="flex flex-col gap-2 py-4">
                <p className="text-sm font-medium">{step === "saving" ? "Saving your photo…" : "Reading the receipt…"}</p>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full bg-brand transition-all" style={{ width: `${Math.round((step === "saving" ? 0.1 : 0.1 + progress * 0.9) * 100)}%` }} />
                </div>
                <p className="text-xs text-zinc-500">Already saved. If you leave now, it waits in Needs review.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-500">
                  {readNothing ? "Couldn't read this one. Type what it says." : "Check what was read, then pick whose it is."}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <Field label="Store">
                      <input className={inputClass} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Home Depot" />
                    </Field>
                  </div>
                  <Field label="Total">
                    <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </Field>
                  <Field label="Date">
                    <input type="date" className={inputClass} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
                  </Field>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-zinc-500">Whose is it?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {WHOSE.map((w) => (
                      <button
                        key={w.value}
                        aria-pressed={scope === w.value}
                        onClick={() => setScope(w.value)}
                        className={`rounded-lg border px-2 py-2.5 text-sm font-medium ${scope === w.value ? "border-brand bg-brand text-on-brand" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"}`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
                {matches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-zinc-500">Same purchase as:</span>
                    {matches.map((t) => (
                      <button
                        key={t.id}
                        aria-pressed={linked === t.id}
                        className={linked === t.id ? `${ghostButtonClass} border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200` : ghostButtonClass}
                        onClick={() => {
                          setLinked(linked === t.id ? undefined : t.id);
                          if (!merchant.trim()) setMerchant(t.description);
                        }}
                      >
                        {linked === t.id ? "✓ " : ""}
                        {t.description} · {t.date}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button className={`${buttonClass} py-2.5`} disabled={!scope} onClick={save}>
                    {scope ? "Save receipt" : "Pick whose it is to save"}
                  </button>
                  <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => {
                    if (id) updateReceipt(id, { merchant: merchant.trim(), date, amount: n });
                    reset();
                  }}>
                    Finish later
                  </button>
                </div>
                {scope && n === null && <p className="text-xs text-zinc-500">No total yet, so it stays in Needs review.</p>}
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** The scan button anywhere in the app: waits for your money data, then shows the scanner. */
export function ScanPanel({ big = false }: { big?: boolean }) {
  const data = useMoneyData();
  if (!data) return <Card title="Scan a receipt"><p className="text-sm text-zinc-500">Loading…</p></Card>;
  return <ScanReceipt data={data} big={big} />;
}
