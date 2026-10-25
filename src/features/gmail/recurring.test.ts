import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA, type Bill, type RecurringFinding } from "@/features/money/types";
import { upcoming, recurringRows } from "@/features/money/outlook";
import { billDatesBetween } from "@/features/money/calc";
import { applyRecurringEmails, explicitCadence, recurringEmailBills } from "./recurring";
import { extract, type EmailItem } from "./parse";

const now = "2026-10-25";
const item = (id: string, dueDate = "2026-11-01", change: Partial<EmailItem> = {}): EmailItem => ({ id, kind: "bill", merchant: "Example Utility", fromDomain: "example.com", subject: "Your bill", amount: 50, currency: "USD", billDate: null, dueDate, emailDate: "2026-10-20", evidence: "Amount due $50", flags: [], status: "review", scope: "personal", foundAt: now, ...change });
const monthly = () => [item("a","2026-09-01"),item("b","2026-10-01"),item("c")];

test("bank and email evidence feed one expected calendar entry and preserve dismissed or edited findings",()=> {
  const finding: RecurringFinding={id:"bank-pattern",key:"out:example:personal",direction:"out",merchant:"Example Utility",scope:"personal",cadence:"monthly",typical:49,min:49,max:49,firstDate:"2026-08-01",lastDate:"2026-10-01",usualDay:1,nextExpected:"2026-11-01",confidence:"high",reasons:[],occurrences:[{txnId:"bank-source",date:"2026-10-01",amount:49,accountId:"bank",source:"bank"}],accountIds:[],category:"Utilities",status:"detected",updatedAt:now};
  const data={...EMPTY_DATA,recurring:[finding]};
  const result=applyRecurringEmails(data,monthly(),now);
  assert.equal(result.added,1);
  assert.equal(result.data.bills[0].recurringId,finding.id);
  assert.equal(upcoming(result.data,30,now).length,1);
  assert.equal(result.data.recurring[0].typical,49);
  assert.equal(result.data.recurring[0].overrides,undefined);
  assert.equal(recurringRows(result.data)[0].nextAmount,50);
  const advanced={...result.data,bills:result.data.bills.map(b=>({...b,nextDue:"2026-12-01"}))};
  assert.equal(recurringRows(advanced)[0].nextDate,"2026-12-01");
  assert.equal(applyRecurringEmails({...data,recurring:[{...finding,status:"dismissed"}]},monthly(),now).added,0);
  assert.equal(applyRecurringEmails({...data,recurring:[{...finding,overrides:{amount:47}}]},monthly(),now).added,0);
  const owned={...data,accounts:[{id:"bank",name:"Checking",type:"checking" as const,openingBalance:0,scope:"gladiator" as const}],recurring:[{...finding,scope:"gladiator" as const,accountIds:["bank"]}]};
  const unassigned=monthly().map(i=>({...i,scope:undefined}));
  assert.equal(applyRecurringEmails(owned,unassigned,now).data.bills[0]?.scope,"gladiator");
  assert.equal(applyRecurringEmails({...owned,accounts:owned.accounts.map(a=>({...a,needsEntity:true}))},unassigned,now).added,0);
});

test("regular bill dates route one current bill and its expected calendar, without inventing payments", () => {
  const out = applyRecurringEmails(EMPTY_DATA, monthly(), now);
  assert.equal(out.added, 1);
  assert.equal(out.data.bills[0].frequency, "monthly");
  assert.equal(out.data.bills[0].nextDue, "2026-11-01");
  assert.equal(out.data.bills[0].category, "Bills");
  assert.deepEqual(out.data.transactions, []);
  assert.deepEqual(billDatesBetween(out.data.bills[0], "2026-09-01", "2026-11-01"), [{ date:"2026-11-01",paid:false }]);
  assert.equal(applyRecurringEmails(out.data, monthly(), now).data, out.data);
});

test("deleting a routed bill is respected on future scans", () => {
  const first = applyRecurringEmails(EMPTY_DATA, monthly(), now).data;
  const removed = { ...first, bills: [] };
  assert.equal(applyRecurringEmails(removed, monthly(), now).added, 0);
  assert.match(recurringEmailBills(monthly(), removed, now)[0].reason, /removed/);
});

test("receipts, reminder repeats and irregular purchase dates never become recurring obligations", () => {
  assert.equal(recurringEmailBills(monthly().map(x => ({ ...x, kind:"receipt" as const })), EMPTY_DATA, now).length, 0);
  assert.equal(recurringEmailBills([item("a"),item("b"),item("c")], EMPTY_DATA, now).length, 0);
  assert.equal(recurringEmailBills([item("a","2026-08-01"),item("b","2026-08-15"),item("c")], EMPTY_DATA, now).length, 0);
});

test("unclear ownership, currency, amount and historical dates stay in Bills to check", () => {
  for (const change of [{ scope:undefined }, {currency:"EUR"}, {amount:null}, {flags:["Check amount"]}, {dueDate:"2025-11-01"}]) {
    const items = [item("a", "2026-11-01", {recurringFrequency:"monthly",...change})];
    assert.equal(recurringEmailBills(items, EMPTY_DATA, now).length, 1);
    assert.equal(applyRecurringEmails(EMPTY_DATA, items, now).added, 0);
  }
  const mixed = monthly(); mixed[0].scope = "gladiator";
  assert.equal(applyRecurringEmails(EMPTY_DATA, mixed, now).added, 0);
});

test("existing bills link email evidence without duplicate bills or overwriting edited fields", () => {
  const bill: Bill = {id:"saved",name:"Example Utility",amount:79,category:"Utilities",frequency:"monthly",nextDue:"2026-10-30",dueDay:30,accountId:"bank",autopay:true,scope:"personal"};
  const out = applyRecurringEmails({...EMPTY_DATA,bills:[bill]}, monthly(), now);
  assert.equal(out.added, 0); assert.equal(out.linked,1);
  assert.equal(out.data.bills.length, 1);
  assert.deepEqual({...out.data.bills[0],emailSource:undefined}, {...bill,emailSource:undefined});
  assert.deepEqual(out.data.bills[0].emailSource?.ids,["a","b","c"]);
  assert.equal(applyRecurringEmails({...EMPTY_DATA,bills:[bill,{...bill,id:"second"}]}, monthly(), now).added,0);
});

test("shared payment gateways don't combine unrelated vendor invoices", () => {
  assert.equal(recurringEmailBills(monthly().map(x=>({...x,fromDomain:"paypal.com"})),EMPTY_DATA,now).length,0);
});

test("different billing schedules at one vendor need a plan/account check", () => {
  const items = [item("a","2026-10-01",{recurringFrequency:"monthly"}),item("b","2026-10-12",{recurringFrequency:"monthly"}),item("c","2026-11-01",{recurringFrequency:"monthly"})];
  assert.equal(applyRecurringEmails(EMPTY_DATA,items,now).added,0);
  assert.match(recurringEmailBills(items,EMPTY_DATA,now)[0].reason,/plans or accounts/);
});

test("explicit cadence is extracted from the original bill and receipts remain receipts", () => {
  assert.equal(explicitCadence("Your monthly bill"),"monthly");
  assert.equal(explicitCadence("Annual subscription invoice"),"yearly");
  assert.equal(explicitCadence("Monthly newsletter"),null);
  const msg = {id:"original",internalDate:String(Date.parse("2026-10-20")),payload:{mimeType:"text/plain",headers:[{name:"From",value:"Example <billing@example.com>"},{name:"Subject",value:"Your monthly bill"}],body:{data:Buffer.from("Amount due: $50.00\nDue date: November 1, 2026").toString("base64")}}};
  assert.equal(extract(msg,now)?.recurringFrequency,"monthly");
});
