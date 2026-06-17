# Providers — the privileged extension plane

Surface has **two extension planes** (see [`architecture.md`](architecture.md)). This page
documents the privileged one.

> **Apps / Packs** are *userspace*: components, layout, data bindings — composed on the
> canvas, low-trust, and **agent-authorable at runtime**.
>
> **Providers** supply *system capabilities* behind **kernel ports** — storage, audit,
> auth, identity, transport, connectors. They are trusted, vetted/signed, and the agent
> **configures** a pre-vetted provider, it **never authors** one.

Decision rule: *composes on the canvas + safe to author at runtime* → **app/pack**;
*provides a system capability or touches trust / persistence / transport* → **provider
behind a port**.

The typed port contracts live in [`src/provider-sdk/ports.d.ts`](../src/provider-sdk/ports.d.ts);
the shape validators in [`src/provider-sdk/index.mjs`](../src/provider-sdk/index.mjs); the
concrete implementations in [`src/providers/`](../src/providers/).

## The ports

| Port | Interface | Shape | Shipped implementations |
|------|-----------|-------|-------------------------|
| `storage` | `StorageProvider` | `get` · `put` · `appendFrame` · `listFrames` (+ optional `saveWorkspace`/`loadWorkspace`) | **FileStore** (jsonl-on-disk, default) |
| `audit` | `AuditSink` | `record(e)` | **file** · **console** · **noop** |
| `auth` | `AuthProvider` | `begin(req)` → challenge · `complete(req)` → `Principal` | **mock** · **googleAuth** (real OIDC) |
| `identity` | `IdentityProvider` | `register(p)` · `verify(req)` → `Principal` | **mock** · **webauthnIdentity** (passkey, partial — see boundary) |
| `transport` | `TransportProvider` | implementation-defined | — (the `ws` hub is built in) |
| `connectors` | `ConnectorProvider[]` | `tools()` · `topics()` | — (M4+) |

Only `storage` is hard-required by the kernel (it persists presentation). `audit` defaults
to a no-op; `auth`/`identity` stay `null` until a host wires an IdP (the kernel runs as a
single trusted local operator otherwise).

## Wiring providers

Providers are wired through `createSurface({ providers })` — typically from
`surface.config.js` (see [`deployment.md`](deployment.md)). Every member is optional; the
kernel supplies the defaults shown.

```js
import { createSurface } from "@selfworking-ai/surface";
import { claudeCodeAdapter } from "@selfworking-ai/surface/adapters/claude-code.mjs";

import { fileStore }        from "@selfworking-ai/surface/providers/store-file.mjs";
import { fileAuditSink }    from "@selfworking-ai/surface/providers/audit-file.mjs";
import { googleAuth }       from "@selfworking-ai/surface/providers/auth-google.mjs";
import { webauthnIdentity } from "@selfworking-ai/surface/providers/identity-webauthn.mjs";

createSurface({
  adapter: claudeCodeAdapter({ cwd: process.cwd() }),
  providers: {
    storage:  fileStore({ dir: process.env.SURFACE_DIR || "./.surface" }),
    audit:    fileAuditSink({ dir: process.env.SURFACE_DIR || "./.surface" }),
    auth:     googleAuth({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,   // from env — never committed
      redirectUri:  process.env.GOOGLE_REDIRECT_URI,
    }),
    identity: webauthnIdentity({ rpId: "example.com", rpName: "Surface" }),
  },
});
```

You can validate a bundle before wiring it (shape-only — proves the seam, not behavior):

```js
import { validateProviderSet } from "@selfworking-ai/surface/provider-sdk";

const result = validateProviderSet(providers);   // { ok:true } | { ok:false, errors:[{port,error}] }
if (!result.ok) throw new Error(`bad providers: ${JSON.stringify(result.errors)}`);
```

> **Naming note.** The `surface.config.example.js` shipped with M1 used placeholder factory
> names (`googleOIDC`, `webAuthn`, `fileAudit`). The real M4 exports are **`googleAuth`**,
> **`webauthnIdentity`**, and **`fileAuditSink`** (with a `dir`, not a `path`). Prefer the
> names in this doc.

## Storage — `store-file.mjs` (the default)

`StorageProvider` persists **only presentation**: the frames log (turn history for
time-travel), the workspace document (durable composition), and a small kv space. Surface
never persists cognition or org state — the runtime owns those. The default **FileStore**
writes jsonl + json under `SURFACE_DIR` (default `./.surface`). Swap it for a
Postgres/Redis-backed provider behind the same port for production. Covered in depth by the
M1 docs; listed here for completeness of the plane.

## Audit — the attribution anchor

Because Surface holds the human principal at the human↔runtime edge, it is the natural
**audit anchor**: the kernel calls `audit.record({ principal, action, ts, data })` on
**every mutating action**. The action strings are a fixed vocabulary:

| `action` | when |
|----------|------|
| `turn.start` | a turn begins (`data: { mode, chars }`) |
| `mode.lock` | a connection locks its mode (`data: { mode }`) |
| `ask.answer` | the user answers a decision card (`data: { id, cancelled }`) |
| `permission.allow` / `permission.deny` | a tool-permission card is decided (`data: { id, tool }`) |
| `frame.commit` | the turn's final frame is committed to history (`data: { n, session }`) |

`record()` is **fire-and-forget** — it may be async, and the kernel swallows any
rejection, so a failing sink can never break or block a turn. Implementations must honor
that contract (never throw).

Three sinks ship in [`audit-file.mjs`](../src/providers/audit-file.mjs):

- **`fileAuditSink({ dir })`** — appends one JSON line per event to `<dir>/audit.jsonl`
  (default dir `./.surface`), with the same lazy idempotent `mkdir` as FileStore so it
  shares the persistence dir. A `readAudit(dir)` helper parses the log back (for
  tests/tools; the kernel never reads audit). **This is the durable attribution record.**
- **`consoleAuditSink()`** — logs a one-line `[audit] <ts> <principal> <action>` to stderr.
  For dev / ephemeral runs.
- **`noopAuditSink()`** — discards. Identical to the kernel's built-in default; exported so
  "explicitly no audit" is nameable.

```js
import { fileAuditSink, readAudit } from "@selfworking-ai/surface/providers/audit-file.mjs";
const audit = fileAuditSink({ dir: "./.surface" });
// … run some turns …
const trail = await readAudit("./.surface");   // [{ principal, action, ts, data }, …]
```

## Auth — establishing the human principal

`AuthProvider` is a `begin → complete` handshake that establishes a **human `Principal`**
(`{ id, display?, ceiling, provider? }`). The `ceiling` is the set of capabilities this
human may grant; the kernel bounds every grant by
`component.caps ⊆ mode.grantable ⊆ principal.ceiling` (see [`security-model.md`](security-model.md)).

### mock — the deterministic round-trip

[`auth-mock.mjs`](../src/providers/auth-mock.mjs) — `mockAuthProvider({ principal, ceiling })`.
`begin()` returns a fixed `{ challenge, state }`; `complete(req)` returns the configured
principal (or synthesizes `{ id: req.id || "mock-user", … }` with a conservative default
ceiling). Used in tests and for local-dev login flows without a real IdP.

### googleAuth — real Google OIDC (config-gated)

[`auth-google.mjs`](../src/providers/auth-google.mjs) —
`googleAuth({ clientId, clientSecret, redirectUri, ceiling?, scopes? })`. A real
authorization-code flow:

```
begin({ state })   →  { redirect: "https://accounts.google.com/o/oauth2/v2/auth?…", state }
                      (the host redirects the human there; round-trips `state` for CSRF)

   ── human consents at Google, Google redirects back to redirectUri?code=…&state=… ──

complete({ code }) →  POST  https://oauth2.googleapis.com/token        (exchange code → tokens)
                      GET   https://oauth2.googleapis.com/tokeninfo    (validate the id_token)
                      assert claims.aud === clientId
                   →  Principal { id: claims.sub, display, ceiling, provider: "google" }
```

- The URL builder is exported separately as **`buildGoogleAuthUrl(opts)`** so the
  no-network part is unit-testable. Default scope is `"openid email profile"`.
- **id_token validation** uses Google's `tokeninfo` endpoint, which verifies the RS256
  signature + expiry server-side and returns the decoded claims. This avoids hand-rolling
  RS256/JWKS verification (easy to get subtly wrong). **Production may prefer local JWKS
  verification** (fetch + cache Google's keys, verify with a vetted JOSE library) to drop a
  network round-trip per login and avoid tokeninfo rate limits — that belongs in an
  optional, vetted package, not zero-dep core.
- **It needs real Google credentials** (a Google Cloud OAuth 2.0 *Web application* client
  id + secret) and a **registered redirect URI**. It therefore **cannot be end-to-end
  tested** without those creds and a browser consent round-trip; only the URL builder and
  the factory's guard are unit-tested. Secrets come from env (`surface.config.js` reads
  `process.env`), **never committed** — see [`deployment.md`](deployment.md).

## Identity — registering and verifying a principal

`IdentityProvider` is a `register → verify` pair — typically WebAuthn / passkeys, so a
returning human can re-authenticate without an external IdP round-trip.

### mock — the in-memory round-trip

[`identity-mock.mjs`](../src/providers/identity-mock.mjs) — `mockIdentityProvider()`. Keeps
a Map keyed by principal id: `register(p)` stores, `verify({ id })` returns the stored
principal or throws. A deterministic round-trip with no crypto, for tests.

### The WebAuthn boundary (why verification is an optional, vetted island)

[`identity-webauthn.mjs`](../src/providers/identity-webauthn.mjs) —
`webauthnIdentity({ rpId, rpName, ceiling })`. This provider deliberately ships **only the
safe, zero-dep halves** of WebAuthn:

- **`registrationOptions(user)`** → a `PublicKeyCredentialCreationOptions`-shaped object
  with a fresh 32-byte CSPRNG challenge (`node:crypto` `randomBytes`), the relying-party
  id/name, and ES256/RS256 `pubKeyCredParams`.
- **`authenticationOptions({ allowCredentials? })`** → a `PublicKeyCredentialRequestOptions`-shaped
  object with a fresh challenge (anti-replay).

But **`register()` and `verify()` throw** a clear, documented error:

```
webauthn verify() requires a vetted verifier — wire @simplewebauthn/server or similar; see docs/providers.md
```

**Why.** Verifying a WebAuthn registration (attestation) or login (assertion) means parsing
CBOR/COSE keys, checking authenticator-data flags + signature counters, and verifying
ES256/RS256/EdDSA signatures against the stored credential — security-critical crypto that
is easy to get subtly, dangerously wrong. **Surface's zero-dep core will not ship
hand-rolled, unverified crypto.** That verification belongs in an **optional, vetted
provider package** — wire [`@simplewebauthn/server`](https://simplewebauthn.dev/) or a
similar audited library and implement `register()`/`verify()` there, persisting each
credential's public key + `signCount`. This is the same island pattern as googleAuth's
"production prefers local JWKS" note: the dangerous crypto lives behind an explicit,
opt-in dependency boundary. Throwing here is honest and safe — not a stub-by-omission.

## The operator-gated install flow (concept)

Providers are privileged, so enabling one is itself a privileged act. The intended flow
(the agent **configures**, never **authors**):

1. An authenticated, **elevated operator** (a principal whose ceiling permits it) opens a
   **catalog** of *pre-vetted* providers through the dock.
2. They select one to enable (e.g. "Google SSO", "File audit log").
3. The agent **configures** it — fills in the catalog provider's declared settings (client
   id, redirect URI, audit dir, …), pulling secrets from env, never inventing new kernel
   code.
4. The kernel validates the resulting `ProviderSet` (`validateProviderSet`) and wires it
   behind the port.

The agent never writes a new provider at runtime: that would be authoring a kernel module,
which the trust boundary forbids. Authoring + vetting a new provider is an out-of-band,
human-reviewed activity; the runtime flow only *enables and configures* what has already
been vetted.

## The identity / authority split (recap)

Surface sits at the **human ↔ runtime** edge and does exactly three things with identity:

- **Auth/identity providers set the ceiling.** Authenticating the human yields a
  `Principal` carrying its `ceiling` — the maximum capability this human may grant.
- **The runtime attenuates beneath it.** Surface passes a principal + capability token into
  the runtime on spawn; the runtime enforces *attenuation within its own agent tree*
  (spawned ≤ spawner). Surface does not reimplement that propagation.
- **Audit anchors attribution.** Every mutating action is recorded against the principal
  via the `AuditSink`, so each one is attributable to a human.

So providers on this plane are precisely the trust-bearing pieces: who the human *is*
(auth/identity), what gets *remembered* (storage), and what gets *attributed* (audit). See
[`security-model.md`](security-model.md) for the full grant matrix.
