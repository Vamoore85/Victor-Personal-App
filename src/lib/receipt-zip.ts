// Standard uncompressed ZIP, assembled on the owner's device. No receipt is sent to a ZIP service.
export type ZipFile = { name: string; bytes: Uint8Array };
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export function receiptZip(files: ZipFile[]): Uint8Array<ArrayBuffer> {
  if (files.length > 65535) throw new Error("Too many files for one folder.");
  const names = new Set<string>();
  const entries = files.map(file => {
    if (!file.name || file.name.startsWith("/") || file.name.includes("\\") || file.name.split("/").some(p => p === ".." || p === ".")) throw new Error("Invalid archive path.");
    if (names.has(file.name)) throw new Error("Duplicate archive path.");
    names.add(file.name);
    const name = encoder.encode(file.name);
    if (name.length > 65535) throw new Error("Archive path is too long.");
    return { ...file, nameBytes: name, crc: crc32(file.bytes), offset: 0 };
  });
  const localSize = entries.reduce((size, e) => size + 30 + e.nameBytes.length + e.bytes.length, 0);
  const centralSize = entries.reduce((size, e) => size + 46 + e.nameBytes.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw new Error("Folder is too large for one ZIP.");
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;
  for (const e of entries) {
    e.offset = pos;
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 paths
    view.setUint16(pos + 12, 33, true); // 1980-01-01
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.bytes.length, true);
    view.setUint32(pos + 22, e.bytes.length, true);
    view.setUint16(pos + 26, e.nameBytes.length, true);
    out.set(e.nameBytes, pos + 30);
    out.set(e.bytes, pos + 30 + e.nameBytes.length);
    pos += 30 + e.nameBytes.length + e.bytes.length;
  }
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 14, 33, true);
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.bytes.length, true);
    view.setUint32(pos + 24, e.bytes.length, true);
    view.setUint16(pos + 28, e.nameBytes.length, true);
    view.setUint32(pos + 42, e.offset, true);
    out.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  }
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, centralSize, true);
  view.setUint32(pos + 16, localSize, true);
  return out;
}
