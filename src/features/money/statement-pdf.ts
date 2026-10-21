/*
 * Reads bank statement PDFs (built for M&T's two layouts: the older portrait
 * "ACCOUNT ACTIVITY" table and the newer sideways "Customer Statement") into
 * transactions. It works from where each piece of text sits on the page:
 * rows are lines of the activity table, and the column headers say whether a
 * number is money in, money out or the running balance. Each statement is
 * checked against its own balances so a misread shows up instead of slipping
 * into the books.
 */

export type PdfItem = { str: string; transform: number[] };

export type StatementTxn = { date: string; description: string; amount: number; kind: "income" | "expense" };

export type ParsedStatement = {
  account: string; // account number as printed, or ""
  period: string; // e.g. "01/01/26 - 01/31/26"
  txns: StatementTxn[];
  opening: number | null;
  closing: number | null;
  /** True when opening + money in - money out equals the closing balance. */
  balanced: boolean;
};

type Cell = { text: string; col: number; row: number };

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const AMOUNT_RE = /^\(?-?\$?\d{1,3}(,\d{3})*\.\d{2}\)?$/;
const SKIP_RE = /beginning balance|ending balance|number of deposits|total|page \d+ of/i;

const money = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return /^\(|-/.test(s) ? -n : n;
};
const cents = (n: number) => Math.round(n * 100);

/** Lays a page's text out as cells with a row (top to bottom) and column (left to right), whichever way the page is turned. */
function cells(items: PdfItem[]): Cell[] {
  const out: Cell[] = [];
  for (const it of items) {
    const text = it.str.trim();
    if (!text) continue;
    const [a, b, , , x, y] = it.transform;
    // Sideways text (newer statements): the table's rows run along x and its columns along y.
    const sideways = Math.abs(b) > Math.abs(a);
    out.push(sideways ? { text, row: x, col: y } : { text, row: -y, col: x });
  }
  return out;
}

function rowsOf(cs: Cell[]) {
  const rows: Cell[][] = [];
  for (const c of [...cs].sort((p, q) => p.row - q.row)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].row - c.row) <= 2.5) last.push(c);
    else rows.push([c]);
  }
  return rows.map((r) => r.sort((p, q) => p.col - q.col));
}

/** Where the money-in, money-out and balance columns start on this page, from their headers. */
function columns(cs: Cell[]) {
  const pick = (re: RegExp) => {
    const hits = cs.filter((c) => re.test(c.text)).map((c) => c.col);
    return hits.length ? Math.min(...hits) : null;
  };
  const debits = pick(/^(withdrawals\b|other debits|checks &$)/i);
  const balance = pick(/^daily$|^daily balance$|^balance$/i);
  if (debits === null || balance === null) return null;
  return { debitsFrom: debits - 12, balanceFrom: balance - 25 };
}

function isoDate(s: string) {
  const m = s.match(DATE_RE);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export function parseStatement(pages: PdfItem[][]): ParsedStatement {
  const all = pages.map(cells);
  const flat = all.flat().map((c) => c.text).join(" ");
  const account = flat.match(/(?:CHECKING|SAVINGS)[A-Z &]*?(\d{8,15})/i)?.[1] ?? flat.match(/ACCOUNT NUMBER\s+(?:STATEMENT PERIOD\s+)?(\d{8,15})/i)?.[1] ?? "";
  const period = flat.match(/(\d{2}\/\d{2}\/\d{2}\s*-\s*\d{2}\/\d{2}\/\d{2})/)?.[1] ?? "";

  const txns: StatementTxn[] = [];
  let opening: number | null = null;
  let closing: number | null = null;

  for (const cs of all) {
    const cols = columns(cs);
    if (!cols) continue;
    let prev: { txn: StatementTxn; row: number } | null = null;
    for (const row of rowsOf(cs)) {
      const date = isoDate(row[0].text);
      const amounts = row.filter((c) => AMOUNT_RE.test(c.text));
      const words = row.filter((c) => !AMOUNT_RE.test(c.text) && !DATE_RE.test(c.text)).map((c) => c.text);
      const balanceCell = amounts.find((c) => c.col >= cols.balanceFrom);
      if (balanceCell) {
        const b = money(balanceCell.text);
        if (opening === null) opening = b;
        closing = b;
      }
      const moved = amounts.filter((c) => c.col < cols.balanceFrom);
      if (!date) {
        // A wrapped second line of the description above.
        if (prev && moved.length === 0 && row[0].row - prev.row <= 14 && words.length && !SKIP_RE.test(words.join(" "))) {
          prev.txn.description += " " + words.join(" ");
          prev.row = row[0].row;
        }
        continue;
      }
      prev = null;
      if (moved.length !== 1 || /beginning balance/i.test(words.join(" "))) continue;
      const cell = moved[0];
      const txn: StatementTxn = {
        date,
        description: words.join(" ").replace(/\s+/g, " ").trim() || "Bank transaction",
        amount: Math.abs(money(cell.text)),
        kind: cell.col < cols.debitsFrom ? "income" : "expense",
      };
      txns.push(txn);
      prev = { txn, row: row[0].row };
    }
  }

  const net = txns.reduce((s, t) => s + (t.kind === "income" ? cents(t.amount) : -cents(t.amount)), 0);
  const balanced = opening !== null && closing !== null && cents(opening) + net === cents(closing);
  return { account, period, txns, opening, closing, balanced };
}

/** Reads a PDF file in the browser. pdf.js is loaded only when needed. */
export async function readStatementPdf(file: File): Promise<ParsedStatement> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.filter((i) => "str" in i) as PdfItem[]);
  }
  await task.destroy();
  return parseStatement(pages);
}
