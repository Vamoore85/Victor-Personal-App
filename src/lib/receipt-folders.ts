import { getFile, readDoc } from "@/lib/db";
import { asMoney, MONEY_DOC } from "@/lib/money-doc";
import { originalsReader, readItems } from "@/lib/gmail";
import { buildFolders, indexCsv, originalName, readme, SECTION_LABEL, type FolderEntry, type Section } from "@/features/receipts/folders";
import { uniqueNamer, type ZipFile } from "@/lib/zip";

// Server side of the receipt folders: reads your money data and Gmail finds, and builds the ZIP.

export async function allEntries() {
  const [money, emails] = await Promise.all([readDoc(MONEY_DOC), readItems()]);
  const m = asMoney(money?.data);
  return buildFolders({ receipts: Array.isArray(m.receipts) ? m.receipts : [] }, emails.items);
}

export const MAX_ZIP_ITEMS = 600;

/** The files for one year's ZIP (or one folder of it), produced one at a time so the download streams. */
export async function* zipFiles(entries: FolderEntry[], year: string, section: Section | null): AsyncGenerator<ZipFile> {
  const chosen = entries.filter((e) => e.year === year && (!section || e.section === section)).slice(0, MAX_ZIP_ITEMS);
  const gmail = chosen.some((e) => e.source === "email") ? await originalsReader() : null;
  const rows: { e: FolderEntry; file: string }[] = [];
  let missing = 0;
  const unique = uniqueNamer();
  const top = section ? `${year}/${SECTION_LABEL[section]}` : year;

  // Emails are read a few at a time; each original goes into the ZIP as soon as it arrives.
  for (let i = 0; i < chosen.length; i += 6) {
    const batch = chosen.slice(i, i + 6);
    const data = await Promise.all(
      batch.map(async (e): Promise<Buffer | null> => {
        // Filed emails keep a private copy; ones still in Needs review are only read.
        if (e.source === "email") return gmail && e.gmailId ? gmail.read(e.gmailId, e.section !== "review") : null;
        return e.fileId ? getFile(`receipt-${e.fileId}`).then((f) => f?.data ?? null).catch(() => null) : null;
      }),
    );
    for (let n = 0; n < batch.length; n++) {
      const e = batch[n];
      const buf = data[n];
      if (buf) {
        const name = unique(originalName(e));
        yield { name, data: buf, date: new Date(`${e.date}T12:00:00`) };
        rows.push({ e, file: name.slice(top.length + 1) });
      } else {
        missing++;
        rows.push({ e, file: e.source === "email" ? "Not included: couldn't read it from Gmail and there's no saved copy" : "Not included: the file is missing" });
      }
    }
  }
  yield { name: `${top}/index.csv`, data: Buffer.from(`﻿${indexCsv(rows)}`, "utf8") };
  yield { name: `${top}/README.txt`, data: Buffer.from(readme(year, section, missing, missing ? (gmail?.why ?? null) : null), "utf8") };
}
