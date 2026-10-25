import { deflateRawSync } from "node:zlib";

/*
 * A small ZIP writer for downloads. Each file is added whole and byte for
 * byte as given (deflated when that makes it smaller, stored otherwise), so
 * an original email or receipt comes out of the ZIP exactly as it went in.
 * The ZIP is streamed out one file at a time.
 */

export type ZipFile = { name: string; data: Buffer; date?: Date };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date) {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

type Written = { name: Buffer; crc: number; size: number; packed: number; method: number; time: number; date: number; offset: number };

function localHeader(w: Written) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0x0800, 6); // names are UTF-8
  h.writeUInt16LE(w.method, 8);
  h.writeUInt16LE(w.time, 10);
  h.writeUInt16LE(w.date, 12);
  h.writeUInt32LE(w.crc, 14);
  h.writeUInt32LE(w.packed, 18);
  h.writeUInt32LE(w.size, 22);
  h.writeUInt16LE(w.name.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, w.name]);
}

function centralHeader(w: Written) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4); // made by
  h.writeUInt16LE(20, 6); // version needed
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(w.method, 10);
  h.writeUInt16LE(w.time, 12);
  h.writeUInt16LE(w.date, 14);
  h.writeUInt32LE(w.crc, 16);
  h.writeUInt32LE(w.packed, 20);
  h.writeUInt32LE(w.size, 24);
  h.writeUInt16LE(w.name.length, 28);
  h.writeUInt32LE(w.offset, 42);
  return Buffer.concat([h, w.name]);
}

/** Gives each name only once: a second "x.pdf" becomes "x (2).pdf". */
export function uniqueNamer() {
  const names = new Set<string>();
  return (wanted: string) => {
    let name = wanted;
    for (let n = 2; names.has(name); n++) name = wanted.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
    names.add(name);
    return name;
  };
}

/** Turns files into ZIP chunks, in order. Names use "/" for folders. */
export async function* zipChunks(files: AsyncIterable<ZipFile> | Iterable<ZipFile>): AsyncGenerator<Buffer> {
  const written: Written[] = [];
  const unique = uniqueNamer();
  let offset = 0;
  for await (const f of files) {
    const name = unique(f.name.replace(/^\/+/, ""));
    const packedData = deflateRawSync(f.data);
    const store = packedData.length >= f.data.length;
    const body = store ? f.data : packedData;
    const w: Written = {
      name: Buffer.from(name, "utf8"),
      crc: crc32(f.data),
      size: f.data.length,
      packed: body.length,
      method: store ? 0 : 8,
      ...dosTime(f.date ?? new Date()),
      offset,
    };
    const head = localHeader(w);
    yield head;
    yield body;
    offset += head.length + body.length;
    written.push(w);
  }
  const central = Buffer.concat(written.map(centralHeader));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(written.length, 8);
  end.writeUInt16LE(written.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  yield central;
  yield end;
}

export async function zipBuffer(files: Iterable<ZipFile>) {
  const parts: Buffer[] = [];
  for await (const c of zipChunks(files)) parts.push(c);
  return Buffer.concat(parts);
}

/** A streamed ZIP response body. */
export function zipStream(files: AsyncIterable<ZipFile>): ReadableStream<Uint8Array> {
  const it = zipChunks(files);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value));
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
