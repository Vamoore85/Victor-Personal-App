import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { zipBuffer } from "@/lib/zip";
import type { MeetingRecord } from "./record-fields";

// One meeting's record (see record-fields.ts) as a PDF or a Word document.

const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
function wrap(t: string, f: PDFFont, size: number, w: number) {
  const out: string[] = []; let line = "";
  for (const word of winAnsi(t).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && f.widthOfTextAtSize(next, size) > w) { out.push(line); line = word; } else line = next;
  }
  out.push(line); return out;
}

export async function recordPdf(r: MeetingRecord) {
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(r.fileBase)); doc.setProducer("Maverick Personal");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 56, ink = rgb(0.1, 0.1, 0.1);
  let page = doc.addPage([W, H]); let y = H - M;
  const room = (h: number) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (t: string, size: number, f: PDFFont, gap: number) => { for (const l of wrap(t, f, size, W - 2 * M)) { room(size + 4); page.drawText(l, { x: M, y: y - size, size, font: f, color: ink }); y -= size + 4; } y -= gap; };
  text(r.title, 20, bold, 10);
  for (const [k, v] of r.rows) {
    const lines = wrap(v, font, 11, W - 2 * M - 150); room(lines.length * 15 + 4);
    page.drawText(k, { x: M, y: y - 11, size: 11, font: bold, color: ink });
    lines.forEach((l, i) => page.drawText(l, { x: M + 150, y: y - 11 - i * 15, size: 11, font, color: ink }));
    y -= lines.length * 15 + 4;
  }
  if (r.takeaway) { y -= 10; text("Takeaway", 13, bold, 4); text(r.takeaway, 11, font, 0); }
  return doc.save();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const run = (t: string, b = false, size = 22) => `<w:r><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica"/>${b ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const para = (t: string, b = false, size = 22, after = 120) => `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>${run(t, b, size)}</w:p>`;
const cell = (t: string, b: boolean, width: number) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para(t, b, 22, 60)}</w:tc>`;

/** A plain Word document (.docx) with the same content as the PDF. */
export async function recordDocx(r: MeetingRecord) {
  const body = [
    para(r.title, true, 40, 240),
    `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="6480"/></w:tblGrid>${r.rows.map(([k, v]) => `<w:tr>${cell(k, true, 2880)}${cell(v, false, 6480)}</w:tr>`).join("")}</w:tbl>`,
    ...(r.takeaway ? [para("", false, 22, 120), para("Takeaway", true, 26, 80), para(r.takeaway)] : []),
  ].join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1120" w:right="1120" w:bottom="1120" w:left="1120" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipBuffer([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/document.xml", data: Buffer.from(document) },
  ]);
}
