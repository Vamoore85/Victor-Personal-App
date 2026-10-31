/** Wade link codes: 8 characters without look-alikes, shown as XXXX-XXXX. Safe for browser code. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export function normalizeCode(code: unknown) {
  if (typeof code !== "string") return null;
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c.slice(0, 4) + "-" + c.slice(4) : null;
}
