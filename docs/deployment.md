# Deployment

Surface runs a console that can drive an agent CLI with real file, shell, and network
access. Its deployment posture is therefore **loopback-first**; exposing it is a deliberate,
fronted act. This guide covers running it in production, fronting it with TLS, wiring
providers, and the secrets + scope caveats.

Read [`security-model.md`](security-model.md) alongside this — the controls here exist for
the reasons documented there.

## The default posture: loopback only

By default the kernel binds **`127.0.0.1`** (gotcha **G8**). It is **never public by
default**: because it can run an agent CLI with real access, a public bind would be remote
code execution waiting to happen. For a single local operator, that is the whole story —
boot it and open `http://localhost:5757`.

```sh
npx surface dev                 # loads ./surface.config.js if present, else the echo adapter
# or, embedded in a host:
node -e "import('@selfworking-ai/surface').then(({createSurface}) => createSurface({adapter}).listen())"
```

## Fronting Surface with a reverse proxy (TLS termination)

A deliberate reverse proxy is the **only supported way to expose Surface** beyond loopback.
Terminate TLS at the proxy (nginx / Caddy / …) and forward to the loopback-bound kernel.
Two things must line up:

1. The proxy forwards both HTTP **and** the WebSocket upgrade to `127.0.0.1:<port>`.
2. The kernel's **origin allowlist must include the public origin** — otherwise the WS
   handshake is rejected with a real `403` (G8). Set it via `allowedOrigins` in the config.

### Caddy

```caddy
console.example.com {
    reverse_proxy 127.0.0.1:5757          # Caddy proxies WebSocket upgrades automatically
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name console.example.com;
    # ssl_certificate / ssl_certificate_key …

    location / {
        proxy_pass http://127.0.0.1:5757;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;          # required for the WS upgrade
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

### The matching kernel config

```js
// surface.config.js
export default {
  adapter,
  host: "127.0.0.1",                       // keep loopback; the proxy is the only public face
  port: 5757,
  allowedOrigins: [
    "https://console.example.com",         // the PUBLIC origin the browser uses — required
    "http://localhost:5757",               // optional: still allow direct local access
  ],
  openBrowser: false,                      // headless host
};
```

If you front Surface and forget the public origin in `allowedOrigins`, the page loads but
the WebSocket never connects (a clean 403 at the upgrade, not a hang).

## Env knobs

| Var | Purpose | Default |
|-----|---------|---------|
| `SURFACE_PORT` / `PORT` | HTTP/WS port | `5757` |
| `SURFACE_DIR` | persistence dir for the file store + file audit log | `./.surface` |
| `OPEN_BROWSER` | `0` to skip auto-opening the browser on boot | open |
| `CLAUDE_BIN` (per-adapter `*_BIN`) | absolute path to an agent-CLI binary, overriding resolution (G1) | resolved via `which` / known paths |

Config-file fields (`port`, `host`, `allowedOrigins`, `openBrowser`, …) take precedence over
env where both apply; env is the runtime override for the rest.

## Wiring providers in `surface.config.js`

Production persistence, auth, identity, and audit are wired through `providers` (full
reference: [`providers.md`](providers.md)). A representative production config:

```js
import { claudeCodeAdapter } from "@selfworking-ai/surface/adapters/claude-code.mjs";
import { fileStore }        from "@selfworking-ai/surface/providers/store-file.mjs";
import { fileAuditSink }    from "@selfworking-ai/surface/providers/audit-file.mjs";
import { googleAuth }       from "@selfworking-ai/surface/providers/auth-google.mjs";
import { webauthnIdentity } from "@selfworking-ai/surface/providers/identity-webauthn.mjs";

export default {
  adapter: claudeCodeAdapter({ cwd: process.cwd() }),
  providers: {
    storage:  fileStore({ dir: process.env.SURFACE_DIR || "./.surface" }),
    audit:    fileAuditSink({ dir: process.env.SURFACE_DIR || "./.surface" }),
    auth:     googleAuth({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri:  process.env.GOOGLE_REDIRECT_URI,    // must be REGISTERED with Google
    }),
    identity: webauthnIdentity({ rpId: "console.example.com", rpName: "Surface" }),
  },
  host: "127.0.0.1",
  allowedOrigins: ["https://console.example.com"],
  openBrowser: false,
};
```

> The default **file** storage + audit are jsonl-on-disk under `SURFACE_DIR`. For a
> multi-host or durable deployment, swap `storage` for a database-backed `StorageProvider`
> behind the same port. The `webauthnIdentity` provider's `register()`/`verify()` require a
> vetted verifier before passkey login works end-to-end — see the WebAuthn boundary in
> [`providers.md`](providers.md).

## Secrets

**Secrets come from the environment, never from committed files.** The Google
`clientSecret` (and any future provider secret) is read from `process.env` inside
`surface.config.js` — the config file carries the *wiring*, not the *secret values*.
Provide them through your process manager / secret store (systemd `EnvironmentFile`, a
`.env` that is git-ignored, your platform's secret manager, …). Surface itself plumbs **no
model API keys at all** — model auth runs through the agent CLI's own local credentials
(see [`security-model.md`](security-model.md) → "No model API keys").

## Scope: single active turn, one client

Surface today assumes **one active turn at a time and effectively one operator client**
(gotchas G11/§11). The kernel's turn state (`liveFrame`, the pending-card maps, the
captured `sessionId`, the per-turn token scoping the `/mcp/*` side channel) lives on the
instance but assumes a single in-flight turn; the audit anchor attributes that turn to one
`activePrincipal`. This is the correct scope for the local-operator and small-team console
it is built for.

**What multi-client / multi-tenant would need** (not in scope today, called out so you
don't deploy past the line):

- key the turn state (`liveFrame`, pending-card maps, `sessionId`, the per-turn token) **by
  connection/session** rather than as instance singletons;
- thread the connection's `principal` through each turn independently (the seam exists —
  `ctx.principal` / `ctx.capabilityToken` — but the in-flight singletons assume one);
- a real auth gate on connect (wire `auth`/`identity` providers) so each client's principal
  and ceiling are established before its first turn, instead of defaulting to the single
  local operator.

Until then: front it for **one trusted operator** (or a small, trusted team sharing one
console), behind TLS, with the origin allowlist set. Do not expose it as a shared
multi-user service.
