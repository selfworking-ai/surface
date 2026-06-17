// M4 providers — unit tests for the privileged extension plane (auth, identity,
// the no-network parts of Google OIDC + WebAuthn, the provider-sdk shape
// validators, and the kernel grant matrix). No kernel boot here — the
// audit-on-mutation end-to-end test lives in audit.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { mockAuthProvider } from "../src/providers/auth-mock.mjs";
import { mockIdentityProvider } from "../src/providers/identity-mock.mjs";
import { buildGoogleAuthUrl, googleAuth } from "../src/providers/auth-google.mjs";
import { webauthnIdentity } from "../src/providers/identity-webauthn.mjs";
import { fileAuditSink, consoleAuditSink, noopAuditSink } from "../src/providers/audit-file.mjs";
import {
  validateStorageProvider,
  validateAuditSink,
  validateAuthProvider,
  validateIdentityProvider,
  validateProviderSet,
} from "../src/provider-sdk/index.mjs";
import { FileStore } from "../src/providers/store-file.mjs";
import { canGrant } from "../src/kernel/permissions.mjs";

// ── AuthProvider (mock): begin → complete yields a Principal ──────────────────
test("mock auth begin→complete returns a Principal", async () => {
  const auth = mockAuthProvider();
  const challenge = await auth.begin({});
  assert.equal(challenge.challenge, "mock");
  assert.equal(challenge.state, "mock-state");

  const principal = await auth.complete({ id: "alice" });
  assert.equal(principal.id, "alice");
  assert.equal(principal.provider, "mock");
  assert.ok(Array.isArray(principal.ceiling) && principal.ceiling.length, "principal carries a ceiling");
});

test("mock auth returns a configured principal verbatim when given one", async () => {
  const fixed = { id: "boss", display: "Boss", ceiling: ["*"], provider: "mock" };
  const auth = mockAuthProvider({ principal: fixed });
  assert.deepEqual(await auth.complete({ id: "ignored" }), fixed);
});

// ── IdentityProvider (mock): register → verify round-trip ─────────────────────
test("mock identity register→verify round-trips; verify-unknown throws", async () => {
  const idp = mockIdentityProvider();
  const principal = { id: "carol", display: "Carol", ceiling: ["render", "ask"], provider: "mock" };
  await idp.register(principal);
  assert.deepEqual(await idp.verify({ id: "carol" }), principal);
  await assert.rejects(() => idp.verify({ id: "nobody" }), /unknown principal/);
});

// ── Google OIDC: the URL builder is unit-testable WITHOUT network ─────────────
test("buildGoogleAuthUrl contains client_id, redirect_uri, response_type, scope, state", () => {
  const url = buildGoogleAuthUrl({
    clientId: "cid-123",
    redirectUri: "https://app.example/callback",
    state: "xyz",
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("client_id"), "cid-123");
  assert.equal(u.searchParams.get("redirect_uri"), "https://app.example/callback");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  assert.equal(u.searchParams.get("state"), "xyz");
});

test("buildGoogleAuthUrl accepts an array of scopes and requires id+redirect", () => {
  const url = buildGoogleAuthUrl({ clientId: "c", redirectUri: "https://r", scopes: ["openid", "email"] });
  assert.equal(new URL(url).searchParams.get("scope"), "openid email");
  assert.throws(() => buildGoogleAuthUrl({ redirectUri: "https://r" }), /clientId is required/);
  assert.throws(() => buildGoogleAuthUrl({ clientId: "c" }), /redirectUri is required/);
});

test("googleAuth factory requires real credentials", () => {
  assert.throws(() => googleAuth({}), /requires \{ clientId, clientSecret, redirectUri \}/);
  // With creds it constructs (no network until begin/complete are called).
  const provider = googleAuth({ clientId: "c", clientSecret: "s", redirectUri: "https://r" });
  assert.equal(provider.id, "google");
  assert.equal(typeof provider.begin, "function");
  assert.equal(typeof provider.complete, "function");
});

test("googleAuth.begin builds a redirect URL without network", async () => {
  const provider = googleAuth({ clientId: "cid", clientSecret: "s", redirectUri: "https://r/cb" });
  const { redirect, state } = await provider.begin({ state: "st" });
  assert.match(redirect, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.equal(new URL(redirect).searchParams.get("client_id"), "cid");
  assert.equal(state, "st");
});

// ── WebAuthn: safe halves work; verify() raises the documented boundary error ─
test("webauthn registrationOptions returns a challenge + rpId", () => {
  const idp = webauthnIdentity({ rpId: "example.com", rpName: "Example" });
  const opts = idp.registrationOptions({ id: "user-1", name: "User One" });
  assert.ok(opts.challenge, "a challenge is minted");
  assert.equal(opts.rp.id, "example.com");
  assert.ok(opts.pubKeyCredParams.some((p) => p.alg === -7), "offers ES256");

  const authOpts = idp.authenticationOptions();
  assert.ok(authOpts.challenge);
  assert.equal(authOpts.rpId, "example.com");
  // Two calls → two distinct challenges (anti-replay).
  assert.notEqual(opts.challenge, idp.registrationOptions({ id: "user-1" }).challenge);
});

test("webauthn verify() throws the documented vetted-verifier error", async () => {
  const idp = webauthnIdentity();
  await assert.rejects(() => idp.verify({}), /vetted verifier/);
  await assert.rejects(() => idp.register({ id: "x" }), /vetted verifier/);
});

// ── provider-sdk validators: accept good shapes, reject bad ones ──────────────
test("provider-sdk validators accept good shapes and reject bad ones", () => {
  // storage
  assert.equal(validateStorageProvider(new FileStore({ dir: "/tmp/x" })).ok, true);
  assert.equal(validateStorageProvider({}).ok, false);
  assert.equal(validateStorageProvider(null).ok, false);

  // audit — the shipped sinks all pass; a bare object fails.
  assert.equal(validateAuditSink(fileAuditSink({ dir: "/tmp/x" })).ok, true);
  assert.equal(validateAuditSink(consoleAuditSink()).ok, true);
  assert.equal(validateAuditSink(noopAuditSink()).ok, true);
  assert.equal(validateAuditSink({}).ok, false);
  assert.equal(validateAuditSink({ record: 1 }).ok, false);

  // auth — needs begin + complete
  assert.equal(validateAuthProvider(mockAuthProvider()).ok, true);
  assert.equal(validateAuthProvider({ begin() {} }).ok, false);

  // identity — needs register + verify
  assert.equal(validateIdentityProvider(mockIdentityProvider()).ok, true);
  assert.equal(validateIdentityProvider(webauthnIdentity()).ok, true);
  assert.equal(validateIdentityProvider({ register() {} }).ok, false);
});

test("validateProviderSet validates present members, tolerates absent ones, reports errors", () => {
  // A fully-wired, valid set.
  assert.equal(validateProviderSet({
    storage: new FileStore({ dir: "/tmp/x" }),
    audit: noopAuditSink(),
    auth: mockAuthProvider(),
    identity: mockIdentityProvider(),
  }).ok, true);

  // Empty set is valid — the kernel supplies defaults for absent members.
  assert.equal(validateProviderSet({}).ok, true);

  // A bad member is reported with its port name.
  const bad = validateProviderSet({ audit: {}, auth: { begin() {} } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.port === "audit"));
  assert.ok(bad.errors.some((e) => e.port === "auth"));

  // connectors must be an array; each needs tools()+topics().
  assert.equal(validateProviderSet({ connectors: {} }).ok, false);
  assert.equal(validateProviderSet({ connectors: [{ tools() {}, topics() {} }] }).ok, true);

  // Non-object → a single "set" error.
  assert.equal(validateProviderSet(null).ok, false);
});

// ── The grant matrix: component.caps ⊆ mode.grantable ⊆ principal.ceiling ─────
test("grant matrix across operator/team/visitor × ceilings", () => {
  const WILDCARD = ["*"];

  // operator (wildcard mode) with a wildcard ceiling grants destructive caps.
  assert.equal(canGrant("fs:write", "operator", WILDCARD), true);
  assert.equal(canGrant("agent.spawn", "operator", WILDCARD), true);
  assert.equal(canGrant("render", "operator", WILDCARD), true);

  // team grants the scoped set (render) but NOT fs:write — even with a wildcard ceiling,
  // because mode.grantable is the binding constraint here.
  assert.equal(canGrant("render", "team", WILDCARD), true);
  assert.equal(canGrant("read", "team", WILDCARD), true);
  assert.equal(canGrant("fs:write", "team", WILDCARD), false);
  assert.equal(canGrant("agent.spawn", "team", WILDCARD), false);

  // visitor grants NOTHING (generation off, tools none) regardless of ceiling.
  assert.equal(canGrant("render", "visitor", WILDCARD), false);
  assert.equal(canGrant("read", "visitor", WILDCARD), false);

  // A NARROWED ceiling is the absolute hard cap: ["render"] blocks "compose"
  // even for operator (whose mode WOULD grant it).
  assert.equal(canGrant("render", "operator", ["render"]), true);
  assert.equal(canGrant("compose", "operator", ["render"]), false);
  assert.equal(canGrant("fs:write", "operator", ["render"]), false);

  // Bad inputs are denied, never thrown.
  assert.equal(canGrant("render", "nonsense", WILDCARD), false);
  assert.equal(canGrant("", "operator", WILDCARD), false);
});
