# Changelog

All notable changes to **Surface** (`@selfworking-ai/surface`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The **wire protocol** is versioned separately from the package (see
> [`docs/protocol-spec.md`](docs/protocol-spec.md)). A host and a runtime on different
> protocol majors negotiate and degrade gracefully rather than crashing.

## [Unreleased]

_Planned: M6 — org projection (generic `org.graph` / `agent.*` / `schedule.*` renderers +
an org-chart pack) + a second runtime adapter proving agnosticism; M7 — component-smith +
gardener (signal-gated self-improvement)._

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

[Unreleased]: https://github.com/selfworking-ai/surface/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/selfworking-ai/surface/releases/tag/v0.2.0
[0.1.0]: https://github.com/selfworking-ai/surface/releases/tag/v0.1.0
