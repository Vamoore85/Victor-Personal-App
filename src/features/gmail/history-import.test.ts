import test from "node:test";
import assert from "node:assert/strict";
import { easternDate, historyProgress } from "./history-import";
import { scanKey, type ScanCursor } from "./scan-history";
import { GET } from "@/app/api/gmail/history-scan/route";

const cursor=(complete:boolean,looked=0):ScanCursor=>({retryIds:[],looked,kept:0,complete});

test("history fills the current year, skips finished years and resumes the next unfinished year",()=> {
  const scans={
    [scanKey("2026-01-01","2026-10-25")]:cursor(false,80),
    [scanKey("2025-01-01","2025-12-31")]:cursor(true,1000),
    [scanKey("2024-01-01","2024-12-31")]:cursor(false,40),
  };
  const first=historyProgress("2026-10-25",scans);
  assert.equal(first.year,2026);
  assert.deepEqual(first.completedYears,[2025]);
  assert.equal(first.examined,1120);
  scans[scanKey("2026-01-01","2026-10-25")]=cursor(true,120);
  const next=historyProgress("2026-10-25",scans);
  assert.equal(next.year,2024);
  assert.equal(next.currentExamined,40);
});

test("a snapshot stays fixed across day and year changes; unfinished retries prevent completion",()=> {
  const snapshot="2026-12-31";
  const scans:Record<string,ScanCursor>={};
  for(let year=2004;year<=2026;year++) scans[scanKey(`${year}-01-01`,`${year}-12-31`)]=cursor(true);
  assert.equal(historyProgress(snapshot,scans).complete,true);
  assert.equal(historyProgress(snapshot,scans).year,null);
  scans[scanKey("2004-01-01","2004-12-31")]={...cursor(false,20),retryIds:["unread"]};
  assert.equal(historyProgress(snapshot,scans).year,2004);
  assert.equal(historyProgress(snapshot,scans).complete,false);
  assert.equal(easternDate(new Date("2027-01-01T02:00:00Z")),"2026-12-31");
});

test("history worker rejects requests without the scheduler secret before any database work",async()=> {
  const response=await GET(new Request("https://example.test/api/gmail/history-scan"));
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:"Unauthorized"});
});
