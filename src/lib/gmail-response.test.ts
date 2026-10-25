import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { gmailJson } from "./gmail-response";

test("small responses stay JSON and private",async()=> {
  const response=gmailJson({items:[]});
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.equal(response.headers.get("Content-Encoding"),null);
  assert.deepEqual(await response.json(),{items:[]});
});

test("large synthetic histories are compressed without dropping receipt metadata",async()=> {
  const value={items:Array.from({length:2000},(_,i)=>({id:`fixture-${i}`,subject:"Synthetic invoice fixture",evidence:"Expected amount in a test fixture",status:"review"}))};
  const response=gmailJson(value);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get("Content-Encoding"),"gzip");
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.ok(bytes.length < JSON.stringify(value).length/2);
  assert.deepEqual(JSON.parse(gunzipSync(bytes).toString("utf8")),value);
});
