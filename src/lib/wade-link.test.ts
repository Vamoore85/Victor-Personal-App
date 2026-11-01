import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import {
  approveLink, bearer, findByToken, hashToken, linkStatus, ownerToken, LINK_DAYS, MAX_PENDING, normalizeCode, PENDING_MINUTES,
  publicLinks, revokeLink, startLink, validToken, type WadeLinks,
} from "./wade-link";

const token = () => randomBytes(32).toString("base64url");
const empty: WadeLinks = { links: [] };

test("a started link reads nothing until its code is approved, then expires", () => {
  const t = token(), now = 1_800_000_000_000;
  assert.ok(validToken(t));
  const { state, link } = startLink(empty, hashToken(t), now, "a");
  assert.match(link.userCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(linkStatus(findByToken(state, t), now), "pending");
  assert.equal(linkStatus(findByToken(state, token()), now), "unknown");
  const ok = approveLink(state, link.userCode, now + 1000);
  assert.equal(linkStatus(findByToken(ok.state, t), now + 2000), "approved");
  assert.equal(linkStatus(findByToken(ok.state, t), now + LINK_DAYS * 864e5 + 2000), "expired");
});

test("a waiting code can't be approved after it times out, or twice", () => {
  const now = 1_800_000_000_000;
  const { state, link } = startLink(empty, hashToken(token()), now, "a");
  assert.throws(() => approveLink(state, link.userCode, now + PENDING_MINUTES * 6e4 + 1), /isn't waiting/);
  const ok = approveLink(state, link.userCode, now);
  assert.throws(() => approveLink(ok.state, link.userCode, now), /isn't waiting/);
});

test("disconnect stops the token", () => {
  const t = token(), now = 1_800_000_000_000;
  const s1 = startLink(empty, hashToken(t), now, "a");
  const s2 = approveLink(s1.state, s1.link.userCode, now).state;
  assert.equal(linkStatus(findByToken(revokeLink(s2, "a"), t), now), "revoked");
});

test("waiting requests are capped and the same token can't start twice", () => {
  let state = empty;
  const now = 1_800_000_000_000;
  const first = hashToken(token());
  state = startLink(state, first, now, "0").state;
  assert.throws(() => startLink(state, first, now, "x"), /already exists/);
  for (let i = 1; i < MAX_PENDING; i++) state = startLink(state, hashToken(token()), now, String(i)).state;
  assert.throws(() => startLink(state, hashToken(token()), now, "y"), /Too many/);
  // Once they time out, new requests are accepted again.
  assert.doesNotThrow(() => startLink(state, hashToken(token()), now + PENDING_MINUTES * 6e4 + 1, "z"));
});

test("the page list never carries the token hash", () => {
  const t = token(), now = 1_800_000_000_000;
  const s = startLink(empty, hashToken(t), now, "a").state;
  const text = JSON.stringify(publicLinks(s, now));
  assert.ok(!text.includes(hashToken(t)) && !text.includes(t));
});

test("codes and bearer headers are strict", () => {
  assert.equal(normalizeCode("abcd efgh"), "ABCD-EFGH");
  assert.equal(normalizeCode("ABCD-EFG0"), null); // 0 is not in the alphabet
  assert.equal(normalizeCode(undefined), null);
  const t = token();
  assert.equal(bearer("Bearer " + t), t);
  assert.equal(bearer("Bearer " + t + "x"), null);
  assert.equal(bearer(null), null);
});

test("the owner's paired Wade token is accepted only when its hash matches the configured one", () => {
  const t = "A".repeat(43);
  assert.equal(ownerToken(t, hashToken(t)), true);
  assert.equal(ownerToken("B".repeat(43), hashToken(t)), false);
  assert.equal(ownerToken(t, undefined), false);
  assert.equal(ownerToken(t, "not-a-hash"), false);
});
