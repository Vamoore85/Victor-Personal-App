"use client";

import { useState } from "react";
import { setMoneyData, newId } from "./store";
import { isVaultUnlocked, saveVaultEntries, useVault } from "./vault";
import { parseLoginRows, planLoginImport, type ImportPlan } from "./logins-import";
import { useDefaultScope } from "./scope";
import { Card, buttonClass, ghostButtonClass, inputClass } from "./ui";
import type { MoneyData } from "./types";

/*
 * Paste logins from a spreadsheet straight into the vault. The vault encrypts
 * them in this browser with your master password; the text box is cleared as
 * soon as they're saved, and nothing is sent anywhere.
 */
export function PasteLogins({ data }: { data: MoneyData }) {
  const vault = useVault();
  const scope = useDefaultScope();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ plan: ImportPlan; skipped: number } | null>(null);
  const [message, setMessage] = useState("");

  if (vault.status !== "unlocked") {
    return (
      <Card title="Paste logins into the vault">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {vault.status === "none"
            ? "Set up your vault first (the Maverick Vault bar above). Then you can paste your logins here."
            : "Unlock the vault above, then you can paste your logins here."}
        </p>
      </Card>
    );
  }

  const saved = vault.entries;

  function check() {
    const { rows, skipped } = parseLoginRows(text);
    if (!rows.length) {
      setPreview(null);
      setMessage(skipped ? `None of the ${skipped} rows had a login or company name.` : "Paste your rows first.");
      return;
    }
    setMessage("");
    setPreview({ plan: planLoginImport(rows, data.institutions, saved, scope, newId), skipped });
  }

  async function save() {
    if (!preview) return;
    if (!isVaultUnlocked()) {
      setMessage("The vault locked before saving. Unlock it and press Check again.");
      return;
    }
    const { plan } = preview;
    await saveVaultEntries((prev) => [...prev, ...plan.entries]);
    if (plan.institutions.length) setMoneyData((d) => ({ ...d, institutions: [...d.institutions, ...plan.institutions] }));
    setText("");
    setPreview(null);
    setMessage(
      `Saved ${plan.entries.length} login${plan.entries.length === 1 ? "" : "s"} to the vault` +
        (plan.institutions.length ? ` and added ${plan.institutions.length} compan${plan.institutions.length === 1 ? "y" : "ies"}` : "") +
        (plan.duplicates ? `. ${plan.duplicates} already there, left alone` : "") +
        ".",
    );
  }

  return (
    <Card title="Paste logins into the vault">
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
        In your spreadsheet, select the rows and copy them, then paste here. Columns can be Company, Website, Username, Password, Notes, in any order, with or without a header row. Tabs and commas both work.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={6}
        spellCheck={false}
        autoComplete="off"
        aria-label="Logins to paste"
        className={`${inputClass} font-mono text-xs`}
        placeholder={"Company\tWebsite\tUsername\tPassword\tNotes"}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={ghostButtonClass} onClick={check} disabled={!text.trim()}>
          Check the rows
        </button>
        {preview && (
          <button className={buttonClass} onClick={save} disabled={preview.plan.entries.length === 0}>
            Save {preview.plan.entries.length} login{preview.plan.entries.length === 1 ? "" : "s"} to the vault
          </button>
        )}
      </div>
      {message && <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{message}</p>}
      {preview && (
        <div className="mt-4 flex flex-col gap-2 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">
            {preview.plan.entries.length} ready
            {preview.plan.institutions.length ? `, ${preview.plan.institutions.length} new compan${preview.plan.institutions.length === 1 ? "y" : "ies"}` : ""}
            {preview.plan.duplicates ? `, ${preview.plan.duplicates} already in the vault (skipped)` : ""}
            {preview.skipped ? `, ${preview.skipped} row${preview.skipped === 1 ? "" : "s"} with no login or name (skipped)` : ""}. Passwords are hidden here.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="py-1 pr-3 font-medium">Company</th>
                  <th className="py-1 pr-3 font-medium">Website</th>
                  <th className="py-1 pr-3 font-medium">Username</th>
                  <th className="py-1 font-medium">Password</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.entries.map((e) => {
                  const company = [...data.institutions, ...preview.plan.institutions].find((i) => i.id === e.institutionId);
                  return (
                    <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1 pr-3">{company?.name ?? "—"}</td>
                      <td className="py-1 pr-3 break-all text-xs text-zinc-500">{e.url || "—"}</td>
                      <td className="py-1 pr-3 break-all">{e.username || "—"}</td>
                      <td className="py-1 font-mono">••••••••</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
