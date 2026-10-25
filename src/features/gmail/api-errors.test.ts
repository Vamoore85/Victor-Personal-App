import test from "node:test";
import assert from "node:assert/strict";
import { gmailFailure } from "./api-errors";

test("quota errors retry without being misreported as disabled Gmail", () => {
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
    const result = gmailFailure(403, { error: { errors: [{ reason }] } });
    assert.equal(result.retry, true);
    assert.equal(result.status, 503);
    assert.match(result.message, /rate limit/);
  }
  assert.equal(gmailFailure(429, null).retry, true);
  assert.equal(gmailFailure(503, null).retry, true);
});

test("permanent access and daily quota failures do not retry", () => {
  for (const reason of ["dailyLimitExceeded", "domainPolicy", "insufficientPermissions", "SERVICE_DISABLED"]) {
    const result = gmailFailure(403, { error: { details: [{ reason }] } });
    assert.equal(result.retry, false);
    assert.match(result.message, new RegExp(reason));
  }
});

test("unknown errors never expose provider payloads", () => {
  const result = gmailFailure(403, { error: { errors: [{ reason: "private-mail-context" }], message: "secret" } });
  assert.doesNotMatch(result.message, /private-mail-context|secret/);
  assert.equal(result.retry, false);
});
