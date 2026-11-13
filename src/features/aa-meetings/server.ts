import { dbConfigured, deleteFile, getFile, putFile, readDoc, writeDoc } from "@/lib/db";
import { normalize, type MeetingData } from "./model";

export const DOC_KEY = "aa-meetings";

/** The private cloud storage the tracker uses; tests pass an in-memory stand-in. */
export type Store = {
  configured: () => boolean;
  readDoc: typeof readDoc; writeDoc: typeof writeDoc;
  putFile: typeof putFile; getFile: typeof getFile; deleteFile: typeof deleteFile;
};
export const cloudStore: Store = { configured: dbConfigured, readDoc, writeDoc, putFile, getFile, deleteFile };

export async function readMeetings(store: Store = cloudStore): Promise<MeetingData> {
  return normalize((await store.readDoc(DOC_KEY))?.data);
}

/**
 * Applies a change to the latest saved copy, retrying when another device
 * saved first. A change that returns the same object writes nothing.
 */
export async function updateMeetings(store: Store, fn: (data: MeetingData) => MeetingData): Promise<{ data: MeetingData; rev: number; changed: boolean }> {
  for (let i = 0; i < 5; i++) {
    const doc = await store.readDoc(DOC_KEY);
    const current = normalize(doc?.data);
    const next = fn(current);
    if (next === current) return { data: current, rev: doc?.rev ?? 0, changed: false };
    const saved = await store.writeDoc(DOC_KEY, doc?.rev ?? 0, next);
    if (saved.ok) return { data: next, rev: saved.rev, changed: true };
  }
  throw new Error("Another device is saving. Please try again.");
}

export class TooLarge extends Error {}
export async function boundedBody(req: Request, max: number) {
  if (Number(req.headers.get("content-length")) > max) throw new TooLarge("The file is too large.");
  const reader = req.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new TooLarge("The file is too large."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
