/*
 * Reads the store, date and total off the text of a scanned receipt. The text
 * comes from on-phone character recognition, so it is messy: these are only
 * guesses for you to check, never filed as certain.
 */

export type ReceiptGuess = { merchant: string; date: string | null; amount: number | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "12.34", "$1,234.56", "12,34" (a misread dot), "12. 34"
const MONEY = /(?<![\d.,])\$?\s?(\d{1,3}(?:,\d{3})+|\d{1,6})\s?[.,]\s?(\d{2})(?![\d])/g;

function amounts(line: string): number[] {
  return [...line.matchAll(MONEY)].map((m) => Number(`${m[1].replace(/,/g, "")}.${m[2]}`)).filter((n) => n > 0 && n < 1_000_000);
}

const TOTAL = /\b(grand\s*total|amount\s*due|balance\s*due|total\s*due|total\s*amount|amount\s*paid|total\s*paid|you\s*paid|total\s*charged?|total|amount|charged|sale)\b/i;
const NOT_TOTAL = /\b(sub\s*-?\s*total|subtl|savings?|saved|discount|tax|tip|gratuity|items?|qty|change|points|rewards?|cash\s*back|tendered|cash)\b/i;
// The stronger the word, the more it wins over a plain "total".
const STRENGTH: [RegExp, number][] = [
  [/grand\s*total|amount\s*due|balance\s*due|total\s*due|you\s*paid|amount\s*paid|total\s*paid|total\s*charged?/i, 3],
  [/\btotal\b/i, 2],
  [/\b(amount|charged|sale)\b/i, 1],
];

function findAmount(lines: string[]): number | null {
  let best: { amount: number; strength: number; at: number } | null = null;
  lines.forEach((line, i) => {
    if (!TOTAL.test(line) || NOT_TOTAL.test(line.replace(/total\s*tax/i, "tax"))) return;
    // The amount is on the same line, or the line under it ("TOTAL" then "$12.34").
    const found = amounts(line);
    const nums = found.length ? found : amounts(lines[i + 1] ?? "");
    if (!nums.length) return;
    const amount = nums[nums.length - 1];
    const strength = STRENGTH.find(([re]) => re.test(line))?.[1] ?? 0;
    // A stronger word wins; between equals, the larger (a total is at least its subtotal).
    if (!best || strength > best.strength || (strength === best.strength && amount >= best.amount)) best = { amount, strength, at: i };
  });
  if (best) return (best as { amount: number }).amount;
  // No "total" line read clearly: guess the largest amount that isn't cash handed over or change.
  const all = lines.filter((l) => !NOT_TOTAL.test(l)).flatMap(amounts);
  return all.length ? Math.max(...all) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number, today: string): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  if (dt.getUTCDate() !== d) return null; // Feb 31 and the like
  // A receipt isn't from the future, and older than three years is a misread.
  const t = new Date(`${today}T12:00:00Z`).getTime();
  if (dt.getTime() > t + 86_400_000 || dt.getTime() < t - 3 * 366 * 86_400_000) return null;
  return iso;
}

function findDate(text: string, today: string): string | null {
  const mon = MONTHS.join("|");
  const month = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  const forms: [RegExp, (m: RegExpMatchArray) => [number, number, number]][] = [
    [/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, (m) => [+m[1], +m[2], +m[3]]],
    [/\b(\d{1,2})\s?[-/.]\s?(\d{1,2})\s?[-/.]\s?(\d{4}|\d{2})\b/g, (m) => [+m[3], +m[1], +m[2]]],
    [new RegExp(`\\b(${mon})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4}|\\d{2})\\b`, "gi"), (m) => [+m[3], month(m[1]), +m[2]]],
    [new RegExp(`\\b(\\d{1,2})\\s+(${mon})[a-z]*\\.?,?\\s+(\\d{4}|\\d{2})\\b`, "gi"), (m) => [+m[3], month(m[2]), +m[1]]],
  ];
  // Earliest in the text wins: the sale date is printed near the top, before any "return by" date.
  let best: { iso: string; at: number } | null = null;
  for (const [re, ymd] of forms) {
    for (const m of text.matchAll(re)) {
      const iso = validDate(...ymd(m), today);
      if (iso && (!best || (m.index ?? 0) < best.at)) best = { iso, at: m.index ?? 0 };
    }
  }
  return best?.iso ?? null;
}

const SKIP_MERCHANT =
  /\b(welcome|thank|receipt|store\s*#|st#|order|invoice|tel|phone|www\.|\.com|street|st\.|ave|avenue|road|rd\.|blvd|suite|cashier|register|terminal|date|time|customer|copy|merchant|visa|mastercard|amex|debit|credit)\b/i;

function findMerchant(lines: string[]): string {
  for (const raw of lines.slice(0, 8)) {
    const line = raw.replace(/[^A-Za-z0-9&'.,\- ]+/g, " ").replace(/\s+/g, " ").trim();
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3 || letters < line.replace(/\s/g, "").length * 0.6) continue; // mostly numbers or noise
    if (SKIP_MERCHANT.test(line) || amounts(line).length) continue;
    // "HOME DEPOT" reads better as "Home Depot"; leave mixed case alone.
    const name = line === line.toUpperCase() ? line.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : line;
    return name.slice(0, 60);
  }
  return "";
}

export function readReceiptText(text: string, today: string): ReceiptGuess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { merchant: findMerchant(lines), date: findDate(text, today), amount: findAmount(lines) };
}
