"use client";

import { readReceiptText, type ReceiptGuess } from "./read";

/*
 * Reads a receipt photo on your phone. The picture never leaves the phone for
 * this: the reader (Tesseract) runs in the browser, loaded from Maverick's own
 * /ocr files. The photo is first turned gray and its contrast stretched, which
 * reads far better than a dim photo of thermal paper. The saved receipt keeps
 * the original color photo; only the reader sees the cleaned-up copy.
 */

const READ_SIDE = 2000;

/** A gray, high-contrast copy for reading. */
async function cleanForReading(file: Blob): Promise<HTMLCanvasElement | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, READ_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = g;
    hist[px[i]]++;
  }
  // Stretch so the darkest 2% is black and the brightest 2% is white.
  const total = px.length / 4;
  let lo = 0, hi = 255, seen = 0;
  for (; lo < 255 && (seen += hist[lo]) < total * 0.02; lo++);
  seen = 0;
  for (; hi > 0 && (seen += hist[hi]) < total * 0.02; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

type Worker = { recognize: (image: HTMLCanvasElement | Blob) => Promise<{ data: { text: string } }> };
let worker: Promise<Worker> | null = null;

function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  progressListener = onProgress;
  worker ??= import("tesseract.js").then(({ createWorker }) =>
    createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") progressListener?.(m.progress);
      },
    }),
  ).catch((e) => {
    worker = null; // try again next time
    throw e;
  });
  return worker;
}
let progressListener: ((p: number) => void) | undefined;

/** Starts loading the reader early (it's a few MB the first time; the phone keeps it after that). */
export function warmReader() {
  void getWorker().catch(() => {});
}

/** Reads store, date and total from a photo. Empty guesses when nothing reads; never throws. */
export async function readReceiptPhoto(file: Blob, today: string, onProgress?: (p: number) => void): Promise<ReceiptGuess> {
  const empty: ReceiptGuess = { merchant: "", date: null, amount: null };
  if (file.type === "application/pdf") return empty;
  try {
    const [w, image] = await Promise.all([getWorker(onProgress), cleanForReading(file)]);
    const { data } = await w.recognize(image ?? file);
    return readReceiptText(data.text ?? "", today);
  } catch (e) {
    console.warn("receipt reader", e);
    return empty;
  }
}
