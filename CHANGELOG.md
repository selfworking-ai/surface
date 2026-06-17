# Changelog

All notable changes to **Surface** (`@selfworking-ai/surface`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The **wire protocol** is versioned separately from the package (see
> [`docs/protocol-spec.md`](docs/protocol-spec.md)). A host and a runtime on different
> protocol majors negotiate and degrade gracefully rather than crashing.

## [Unreleased]

_Planned (each milestone independently shippable): M2 — Adapter SDK + Claude Code adapter
+ capability negotiation; M3 — design system + components + data broker; M4 — provider
plane + multi-tenant identity; M5 — packs; M6 — org projection + a second runtime; M7 —
component-smith + gardener (signal-gated self-improvement)._

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

[Unreleased]: https://github.com/selfworking-ai/surface/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/selfworking-ai/surface/releases/tag/v0.1.0
