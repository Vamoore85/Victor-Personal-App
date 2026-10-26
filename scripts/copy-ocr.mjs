// Copies the on-phone receipt reader (Tesseract, English) into public/ocr so
// the site serves it itself: receipt photos are read on your phone and the
// reader's files come from Maverick, not from an outside website.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = join(process.cwd(), "public", "ocr");
mkdirSync(out, { recursive: true });
const from = (pkg, file) => join(dirname(require.resolve(`${pkg}/package.json`)), file);
const files = [
  ["tesseract.js", "dist/worker.min.js", "worker.min.js"],
  ["tesseract.js-core", "tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["@tesseract.js-data/eng", "4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];
for (const [pkg, file, name] of files) copyFileSync(from(pkg, file), join(out, name));
console.log(`receipt reader copied to public/ocr (${files.length} files)`);
