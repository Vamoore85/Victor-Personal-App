import { readDoc, writeDoc } from "@/lib/db";
import { asLinks, WADE_LINKS_DOC, type WadeLinks } from "@/lib/wade-link";

export async function readLinks(): Promise<WadeLinks> {
  return asLinks((await readDoc(WADE_LINKS_DOC))?.data ?? null);
}

/** Applies a change to the saved Wade links, retrying when another save lands first. */
export async function updateLinks<T>(change: (s: WadeLinks) => { state: WadeLinks; value: T }): Promise<T> {
  for (let i = 0; i < 5; i++) {
    const doc = await readDoc(WADE_LINKS_DOC);
    const { state, value } = change(asLinks(doc?.data ?? null));
    const saved = await writeDoc(WADE_LINKS_DOC, doc?.rev ?? 0, state);
    if (saved.ok) return value;
  }
  throw new Error("The Wade links kept changing while saving.");
}
