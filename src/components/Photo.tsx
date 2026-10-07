"use client";

import { useEffect, useRef, useState } from "react";
import { deleteFile, loadFile, saveFile, type StoredFile } from "@/lib/files";

/** Shows an image stored in this browser's IndexedDB. */
export function Photo({ file, className = "" }: { file: StoredFile; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    loadFile(file.id).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  if (!url) return <div className={`bg-zinc-100 dark:bg-zinc-900 ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element -- local object URL, not optimizable
  return <img src={url} alt={file.name} className={`object-cover ${className}`} />;
}

/** A square that shows a photo, or lets you drop/choose one. */
export function PhotoPicker({
  photo,
  onChange,
  className = "h-28 w-28",
  label = "Add photo",
}: {
  photo?: StoredFile;
  onChange: (photo: StoredFile | undefined) => void;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const stored = await saveFile(f, f.name);
      if (photo) deleteFile(photo.id).catch(() => undefined);
      onChange(stored);
    } catch {
      // Browser storage full.
    }
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg border-2 border-dashed ${over ? "border-ember" : photo ? "border-transparent" : "border-zinc-300 dark:border-zinc-700"} ${className}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files[0]);
      }}
    >
      {photo ? (
        <>
          <Photo file={photo} className="h-full w-full" />
          <button
            type="button"
            className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white"
            onClick={() => {
              deleteFile(photo.id).catch(() => undefined);
              onChange(undefined);
            }}
          >
            ×
          </button>
        </>
      ) : (
        <button type="button" className="h-full w-full p-2 text-xs text-zinc-500 hover:text-brand" onClick={() => ref.current?.click()}>
          {label}
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
