import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, challenge, redirectUri, SCOPE } from "./gmail";

test("Google is asked for read-only Gmail, a lasting sign-in and PKCE, returning to the callback", () => {
  const url = new URL(authorizeUrl({ clientId: "id.apps.googleusercontent.com", secret: "s" }, "https://maverick-personal.vercel.app", "st", "verifier"));
  const q = url.searchParams;
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(q.get("redirect_uri"), "https://maverick-personal.vercel.app/api/gmail/callback");
  assert.equal(q.get("scope"), SCOPE);
  assert.equal(SCOPE, "https://www.googleapis.com/auth/gmail.readonly");
  assert.equal(q.get("access_type"), "offline");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("code_challenge"), challenge("verifier"));
  assert.equal(q.get("state"), "st");
  assert.equal(q.get("client_secret"), null);
});

test("redirect URI follows the site it runs on", () => {
  assert.equal(redirectUri("http://localhost:3000"), "http://localhost:3000/api/gmail/callback");
});
