# Architecture

Surface is a **display server + protocol for agent CLIs**. The thesis in one line:
**Surface owns the surface; the runtime owns the fabric.** Surface is a kernel — a locked
prompt dock, a retained-mode composable canvas, a component registry, a data broker, an
identity/permission boundary, and *the protocol* — that any agent CLI drives to paint a
glanceable operator console. Think **LSP for agent consoles**: Surface is the editor, each
agent CLI is a language server, and capability negotiation lights up features.

It is the runtime-agnostic, retained-mode generalization of the `body` prototype.

## Kernel vs userspace (the OS split)

```
┌─ KERNEL (locked, privileged, always present) ─────────────────────────┐
│  prompt dock (the ONLY fixed UI — users cannot modify/move/restyle it) │
│  canvas runtime (retained-mode reconciler) · workspace document        │
│  component registry · data broker (topic bus) · permission/identity    │
│  WS transport (127.0.0.1 + origin allowlist) · the Surface Protocol    │
└────────────────────────────────────────────────────────────────────────┘
┌─ USERSPACE (mutable, per-workspace, agent/operator-authorable) ────────┐
│  components on the canvas · layout · data bindings · packs (apps)       │
└────────────────────────────────────────────────────────────────────────┘
```

The dock is the kernel's **syscall interface** — the one trusted input channel. It is
locked for UX **and security**: a locked dock is precisely what makes a visitor-facing
(untrusted) mode safe.

## Ownership split — Surface owns the surface, the runtime owns the fabric

| **Surface owns** | **Runtime owns (never reimplemented here)** |
|---|---|
| locked dock (trusted input) | durable agents, their identity & memory |
| canvas runtime, patch protocol, workspace doc | spawn / recompile-the-org |
| **the protocol + capability negotiation** | agent-to-agent messaging & routing |
| identity/auth (SSO/biometric providers) | scheduling / triggers |
| audit anchor (principal attribution) | the org graph as **source of truth** |
| persistence of **presentation** (frames, layout) | persistence of **cognition + org state** |

Surface stores a cached **projection** of org state; it is never the source of truth. This
is what keeps Surface from becoming yet another agent platform — it has no opinion about
how agents think, only about how their state is shown and decided.

## Two extension planes (the modularity model)

|              | **Apps / Packs** (userspace)                       | **Providers** (privileged, behind kernel ports)         |
|--------------|----------------------------------------------------|---------------------------------------------------------|
| What         | dashboards, components, agent rosters, workflows   | auth, identity, storage, transport, audit, connectors   |
| Trust        | sandboxed, low                                     | trusted, kernel-level                                   |
| Authored by  | the agent, at runtime                              | vetted/signed; **agent configures, never authors**      |
| Examples     | mission control, org-chart UI, sales pack          | Google SSO, WebAuthn, Postgres store, Slack/Stripe connector |

**Decision rule for any new feature:** *composes on the canvas and is safe to author at
runtime* → **app/pack**. *Provides a system capability or touches trust / persistence /
transport* → **provider behind a port**.

"Build everything via the console" is preserved by an **operator-gated install flow**: an
authenticated, elevated operator enables a provider from a vetted catalog through the dock;
the agent *orchestrates the install of a pre-vetted provider, never authors the kernel
module*. Self-improving / agent-builds-it magic stays in userspace.

## Runtime-agnostic protocol (the LSP model)

A thin guaranteed core plus opt-in capability namespaces:

- **Core (every runtime, guaranteed):** prompt in → paint / `ask` / patch out, capability
  declaration, principal attribution.
- **Extensions (capability-namespaced, opt-in):**
  - **standard** — `org.graph`, `agent.spawn`, `agent.message`, `agent.inbox`,
    `schedule.*`, `memory.*`. Surface ships **generic renderers**.
  - **vendor** — `claude.subagents`, `hermes.*`, `selfworking.org`. A passthrough escape
    hatch; the runtime ships its **own pack** to render these with fidelity.

### Capability tiers (graceful degradation)

An adapter advertises an org tier in its `Capabilities`, and the kernel lights affordances
accordingly:

- **A — native fabric:** durable agents + registry + messaging + spawn → full org mode.
- **B — session orchestration:** subagents within a turn → a live delegation tree +
  projection; durable employees emulated via the runtime's resume model.
- **C — single agent:** no fabric → single-agent console, org features stay dark.

The same Surface, unchanged, renders a Tier-A org console for one runtime and a quiet
single-agent surface for another — only the adapter and an optional pack differ.

## Identity & authority split

Surface authenticates the **human principal** and sets the **ceiling** (this human may
grant up to capability X), passing a principal + capability token into the runtime on
spawn. The runtime enforces **attenuation within its own agent tree** (a spawned agent's
authority ≤ its spawner's). Every runtime action carries Surface's principal token to an
`AuditSink`. So Surface is the authority boundary at the *human ↔ runtime* edge and the
audit anchor; the runtime owns propagation below that edge.

The grant rule everywhere is:

```
component.capabilities ⊆ mode.grantable ⊆ principal.ceiling
```

## Retained-mode canvas (the biggest change vs `body`)

`body` was **immediate-mode**: `render(html)` repainted the whole canvas each turn. Surface
is **retained-mode**: the agent **patches** a persistent canvas.

```
  browser  ── client/index.html · kernel.js · style.css ──┐
     │  { type:"prompt", text }                            │ { type:"patch" | "ask" | … }
     ▼                                                     ▲
  kernel (src/kernel/server.mjs)                           │
  http+ws · 127.0.0.1 + origin allowlist · reconciler ·    │
  workspace doc · registry · broker · permissions/identity │
     │  run({ prompt, ctx })                               ▲ TurnEvents → ServerMsgs
     ▼                                                     │
  AgentAdapter (src/adapters/*.mjs)                        │
  echo (M1, in-process) · claude-code (M2, subprocess) ────┘
```

- **Vocabulary:** `mount` / `update` / `remove` / `layout` (plus `ask`, the v1 `render`
  escape hatch, and the v2 `scene` spec).
- A **workspace document** holds the durable composition (which components, where, bound to
  what data). The **frames log** is the separate turn-history store used for time-travel.
  *Two distinct stores.* For retained-mode turns a frame stores a self-contained workspace
  **snapshot**, so recall rebuilds the canvas at turn N without folding the whole history.
- A tiny vanilla DOM **reconciler** keyed by component id diffs and applies patches. The
  server-side reconciler (`reconciler.mjs`, pure) and the client DOM reconciler implement
  **identical op semantics**: `mount` = upsert, `update` = shallow-merge, `remove` =
  delete, `layout` = merge.
- `render(html)` survives as the v1 immediate-mode escape hatch.

## Component system

- Each block is a **Web Component** (shadow DOM = visual/style isolation; tokens cascade
  via CSS custom properties).
- Each has a **manifest** (name, version, props schema, data contract, required
  capabilities, `tokensOnly: true`).
- Components never hold direct refs to each other — they **publish/subscribe through the
  data broker** (a topic bus). That's the "isolated but flexible" / microservice mapping,
  and what makes the UI *living*: a tile binds a topic, a source pushes, the tile
  re-renders.
- **Compose ≠ generate.** Most turns *arrange registered components* (cheap, deterministic);
  authoring a *new* component is the rare, gated path.

## Design system — four rings

```
tokens (:root glass) → primitives (metric, list, status, …) → composed → packs
```

Each ring constrains the one above. **Registration rejects** non-token values (hardcoded
colors/radii). The visual language is the visionOS glass system from Claude.ai/design (lime
accent, warm/cool backdrop, blur 36px / saturate 1.8, concentric radii, soft shadows) —
implemented pixel-faithfully, not paraphrased. The design tokens are the contract; this
project's own `README.html` is rendered in them as a dogfooding showcase.

## Self-improvement (signal-gated, not magic)

Reuse is a searchable, versioned registry — a component-smith subagent searches before
authoring. Improvement is **a signal plus a gated revision loop**, and *the signal is the
hard part — design it first or it's theater*. Signals: render errors / layout overflow
(the validator), dwell/dismiss telemetry, and the drawing/screenshot markup feature. Loop:
emit → observe → critique → revise → re-validate → register a **new version** (never
auto-mutate a live mount). This is the last thing built (M7), behind the gardener subagent.

## Where the code lives

```
src/kernel/        server.mjs · reconciler.mjs · workspace.mjs ·
                   broker.mjs · registry.mjs · permissions.mjs · identity.mjs
src/protocol/      messages.mjs (codec) · namespaces.mjs · surface-protocol.d.ts
src/adapter-sdk/   adapter.d.ts · ndjson.mjs (G4) · resolve-bin.mjs (G1) · index.mjs
src/adapters/      echo.mjs (M1 ref) · claude-code.mjs (M2)
src/provider-sdk/  ports.d.ts · index.mjs
src/providers/     store-file.mjs (default StorageProvider)
src/pack-sdk/      pack.d.ts · index.mjs
src/cli/           surface.mjs (init | dev)
client/            index.html · kernel.js · style.css · components/ · favicon.svg
```

See the [protocol spec](protocol-spec.md) for the wire contract, the
[security model](security-model.md) for trust boundaries, and the ADRs
([0001](adr/0001-adapter-run-iterator.md), [0002](adr/0002-retained-mode-canvas.md)) for
the two load-bearing design decisions.
