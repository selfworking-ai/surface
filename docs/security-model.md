# Security model

Surface runs a console that can drive an agent CLI with real file, shell, and network
access. Its security is structural, not bolted on — the relevant gotchas in
[`CLAUDE.md`](../CLAUDE.md) are baked in as tested invariants. This page is the full model;
[`SECURITY.md`](../SECURITY.md) is the short version plus the disclosure process.

## Trust boundary: kernel vs userspace

```
┌─ KERNEL (locked, privileged, always present) ─────────────────────────┐
│  prompt dock (the ONLY fixed UI — users cannot modify/move/restyle it) │
│  canvas runtime · workspace document · component registry · broker     │
│  permission/identity boundary · WS transport (127.0.0.1 + allowlist)   │
│  the Surface Protocol · providers behind kernel ports                  │
└────────────────────────────────────────────────────────────────────────┘
┌─ USERSPACE (mutable, low-trust, agent/operator-authorable) ────────────┐
│  components on the canvas · layout · data bindings · packs (apps)       │
└────────────────────────────────────────────────────────────────────────┘
```

The kernel is privileged and always present. Userspace is mutable and **low-trust**:
agent-authorable at runtime, sandboxed via shadow-DOM component isolation, and structurally
unable to touch trust, persistence, or transport. The two extension planes encode this:

- **Apps / Packs** are userspace — composed on the canvas, safe to author at runtime.
- **Providers** (auth, identity, storage, transport, audit, connectors) live **behind
  kernel ports** — trusted, vetted/signed. The agent may *configure* a pre-vetted provider
  through an **operator-gated install flow**, but it **never authors** a kernel module.

Decision rule: *composes on the canvas + safe at runtime* → app/pack; *provides a system
capability or touches trust / persistence / transport* → provider behind a port.

## The locked dock — the single trusted input

Every instruction enters Surface through exactly one channel: the prompt dock. Users
cannot move, restyle, or replace it. That single trusted input is the kernel's syscall
interface, and locking it is what makes an **untrusted, visitor-facing surface safe** — an
untrusted viewer is handed a curated surface, not a programmable syscall interface. Any
input that did not arrive through the dock is not an instruction.

## The three modes

A connection locks into one mode (`ClientMsg` `{ type: "mode" }`), and the mode sets what
may be granted:

| Mode       | Generation | Tools  | Surface                          | Trust posture |
|------------|------------|--------|----------------------------------|---------------|
| `operator` | full       | full   | full canvas                      | trusted, single human |
| `team`     | scoped     | scoped | scoped, attributable             | attributable to a principal |
| `visitor`  | **OFF**    | **NONE** | a curated pack only            | untrusted viewers |

The kernel enforces the grant rule on every component:

```
component.capabilities ⊆ mode.grantable ⊆ principal.ceiling
```

### Visitor-mode lockdown

`visitor` is a hard lockdown, the mode that makes a public agentic surface defensible:

- **Generation is OFF** — no new components are authored at runtime; only the curated,
  pre-installed pack is shown.
- **Tool access is NONE** — the visitor cannot drive file/shell/network tools.
- The viewer interacts with a curated pack through the locked dock and nothing else.

This is the configuration a site uses to "expose an agentic surface where visitors talk
directly to an agent" without exposing the agent's capabilities.

## Loopback bind + origin allowlist (rationale, gotcha G8)

Two mandatory transport controls:

- **Bind `127.0.0.1`.** The server is never public by default. Because it can run an agent
  CLI with real access, a public bind would be remote code execution waiting to happen. A
  deliberate reverse proxy in front of it is the only supported way to expose it.
- **WS origin allowlist on a real-403 handshake.** WebSocket upgrades are intercepted on
  the `upgrade` event with `{ noServer: true }` and rejected with a genuine HTTP `403`
  unless the `Origin` is allowlisted (`http://localhost:<port>` / `http://127.0.0.1:<port>`,
  plus same-origin / no-Origin). This is done at the handshake — **not** via the `ws`
  library's `verifyClient`, which cannot return a proper HTTP status. Without the allowlist,
  any other page the user has open on localhost could connect to the hub and drive the
  agent; the allowlist is what closes that cross-origin hole.

## Identity & authority split

Surface is the authority boundary at the **human ↔ runtime** edge:

- Surface authenticates the **human principal** and sets the **ceiling** — the maximum
  capability this human may grant. It passes a principal + capability token into the
  runtime on spawn.
- The runtime enforces **attenuation within its own agent tree**: a spawned agent's
  authority is always ≤ its spawner's. Surface does not reimplement that propagation — the
  runtime owns the fabric.

So Surface sets the *ceiling*; the runtime *attenuates beneath it*. The `Principal` carries
its `ceiling` (the capabilities it may grant), and the grant rule above bounds every
component by `mode.grantable` bounded in turn by `principal.ceiling`.

## Audit anchor (principal attribution)

Because Surface holds the principal at the human↔runtime edge, it is the natural audit
anchor: **every runtime action carries Surface's principal token to an `AuditSink`**, so
each mutating action is attributable to a human. The `AuditSink` port is defined now
(`src/provider-sdk/ports.d.ts`) and implemented in M4 alongside the auth/identity providers;
the contract is fixed so the M4 work targets a stable shape.

## No model API keys

Surface plumbs **no Anthropic (or other model) API keys**. Authentication to the model runs
entirely through the user's **local agent-CLI credentials**, inherited by the adapter's
subprocess. SSO/identity providers authenticate the *human*, never a model key. There is no
model key material in Surface to leak.

## No silent hangs

A headless agent subprocess has nobody to answer an interactive prompt, so a sensitive
operation could otherwise stall a turn forever. Surface routes permission and decision
prompts through `ask` / `permission` glass cards in the page (the kernel is the
permission-prompt surface) and surfaces adapter `stderr` to the UI via `turn-end`. A
blocked operation blocks **visibly**, on a tap, instead of hanging silently (gotcha G3).

## Reporting

Security vulnerabilities go to **security@selfworking.ai** (placeholder; update before
launch) — **not** a public issue. See [`SECURITY.md`](../SECURITY.md) for the process,
supported versions, and scope.
