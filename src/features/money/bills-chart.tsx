"use client";

import { useState } from "react";
import { billMonthlyCost, dueLabel, frequencyLabel, money, shortDate, daysUntil } from "./calc";
import { ScopeBadge } from "./scope";
import type { Bill, Institution, MoneyData } from "./types";
import { useVault, type VaultEntry } from "./vault";
import { CopyButton, VaultBar } from "./vault-ui";
import { Card, Empty, ghostButtonClass } from "./ui";

/*
 * One chart of every bill with where it's paid and the login for it. Logins
 * come from Maverick Vault (matched through the bill's company) and only show
 * while the vault is unlocked; the download leaves passwords out.
 */

const linkClass = "underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100";

/** The bill's company: the one picked on the bill, or one whose name matches. */
function companyFor(bill: Bill, institutions: Institution[]) {
  if (bill.institutionId) return institutions.find((i) => i.id === bill.institutionId);
  const name = bill.name.toLowerCase();
  return institutions.find((i) => {
    const n = i.name.toLowerCase().trim();
    return n.length > 2 && (name.includes(n) || n.includes(name));
  });
}

function dueTone(ymd: string) {
  const days = daysUntil(ymd);
  if (days < 0) return "text-rose-600 dark:text-rose-400";
  if (days <= 3) return "text-amber-600 dark:text-amber-400";
  return "text-zinc-500";
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function BillsChart({ data, onEdit, onPaid }: { data: MoneyData; onEdit: (bill: Bill) => void; onPaid: (bill: Bill) => void }) {
  const vault = useVault();
  const [revealed, setRevealed] = useState<string | null>(null);
  const unlocked = vault.status === "unlocked";
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]));

  const rows = [...data.bills]
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))
    .map((bill) => {
      const company = companyFor(bill, data.institutions);
      const logins: VaultEntry[] = unlocked && company ? vault.entries.filter((e) => e.institutionId === company.id) : [];
      const payAt = bill.url || company?.loginUrl || company?.website || "";
      return { bill, company, logins, payAt };
    });
  const monthly = data.bills.reduce((s, b) => s + billMonthlyCost(b), 0);
  const missingLogins = unlocked ? rows.filter((r) => r.logins.length === 0).length : 0;

  function download() {
    const head = ["Bill", "Amount", "How often", "Next due", "Autopay", "Pay from", "Company", "Pay or sign in at", "Username"];
    const lines = rows.map(({ bill, company, logins, payAt }) =>
      [
        bill.name,
        bill.amount.toFixed(2),
        frequencyLabel(bill),
        bill.nextDue,
        bill.autopay ? "Yes" : "No",
        accountNames.get(bill.accountId) ?? "",
        company?.name ?? "",
        payAt,
        logins.map((l) => l.username).filter(Boolean).join(" / "),
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bills-and-logins.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      {!unlocked && <VaultBar />}
      <Card
        title="Bills and logins"
        action={
          data.bills.length > 0 && (
            <button className={ghostButtonClass} onClick={download} title="Usernames are included; passwords never are">
              Download
            </button>
          )
        }
      >
        {data.bills.length === 0 ? (
          <Empty>No bills yet. Add rent, utilities, phone, insurance, subscriptions and so on below, and each shows up here with where to pay and its login.</Empty>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="py-2 pr-3 font-medium">Bill</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Next due</th>
                    <th className="py-2 pr-3 font-medium">Pays from</th>
                    <th className="py-2 pr-3 font-medium">Pay here</th>
                    <th className="py-2 pr-3 font-medium">Login</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {rows.map(({ bill, company, logins, payAt }) => (
                    <tr key={bill.id} className="align-top">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">
                          {bill.name}
                          <ScopeBadge item={bill} />
                        </p>
                        <p className="text-xs text-zinc-500">
                          {frequencyLabel(bill)}
                          {bill.autopay && " · Autopay"}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{money(bill.amount)}</td>
                      <td className="py-2.5 pr-3">
                        <p>{shortDate(bill.nextDue)}</p>
                        <p className={`text-xs ${dueTone(bill.nextDue)}`}>{dueLabel(bill.nextDue)}</p>
                      </td>
                      <td className="py-2.5 pr-3 text-zinc-600 dark:text-zinc-400">{accountNames.get(bill.accountId) ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        {payAt ? (
                          <a href={payAt} target="_blank" rel="noopener noreferrer" className={linkClass}>
                            {company?.name || "Open"} ↗
                          </a>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {!unlocked ? (
                          <span className="text-xs text-zinc-400">🔒 Locked</span>
                        ) : logins.length === 0 ? (
                          <span className="text-xs text-zinc-400">{company ? `None saved for ${company.name}` : "Pick its company on the bill"}</span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {logins.map((l) => {
                              const open = revealed === l.id;
                              return (
                                <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-xs">
                                  <span className="truncate font-mono">{l.username || "—"}</span>
                                  {l.username ? <CopyButton value={l.username} label="Copy" /> : <span />}
                                  <span className="truncate font-mono">{open ? l.password : "••••••••"}</span>
                                  <span className="flex gap-2">
                                    <button
                                      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                                      onClick={() => setRevealed(open ? null : l.id)}
                                    >
                                      {open ? "Hide" : "Show"}
                                    </button>
                                    <CopyButton value={l.password} label="Copy" />
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center justify-end gap-3">
                        <button className={ghostButtonClass} onClick={() => onPaid(bill)} title="Log the payment and move to the next date">
                          Paid
                        </button>
                        <button className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onEdit(bill)}>
                          Edit
                        </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                    <td className="py-2.5 pr-3">About per month</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{money(monthly)}</td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {missingLogins > 0 && (
              <p className="mt-3 text-xs text-zinc-500">
                {missingLogins} bill{missingLogins === 1 ? " has" : "s have"} no login yet. Pick the bill&apos;s company when you edit it, then add the
                login under that company in Maverick Vault.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
