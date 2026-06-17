<!-- Surface — README (GitHub entry). The styled, dogfooded landing page is README.html. -->

# Surface

**Surface owns the surface; the runtime borrows the fabric — LSP for agent consoles.**

Surface is a *display server + protocol for agent CLIs*. It owns the **surface** — a
locked prompt dock and a generative, composable, persistent canvas — and *borrows the
fabric* (agents, memory, orchestration) from whatever agent runtime is plugged in via an
**adapter**. Think **LSP for agent consoles**: Surface is the editor, each agent CLI is a
language server, and capability negotiation lights up features.

It is the productized, runtime-agnostic generalization of the [`body`](../body) prototype:
`body` was Claude-Code-only and immediate-mode (`render(html)` repainted every turn);
Surface is runtime-agnostic and **retained-mode** (the agent *patches* a persistent canvas).

---

## What it is

- A **kernel**: a locked dock (the one trusted input) + a retained-mode canvas runtime +
  a component registry + a data broker + an identity/permission boundary + **the protocol**.
- **Runtime-agnostic.** Any agent CLI drives it through an `AgentAdapter`. The kernel never
  reimplements agents.
- **Embeddable.** `npm i @selfworking-ai/surface`, call `createSurface(...)`, get a live
  console in ~10 lines.
- **Zero-build.** Vanilla HTML/CSS/JS, Node ESM, a single runtime dependency (`ws`), tests
  on `node:test`. Heavy add-ons are isolated build islands that commit a prebuilt artifact;
  the core never needs a bundler.

## What it is *not*

- **Not an agent platform.** Surface writes no agent logic, orchestration, memory, or
  spawning — those are borrowed from the runtime.
- **Not a chat transcript.** The canvas is retained-mode and composable, not a scroll log.
- **Not an API-key app.** Auth flows through the user's local agent-CLI credentials. No
  Anthropic API keys.
- **Not public-by-default.** Loopback bind (`127.0.0.1`) + WS origin allowlist, always.

---

## 60-second quickstart

Embed Surface in a host project:

```js
import { createSurface } from "@selfworking-ai/surface";
import { echoAdapter } from "@selfworking-ai/surface/adapters/echo.mjs";

const surface = createSurface({ adapter: echoAdapter(), port: 5757 });
const { url } = await surface.listen();
console.log(`Surface live at ${url}`);
```

Or boot one straight from the CLI (uses the echo adapter, or `./surface.config.js` if
present):

```sh
npx surface dev
```

Open the printed URL, type into the dock, and watch the echo adapter paint retained-mode
tiles — `mount` on the first turn, `update`-in-place after, so you can see the reconciler
patch rather than repaint.

## Install

```sh
npm i @selfworking-ai/surface
```

Update across projects with `npm update` — the wire protocol is versioned and negotiated
separately, so a host and a runtime on different protocol versions degrade gracefully
instead of corrupting state.

| Env var                  | Purpose                                                     |
|--------------------------|-------------------------------------------------------------|
| `SURFACE_PORT` / `PORT`  | HTTP/WS port (default `5757`). Browser opens `localhost:PORT`. |
| `OPEN_BROWSER`           | `0` to skip auto-opening the browser on boot.               |
| `SURFACE_DIR`            | File-store directory (default `./.surface`).                |

---

## Capability tiers (graceful degradation)

Surface speaks a thin core to every runtime, then lights up extra affordances by what the
adapter advertises (the LSP model). An adapter declares its **org tier**:

- **Tier A — native fabric.** Durable agents + registry + messaging + spawn → full org mode.
- **Tier B — session orchestration.** Subagents within a turn → live delegation tree;
  durable employees emulated via the runtime's resume model.
- **Tier C — single agent.** No fabric → single-agent console, org features stay dark.

The kernel renders whatever the connected runtime supports and quietly hides the rest.

## Features

- **Retained-mode canvas** — the agent patches a persistent workspace with `mount` /
  `update` / `remove` / `layout` ops; a tiny reconciler diffs by component id.
- **Versioned protocol** — every wire message carries a protocol version; mismatches are
  negotiated, not crashed.
- **Locked prompt dock** — the kernel's syscall interface and the single trusted input
  channel; locked for UX *and* security.
- **Decision cards** — permissions and branches surface as glass `ask` cards in the page
  and block on the user's tap, so headless turns never silently hang.
- **Time-travel** — every turn commits a self-contained frame; scrub past dashboards
  read-only and `recall` one verbatim.
- **Three modes** — `operator` (full), `team` (scoped + attributable), `visitor`
  (generation OFF, tools NONE, curated pack only).
- **File store by default** — frames + workspace persist as JSONL on disk; swap the
  `StorageProvider` for Postgres/Redis behind a kernel port.
- **Glass design system** — a visionOS glass token system (lime accent, warm/cool backdrop,
  blur 36px / saturate 1.8, concentric radii). Registration rejects non-token values.

---

## Milestone status

Surface ships in independently shippable milestones. **v0.1 is M1: the kernel core.**

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Repo & rails: license, package, CI, docs skeleton, test harness | ✅ shipped |
| **M1** | **Kernel core** — retained-mode canvas + reconciler, versioned protocol, origin-allowlisted WS hub, file store, locked dock, echo adapter | ✅ shipped (v0.1) |
| M2 | Adapter SDK + Claude Code adapter + capability negotiation | ▫ planned |
| M3 | Design system + components + data broker | ▫ planned |
| M4 | Provider plane + multi-tenant identity | ▫ planned |
| M5 | Packs (the app system) | ▫ planned |
| M6 | Org projection + a second runtime (prove agnosticism) | ▫ planned |
| M7 | Component-smith + gardener (signal-gated self-improvement) | ▫ planned |

**M1 delivers:** a retained-mode canvas + reconciler, the Surface Protocol (versioned
envelope + negotiation), an origin-allowlisted `127.0.0.1` WS hub, a file-backed
`StorageProvider`, a locked dock with time-travel, and a hardcoded echo adapter — enough
for another project to `npm i`, mount, and get a live console.

---

## Documentation

- [Getting started](docs/getting-started.md) — install, embed, run, persist, update.
- [Architecture](docs/architecture.md) — kernel vs userspace, the protocol, capability tiers.
- [Protocol spec](docs/protocol-spec.md) — the Surface Protocol reference.
- [Security model](docs/security-model.md) — trust boundaries, modes, the locked dock.
- ADRs: [adapter run-iterator](docs/adr/0001-adapter-run-iterator.md) ·
  [retained-mode canvas](docs/adr/0002-retained-mode-canvas.md).

A zero-dependency `node scripts/build-docs.mjs` mirrors `docs/**/*.md` to styled HTML (an
isolated island; the core stays no-build).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The philosophy is zero-build, single-dep, and
token-only; the gotchas in [CLAUDE.md](CLAUDE.md) are tested invariants, not tribal lore.

## Security

Loopback bind, origin allowlist, a locked dock as the single trusted input, and no model
API keys. Report vulnerabilities per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
