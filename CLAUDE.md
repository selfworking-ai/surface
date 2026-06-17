# Surface — display server + protocol for agent CLIs

## What this is

**Surface owns the surface; the runtime owns the fabric.** Surface is a kernel —
a locked prompt dock + a retained-mode, composable, persistent canvas + a
component registry + a data broker + an identity/permission boundary + *the
protocol* — that any agent CLI drives to paint a glanceable operator console.
Think **LSP for agent consoles**: Surface is the editor, each agent CLI is a
language server, capability negotiation lights up features.

It is the productized, runtime-agnostic generalization of the `body` prototype
(`../body`): `body` was Claude-Code-only and immediate-mode (`render(html)`
repainted each turn); Surface is runtime-agnostic and **retained-mode** (the
agent *patches* a persistent canvas).

## What this is NOT

- **Not an agent platform.** Surface writes no agent logic, orchestration,
  memory, or spawning. Those are *borrowed* from the runtime via an **adapter**.
- **Not a chat transcript.** The canvas is retained-mode and composable.
- **Not an API-key app.** Auth flows through the user's local agent-CLI creds.
- **Not a build-step project.** Vanilla HTML/CSS/JS, Node ESM, single runtime dep
  (`ws`), tests on `node:test`. Heavy add-ons (e.g. the Remotion scene kit) are
  isolated **build islands** that commit a prebuilt artifact; the core never needs
  a bundler.
- **Not public-by-default.** Loopback bind (`127.0.0.1`) + WS origin allowlist,
  always.

## Two audiences read this file

1. **Operator session** (you, in the terminal) — builds and maintains Surface.
   Read *Architecture*, *File map*, *Gotchas*.
2. **Console agent** (a headless agent-CLI subprocess, via an adapter) — operates
   a Surface. Read *Operating contract*.

> **Continuity (operators):** a local, gitignored `Team/` may hold the experienced
> agent team that built this — its roster, the role→zone map, per-role skills +
> gotchas, the orchestration playbook, and the release flow. **If `Team/` is present,
> read `Team/ONBOARDING.md` first** to start ahead; the roles are spawnable as
> `surface-*` subagents (`.claude/agents/`, also gitignored).

---

## Operating contract (console agent — every turn)

- **Answer by composing, not by talking.** Patch the canvas with `mount` /
  `update` / `remove` / `layout` ops (retained-mode). The user sees only the
  canvas, never your chat text. `render(html)` survives as a v1 escape hatch.
- **Compose ≠ generate.** Most turns *arrange registered components* (cheap,
  deterministic). Authoring a *new* component is the rare, gated path.
- **Keep it glanceable.** A person grasps the canvas in ~2 seconds. Summarize;
  never dump walls of text or whole files into a tile.
- **Decisions go through `ask`, never the terminal.** Permissions, branches, and
  confirmations surface as glass cards in the page and block on the user's tap.
- **Reuse `:root` tokens.** The glass system is the contract; never invent
  colors/radii. Registration rejects non-token values.
- **Stay quiet when idle.** No fake progress theater.

---

## Architecture (the synthesized design)

### Kernel vs userspace (the OS split)

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

The dock is the kernel's syscall interface — the one trusted input channel. It is
locked for UX **and security**: it's what makes visitor-facing (untrusted) mode safe.

### Ownership split

| **Surface owns** | **Runtime owns (never reimplemented here)** |
|---|---|
| locked dock (trusted input) | durable agents, their identity & memory |
| canvas runtime, patch protocol, workspace doc | spawn / recompile-the-org |
| **the protocol + capability negotiation** | agent-to-agent messaging & routing |
| identity/auth (SSO/biometric providers) | scheduling / triggers |
| audit anchor (principal attribution) | the org graph as **source of truth** |
| persistence of **presentation** (frames, layout) | persistence of **cognition + org state** |

Surface stores a cached **projection** of org state; it is never the source of truth.

### Two extension planes

- **Apps / Packs (userspace):** dashboards, components, rosters, workflows.
  Sandboxed, low-trust, **agent-authorable at runtime**.
- **Providers (privileged, behind kernel ports):** auth, identity, storage, audit,
  transport, connectors. Trusted, vetted/signed; **the agent configures, never
  authors** (an operator-gated install flow enables a pre-vetted provider).

Decision rule: *composes on the canvas + safe to author at runtime* → **app/pack**.
*Provides a system capability or touches trust / persistence / transport* →
**provider behind a port**.

### Runtime-agnostic protocol (LSP model)

- **Core (every runtime):** prompt in → paint/`ask`/patch out, capability
  declaration, principal attribution.
- **Extensions (capability-namespaced, opt-in):** `standard` (`org.graph`,
  `agent.*`, `schedule.*`, `memory.*` — Surface ships generic renderers) and
  `vendor` (`claude.subagents`, `hermes.*`, … — the runtime ships its own pack).

**Capability tiers (graceful degradation):** **A** native fabric (full org mode) ·
**B** session orchestration (subagents within a turn) · **C** single agent (org
features dark). The kernel lights affordances by what the adapter advertises.

### Identity & authority split

Surface authenticates the **human principal** and sets the **ceiling** (this human
may grant up to capability X), passing a principal + capability token into the
runtime on spawn. The runtime enforces **attenuation within its agent tree**
(spawned ≤ spawner). Every runtime action carries Surface's principal token →
`AuditSink`.

### Retained-mode canvas (the biggest change vs `body`)

- Vocabulary: `mount` / `update` / `remove` / `layout` (+ `ask`, `render`, `scene`).
- A **workspace document** holds the durable composition; the **frames log** is
  turn history for time-travel (kept from `body`). Two distinct stores.
- A tiny vanilla DOM **reconciler** keyed by component id diffs and applies patches.
  The server reconciler (`reconciler.mjs`, pure) and the client core
  (`client/reconciler-core.mjs`, pure, consumed by `kernel.js`) share the same op
  semantics: mount = upsert, update = shallow-merge, remove = delete, layout = merge.
  **One documented divergence** (tested both ways): an update/remove of an *unknown
  id* is a no-op on the client (returns `{action:"noop", reason}`) but is *rejected*
  on the server (pushed to `rejected`, surfaced as a `render-error` signal). Low
  impact (the server filters before broadcast); asserted in `test/reconciler-core.test.mjs`.

### Design system — four rings

```
tokens (:root glass) → primitives (metric, list, status, …) → composed → packs
```
Each ring constrains the one above. Visual language: the visionOS glass system
from Claude.ai/design (lime accent, warm/cool backdrop, blur 36px / saturate 1.8,
concentric radii, soft shadows) — implemented pixel-faithfully, not paraphrased.

---

## The contracts (the spine — written first; in `src/protocol`, `src/*-sdk`)

- **Surface Protocol** (`protocol/surface-protocol.d.ts` + `messages.mjs` codec):
  `ClientMsg` / `ServerMsg`, `PatchOp` (mount/update/remove/layout), `Capabilities`,
  versioned envelope (`{v, …}`), version negotiation. The codec is the executable
  source of truth for framing; the `.d.ts` is the editor-facing shape.
- **AgentAdapter** (`adapter-sdk/adapter.d.ts`): the borrowed-fabric seam. Refined
  from the plan's `spawn()/parseStream()` to a runtime-agnostic
  `run({prompt, ctx}): AsyncIterable<TurnEvent>` + a `TurnContext` for the
  bidirectional side channels (`ask`, `requestPermission`, `screenshot`). See
  `docs/adr/0001-adapter-run-iterator.md`.
- **Provider ports** (`provider-sdk/ports.d.ts`): `StorageProvider` (the only one
  implemented in v1 — `providers/store-file.mjs`), plus `AuthProvider`,
  `IdentityProvider`, `AuditSink`, `TransportProvider`, `ConnectorProvider` [M4].
- **Manifests** (`pack-sdk/pack.d.ts`): `ComponentManifest` (`tokensOnly: true`),
  `PackManifest`, `AgentManifest` (a projection, not a source of truth).
- **Modes**: `operator` | `team` | `visitor` (visitor = generation OFF, tools NONE,
  curated pack only). Grant rule: `component.caps ⊆ mode.grantable ⊆ principal.ceiling`.

---

## File map

```
surface/
├── CLAUDE.md · README.md · README.html · LICENSE (MIT) · CHANGELOG.md
├── SECURITY.md · CONTRIBUTING.md · surface.config.example.js
├── package.json            # type:module, exports map, bin, dep: ws
├── .github/workflows/ci.yml
├── src/
│   ├── kernel/             # server.mjs · reconciler.mjs · workspace.mjs ·
│   │                       #   broker.mjs · registry.mjs · permissions.mjs · identity.mjs
│   ├── protocol/           # messages.mjs (codec) · namespaces.mjs · surface-protocol.d.ts
│   ├── adapter-sdk/        # adapter.d.ts · ndjson.mjs (G4) · resolve-bin.mjs (G1) · index.mjs
│   ├── adapters/           # echo.mjs (M1 ref) · claude-code.mjs (M2)
│   ├── provider-sdk/       # ports.d.ts · index.mjs
│   ├── providers/          # store-file.mjs (default StorageProvider)
│   ├── pack-sdk/           # pack.d.ts · index.mjs
│   └── cli/                # surface.mjs (init | dev)
├── client/                 # served static (zero-build, ESM + Web Components)
│   ├── index.html · kernel.js · style.css · components/ · favicon.svg
├── packs/                  # starter packs (M5)
├── examples/minimal-host/  # ~10-line embed of Surface in a host project
├── test/                   # node:test
└── docs/                   # getting-started · architecture · protocol-spec · security-model · adr/
```

## Env knobs

| Var               | Purpose                                                         |
|-------------------|-----------------------------------------------------------------|
| `SURFACE_PORT` / `PORT` | HTTP/WS port (default 5757). Browser opens `localhost:PORT`. |
| `OPEN_BROWSER`    | `0` to skip auto-opening the browser on boot.                   |
| `SURFACE_DIR`     | Persistence dir for the file store (default `./.surface`).      |
| `CLAUDE_BIN` (per-adapter `*_BIN`) | Absolute path to an agent CLI binary, overriding resolution (G1). |

---

## Gotchas — baked in as tested invariants (do NOT relearn)

1. **G1** Agent CLIs (e.g. `claude`) are often shell aliases → `spawn` ENOENT.
   Resolve the binary at boot: env override → `which` → known paths. Adapter-only
   (the M1 echo adapter has no subprocess).
2. **G2** Claude stream-json needs **both** `--include-partial-messages` AND
   `--verbose` (M2 adapter).
3. **G3** `--permission-mode acceptEdits` does NOT auto-approve all; route prompts
   through `ask` so headless turns never silently hang; surface stderr to the UI.
4. **G4** NDJSON must be line-buffered across stdout chunks (rolling string, slice
   on `\n`). `adapter-sdk/ndjson.mjs`.
5. **G5** TDZ trap: any module-scope `const` reachable from boot must be declared
   above the boot block. Hoist; don't defer. (Client `kernel.js` especially.)
6. **G6** `[hidden]` loses to `class + display:<value>` → add `.x[hidden]{display:none}`.
7. **G7** Dev hot-reload: `no-store, must-revalidate` + `pragma:no-cache` + `expires:0`.
8. **G8** WS origin allowlist + **127.0.0.1 bind** mandatory; intercept `upgrade`
   with `{noServer:true}` and return a real 403 (not `verifyClient`).
9. **G11** Session continuity per-process: capture the runtime's session id once,
   thread resume forward. Browser owns the id and replays `{type:"resume"}`.
10. **G12** Persistence is the browser's job for session *identity*; the server is
    logically stateless (any instance serves any session from the store). The
    frames log + workspace doc are the deliberate durable-presentation exception.

---

## Build discipline (maintainer's operating profile)

- Vanilla / no-build / single-dep; reuse `:root` tokens, never invent. **Working
  server at the end of every turn**; document half-wired flags as explicit gaps.
- When closing many gaps, spawn **file-zoned parallel agent waves** (kernel vs
  client vs docs — no overlap, no worktrees). Syntax-check + smoke-test between waves.
- Verify the UI through a real browser (Playwright), not syntax checks alone.
- Brief, direct status each turn: what landed, where, what's next.
- Milestones (A4 phasing): **M1** kernel core (first shippable) → M2 Claude adapter
  → M3 design system + broker → M4 providers + identity → M5 packs → M6 org
  projection + 2nd runtime → M7 component-smith + gardener.
```
