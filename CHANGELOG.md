# Changelog

All notable changes to **Surface** (`@selfworking-ai/surface`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The **wire protocol** is versioned separately from the package (see
> [`docs/protocol-spec.md`](docs/protocol-spec.md)). A host and a runtime on different
> protocol majors negotiate and degrade gracefully rather than crashing.

## [Unreleased]

_Future (none block the core; all documented): the M4 auth remainder (HTTP auth flow +
connection↔principal correlation, operator-gated install UI, a vetted WebAuthn verifier);
`api-reference.md` + `migration-from-body.md`; an accessibility pass on the dock/primitives;
and the multi-client milestone (per-card principal checks on `answer`/`decision`, a
stuck-turn affordance) — see Known limitations below._

## [0.3.1] — 2026-06-18

An **audit-fix release**: closes the two shipped, user-visible P0 bugs found auditing
v0.3.0, fixes the contract-accuracy (`.d.ts`) drift, and closes the coverage asymmetry the
audit surfaced (the real-runtime wire + the client reconciler had zero automated coverage).
No new milestone; no public API change. Protocol version `1` (unchanged).

### Fixed

**P0 — shipped, user-visible**

- **`scene()` blank box.** The Claude adapter no longer offers the `scene` tool (pulled from
  `ALLOWED_TOOLS` + the MCP tool def/dispatch in `src/adapters/{claude-code,mcp/surface-console}.mjs`)
  because no client scene renderer ships, and the client now guards every scene path — the
  `window.SurfaceScenes` check moved above `showSceneView()` in `playScene()`, and the
  `renderLive()`/`renderSnapshot()` scene branches gate on a renderer being present. The
  canvas can no longer blank.
- **Packs orphaned + config no-op.** `createSurface` now reads **`config.packs`** (array,
  canonical) with **`config.pack`** kept as a back-compat alias, installing each pack in its
  own try/catch (`src/kernel/server.mjs`). Zero-config `surface dev` now seeds the
  **mission-control** starter pack so the boot canvas is composed, not empty
  (`src/cli/surface.mjs`). `package.json` `exports` adds `./packs/*` so packs are importable,
  and `surface.config.example.js` + `examples/minimal-host` now wire a pack (uncommenting the
  example works).

**P2 — contract accuracy (the `.d.ts` matches the runtime now)**

- `TurnContext` (`src/adapter-sdk/adapter.d.ts`) documents the load-bearing `capabilityToken`
  and `sideChannel` fields that were live on `ctx` but absent from the type.
- Removed the dead `recall` `ClientMsg` from `src/protocol/surface-protocol.d.ts` — it was a
  no-op on both ends; time-travel recall works via the `recalled:` field on patch/render and
  the `/mcp/recall` side-channel tool.
- Corrected the stale `mapClaudeEvent` comment in `src/adapters/claude-code.mjs`.
- The reconciler "identical semantics" claim now documents the one tested divergence: an
  `update`/`remove` of an unknown id **no-ops on the client** but is **rejected (with a
  `render-error` signal) on the server**.
- Fixed the resume race: a turn awaits any pending `workspace.load()` before mutating the
  document, so a `--resume` rehydration can no longer clobber just-mounted components
  (`src/kernel/server.mjs`).

### Testing

- Coverage **107 → 179** tests on `node:test`. New committed suites close the audit's central
  finding (the real-runtime + client half had no automated coverage):
  - `test/mcp-side-channel.test.mjs` — `/mcp/*` e2e: per-turn token / `409` gate,
    `/mcp/event`→WS patch, the `ask` + permission HTTP round-trips, on-connect resume.
  - `test/ndjson.test.mjs` — G4: `splitLines` + `readNdjson` cross-chunk / final-flush /
    CRLF / noise tolerance.
  - `test/reconciler-core.test.mjs` — the extracted DOM-free `client/reconciler-core.mjs`:
    op semantics, client/server parity, and the SX-2 live / time-travel state machine.
  - `test/mcp-validators.test.mjs` — the extracted `src/adapters/mcp/validators.mjs`: every
    validator throw-path incl. the G3 deny-on-error default.
- Two pure cores were extracted (behavior-preserving, now consumed by their callers) to make
  the previously browser-only logic node-testable: `client/reconciler-core.mjs` (consumed by
  `client/kernel.js`) and `src/adapters/mcp/validators.mjs` (consumed by `surface-console.mjs`).
- A committed Playwright smoke island + a committed lockfile land in this release; if a
  separate release step finalizes them, this line is updated to match.

### Notes

- **Known limitations (deferred to the multi-client milestone).** Both stem from the
  single-active-turn / one-client assumption (SX-8) and are safe today under the loopback +
  single-operator posture:
  - No principal check on `answer`/`decision` — a second connection could answer another
    connection's card.
  - No stuck-turn affordance — a pending `ask` pins the turn (and a live runtime subprocess)
    until `ASK_TIMEOUT_MS`.

  Both are tracked for the multi-client milestone, where multi-tenant identity becomes
  operable.

## [0.3.0] — 2026-06-17

Ships **M6 (org projection + a second runtime)** and **M7 (signal-gated self-improvement)** —
completing the M0–M7 plan. Protocol version `1` (unchanged).

### Added

**M6 — Org projection + a second runtime (runtime-agnosticism)**

- `src/adapters/orgmock.mjs` — a Tier-A in-process runtime advertising the standard org
  namespaces; emits `org.graph` + `agent.inbox` projections and handles "talk to <node>".
- Generic renderers `client/components/{org-graph,inbox}.js`: a projection's namespace maps to
  a component (`NS_RENDERER`), so a Tier-A runtime lights up org mode with NO bespoke UI and NO
  kernel change — the agnosticism thesis, proven live in a browser.
- A `surface:prompt` bridge — a component dispatches a composed event → a turn (talk-to-any-node).
- `packs/org-console/` (operator profile). Docs: `org-mode.md`, `multi-runtime.md`.

**M7 — Component-smith + gardener (self-improvement)**

- Signal layer: a `SignalSink` port + file/console/noop impls; the kernel records REAL signals
  (render-error, unknown-component, dwell/dismiss, markup). "The signal is the hard part."
- Gardener (`src/kernel/gardener.mjs`): aggregates signals into GATED, ranked revision proposals
  — never auto-applies, never mutates a live mount.
- Component-smith (`src/kernel/smith.mjs`): compose-first search + validate-before-register
  (token-only + manifest) + new-versions-only. Generation stays the agent's gated job.
- Docs: `self-improvement.md` (the honest model + the signal-first caveat).

### Notes

- 107 tests on `node:test`; M6 verified live in a browser. The full M0–M7 plan shipped via
  seven file-zoned parallel agent waves with zero interface drift.

## [0.2.0] — 2026-06-17

Ships **M2–M5**: a real runtime adapter, a generative design system, a privileged provider
plane with multi-tenant identity, and the pack (app) system. Protocol version `1` (unchanged).

### Added

**M2 — Claude Code adapter + capability negotiation**

- `src/adapters/claude-code.mjs` (Tier B): spawns `claude -p --output-format stream-json
  --include-partial-messages --verbose --resume <id>`, maps the stream to canonical
  TurnEvents (pure, unit-tested `mapClaudeEvent`), and routes presentation + decisions
  through a token-scoped loopback MCP side channel (`src/adapters/mcp/surface-console.mjs`).
- Kernel `/mcp/*` side channel (event / ask / permission / screenshot / timeline / recall),
  scoped to the active turn by a per-turn bearer token.
- Adapter SDK: `resolveBin` (G1), line-buffered `readNdjson` (G4).

**M3 — Design system + components + data broker**

- Built-in primitives as shadow-DOM **Web Components** (`metric` / `hero` / `list` /
  `status` / `text` / `kv` + fallback); `:root` tokens cascade through the shadow boundary.
- **Token-only validator** enforced at registration — rejects hardcoded colors/radii (the
  rule that makes runtime component generation survivable).
- Data **broker** (topic pub/sub fan-out).

**M4 — Provider plane + multi-tenant identity**

- Provider plane behind kernel ports: `createSurface({ providers: { storage, audit, auth, identity } })`.
- **Audit anchor** — every mutating action recorded against the responsible principal.
- Identity threaded through the permission containment chain (`component.caps ⊆
  mode.grantable ⊆ principal.ceiling`); `ctx.principal` + capability token.
- Providers: file/console/noop audit sinks, mock auth/identity, real Google OIDC
  (config-gated). WebAuthn challenge-minting ships; signature verification is a documented
  vetted-island boundary (the zero-dep core won't hand-roll security crypto).

**M5 — Packs (the app system)**

- `installPack` / `exportPack` / `importPack`; `createSurface({ pack })` seeds the canvas on boot.
- Three starters: **mission-control** (operator), **business-os** (team), **agentic-site**
  (visitor). Visitor lockdown verified end-to-end.

### Notes

- 91 tests on `node:test`; M2 + M3 verified live in a browser (M2 with a real Claude agent).
- `render(html)` v1 immediate-mode escape hatch retained throughout.

## [0.1.0] — 2026-06-17

First public release. Ships **M0 (rails)** and **M1 (kernel core)** — a reusable,
embeddable, tested core. Protocol version `1`.

### Added

**M0 — Repo & rails**

- MIT `LICENSE`, `README.md`, and a self-contained `README.html` landing page that
  dogfoods the design tokens.
- `package.json` with a subpath `exports` map, `surface` `bin`, and a single runtime
  dependency (`ws`). `engines.node >= 20`.
- `surface.config.example.js` documenting adapter / providers / packs / mode / port /
  host / allowlist configuration.
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, `node --test`, and `npm audit` on
  every push and pull request to `main` (Node 20).
- Documentation skeleton under `docs/` and a zero-dependency `scripts/build-docs.mjs`
  Markdown → HTML mirror (an isolated island; the core stays no-build).
- `test/` harness on `node:test`.

**M1 — Kernel core**

- **Surface Protocol** core: a versioned message envelope (`{ v, … }`), the full
  `ClientMsg` / `ServerMsg` shapes, version negotiation, and a pure dependency-free codec
  (`src/protocol/messages.mjs`) shared by kernel and client so they cannot drift.
- **Retained-mode canvas**: the `mount` / `update` / `remove` / `layout` patch vocabulary
  and a reconciler keyed by component id (mount = upsert, update = shallow-merge,
  remove = delete, layout = merge).
- **Workspace document** (the durable composition) distinct from the **frames log** (turn
  history for time-travel), persisted through a `StorageProvider`.
- **WS hub** bound to `127.0.0.1` with an origin allowlist enforced on the `upgrade`
  handshake (a real `403`, not `verifyClient`).
- Default **file `StorageProvider`** (`src/providers/store-file.mjs`) — frames + workspace
  as JSONL on disk under `SURFACE_DIR` (default `./.surface`).
- **Locked prompt dock** (the single trusted input) + canvas + `ask`/permission decision
  cards + a time-travel seek rail + drawing/screenshot hook, in the `:root` glass tokens.
- `render(html)` retained as the v1 immediate-mode escape hatch.
- **Echo adapter** (`src/adapters/echo.mjs`): a hardcoded, in-process Tier-C reference
  adapter proving the kernel works independent of any real runtime.
- **`createSurface(...)`** embedding API and a `surface dev` CLI.

### Security

- Loopback-only bind and WS origin allowlist on by default (see
  [`SECURITY.md`](SECURITY.md)).
- No Anthropic API keys — auth flows through the user's local agent-CLI credentials.
- Three connection modes (`operator` / `team` / `visitor`); `visitor` is generation-OFF,
  tools-NONE, curated-pack-only.

[Unreleased]: https://github.com/selfworking-ai/surface/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/selfworking-ai/surface/releases/tag/v0.3.1
[0.3.0]: https://github.com/selfworking-ai/surface/releases/tag/v0.3.0
[0.2.0]: https://github.com/selfworking-ai/surface/releases/tag/v0.2.0
[0.1.0]: https://github.com/selfworking-ai/surface/releases/tag/v0.1.0
