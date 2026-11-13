// Dry run of the one-off money clean-up (src/features/money/cleanup-plan.ts).
// Reads a saved copy of the money document from a file and prints what the clean-up WOULD change.
// It never writes anything and never connects to the database or a bank.
//
//   node --import tsx scripts/money-cleanup-dryrun.ts money.json [--today YYYY-MM-DD] [--list]
//
// money.json is the `data` column of app_docs where key = 'money' (or the whole {rev, data} row).
// Without --list only counts are printed; --list adds one line per item (dates, names, ids; never amounts or account numbers).
import { readFileSync } from "node:fs";
import { asMoney } from "../src/lib/money-doc";
import { cleanAccounts } from "../src/features/money/accounts-fix";
import { planCleanup } from "../src/features/money/cleanup-plan";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--today");
if (!file) {
  console.error("Usage: node --import tsx scripts/money-cleanup-dryrun.ts money.json [--today YYYY-MM-DD] [--list]");
  process.exit(2);
}
const today = args.includes("--today") ? args[args.indexOf("--today") + 1] : new Date().toISOString().slice(0, 10);
const raw = JSON.parse(readFileSync(file, "utf8"));
const data = cleanAccounts(asMoney(raw && typeof raw === "object" && "data" in raw && !("transactions" in raw) ? raw.data : raw)).data;
const plan = planCleanup(data, today);

console.log(`DRY RUN as of ${today}. Nothing was changed.`);
for (const [k, v] of Object.entries(plan.counts)) console.log(`${k}: ${v}`);
if (args.includes("--list")) {
  console.log("\nDuplicate bank transactions:");
  for (const g of plan.duplicates) console.log(`  [${g.confidence}] ${g.date} ${g.account} ${g.descriptions.join(" / ")} keep=${g.keep.length} remove=${g.remove.join(",") || "-"}`);
  console.log("\nTransfers to refile as Transfer:");
  for (const t of plan.transfers) console.log(`  ${t.date} ${t.account} ${t.description} (${t.from}${t.counterpart ? ", other side found" : ""}) id=${t.id}`);
  console.log("\nDuplicate bills (keep <- remove):");
  for (const b of plan.bills) console.log(`  ${b.scope}: ${b.names[0]} [${b.keep}] <- ${b.names[1]} [${b.remove}]`);
  console.log("\nBills that would move to their next date:");
  for (const b of plan.rolled) console.log(`  ${b.name}: ${b.from} -> ${b.to}`);
  console.log("\nBills still past due (no autopay, no matching bank payment):");
  for (const b of plan.stillOverdue) console.log(`  ${b.name}: ${b.nextDue}`);
}
