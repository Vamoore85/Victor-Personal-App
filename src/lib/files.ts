"use client";

/*
 * Files people drop into Maverick (books, video clips, scans) live in this
 * browser's IndexedDB, which can hold far more than localStorage. Records in
 * localStorage keep only the file's id, name, type and size.
 */

const DB = "maverick-files";
const STORE = "files";

export type StoredFile = { id: string; name: string; type: string; size: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFile(file: Blob, name: string): Promise<StoredFile> {
  const id = crypto.randomUUID();
  await run("readwrite", (s) => s.put(file, id));
  return { id, name, type: file.type, size: file.size };
}

export function loadFile(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>("readonly", (s) => s.get(id));
}

export function deleteFile(id: string) {
  return run("readwrite", (s) => s.delete(id));
}

export function fileKind(type: string, name: string): "video" | "image" | "pdf" | "audio" | "book" | "file" {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (/\.(epub|mobi|azw3?)$/i.test(name)) return "book";
  return "file";
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
