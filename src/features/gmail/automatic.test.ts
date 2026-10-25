import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cronAuthorized, AUTO_SCAN_DAYS, AUTO_SCAN_LABEL } from "./automatic";
import { GET } from "@/app/api/gmail/auto-scan/route";

test("scheduled reads require the exact server secret and reject missing or weak configuration",async()=> {
  const secret="test-only-secret-of-sufficient-length";
  assert.equal(cronAuthorized(`Bearer ${secret}`,secret),true);
  assert.equal(cronAuthorized(null,secret),false);
  assert.equal(cronAuthorized("Bearer wrong",secret),false);
  assert.equal(cronAuthorized("Bearer x","x"),false);
  assert.equal(cronAuthorized(`Bearer ${secret}`,undefined),false);
  const response = await GET(new Request("https://example.test/api/gmail/auto-scan"));
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:"Unauthorized"});
});

test("the registered background schedule matches the displayed interval and bounded recent window",()=> {
  const config=JSON.parse(readFileSync(new URL("../../../vercel.json",import.meta.url),"utf8"));
  assert.deepEqual(config.crons,[{path:"/api/gmail/auto-scan",schedule:"*/30 * * * *"}]);
  assert.equal(AUTO_SCAN_LABEL,"Every 30 minutes");
  assert.equal(AUTO_SCAN_DAYS,7);
});
