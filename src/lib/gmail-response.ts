import { gzipSync } from "node:zlib";

/** Years of receipt metadata must fit the host's response limit. Never caches private mail. */
export function gmailJson(value: unknown) {
  const text=JSON.stringify(value);
  const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
  return text.length < 100000 ? new Response(text,{headers}) : new Response(gzipSync(text),{headers:{...headers,"Content-Encoding":"gzip"}});
}
