type GoogleErrorBody = { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] } };

/** Only approved reason codes reach the browser; provider payloads can contain private context. */
export function gmailFailure(status: number, body: unknown) {
  const error = (body as GoogleErrorBody | null)?.error;
  const reasons = [...(error?.errors ?? []), ...(error?.details ?? [])].map(e => e.reason);
  if (status === 401) return { status: 401, retry: false, message: "Google signed this site out of Gmail. Press Connect Gmail again." };
  if (status === 429 || reasons.some(r => r === "rateLimitExceeded" || r === "userRateLimitExceeded"))
    return { status: 503, retry: true, message: "Google temporarily limited Gmail reads. Your saved scan is safe; press Continue scan again shortly. (Gmail rate limit)" };
  if (status >= 500) return { status: 503, retry: true, message: "Gmail is temporarily unavailable. Your saved scan is safe; try again shortly." };
  if (reasons.includes("dailyLimitExceeded")) return { status: 403, retry: false, message: "This Google Cloud project's daily Gmail quota has been reached. Continue after the quota resets. (dailyLimitExceeded)" };
  if (reasons.includes("domainPolicy")) return { status: 403, retry: false, message: "Your Google Workspace administrator is blocking this app's Gmail access. (domainPolicy)" };
  if (reasons.some(r => r === "accessNotConfigured" || r === "SERVICE_DISABLED")) return { status: 403, retry: false, message: "The Gmail API is disabled in the Google Cloud project used by this connection. Enable it before scanning. (SERVICE_DISABLED)" };
  if (reasons.some(r => r === "insufficientPermissions" || r === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return { status: 403, retry: false, message: "Google has not granted this connection permission to read Gmail. Press Connect Gmail again and allow read access. (insufficientPermissions)" };
  if (status === 403) return { status: 403, retry: false, message: "Google blocked this Gmail read without a recognized reason. Check this connection's Gmail access in Google Cloud. (403)" };
  if (status === 404) return { status: 404, retry: false, message: "That email is no longer available in Gmail." };
  if (status === 400) return { status: 400, retry: false, message: "Gmail could not continue this scan. Press Restart period to begin this period again." };
  return { status: 502, retry: false, message: `Gmail returned an error (${status}).` };
}
