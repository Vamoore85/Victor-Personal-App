import { connection } from "next/server";
import { dbConfigured } from "@/lib/db";
import { signedIn } from "@/lib/plaid-server";
import { allEntries, zipFiles } from "@/lib/receipt-folders";
import { SECTIONS, SECTION_LABEL, type Section } from "@/features/receipts/folders";
import { zipStream } from "@/lib/zip";

export const maxDuration = 300;

// Downloads one year's receipt folders (or one folder) as a ZIP of the originals plus an index. Read only.
export async function GET(req: Request) {
  await connection();
  if (!signedIn(req)) return new Response("Sign in first.", { status: 401 });
  if (!dbConfigured()) return new Response("Receipt folders need the online database.", { status: 503 });
  const q = new URL(req.url).searchParams;
  const year = q.get("year") ?? "";
  const section = q.get("section");
  if (!/^\d{4}$/.test(year)) return new Response("Pick a year.", { status: 400 });
  if (section && !SECTIONS.includes(section as Section)) return new Response("Unknown folder.", { status: 400 });
  const entries = await allEntries();
  const name = `Maverick receipts ${year}${section ? ` ${SECTION_LABEL[section as Section]}` : ""}.zip`;
  console.log(`receipt zip: year=${year} section=${section ?? "all"}`); // no names or amounts
  return new Response(zipStream(zipFiles(entries, year, (section as Section) || null)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
