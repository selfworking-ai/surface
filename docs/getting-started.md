# Getting started

Surface is a display server + protocol for agent CLIs. You embed it in a host project (or
boot it from the CLI), plug in an **adapter** for your agent runtime, and get a live,
glanceable operator console driven entirely through a locked prompt dock.

This guide takes you from install to your first turn.

## Install

```sh
npm i @selfworking-ai/surface
```

Requirements: **Node 20+**. The core has a single runtime dependency (`ws`) and no build
step.

## Embed in a host project

The whole embedding surface is one function, `createSurface`:

```js
import { createSurface } from "@selfworking-ai/surface";
import { echoAdapter } from "@selfworking-ai/surface/adapters/echo.mjs";

const surface = createSurface({ adapter: echoAdapter(), port: 5757 });
const { url } = await surface.listen();
console.log(`Surface live at ${url}`);
```

Line by line:

- **`import { createSurface } from "@selfworking-ai/surface"`** — the package's main
  export is the kernel factory. It does not start anything on import.
- **`import { echoAdapter } from "@selfworking-ai/surface/adapters/echo.mjs"`** — an
  adapter is the borrowed-fabric seam: it teaches Surface to drive one agent runtime. The
  echo adapter is the in-process reference (no subprocess, no model) that paints your
  prompt back as retained-mode tiles — perfect for a first run. Swap it for the Claude Code
  adapter (M2) or your own.
- **`createSurface({ adapter, port })`** — builds the kernel: the HTTP + WS hub (bound to
  `127.0.0.1` with an origin allowlist), the retained-mode canvas runtime, the workspace
  document, the component registry, and the default file `StorageProvider`. It returns a
  handle; nothing is listening yet. You can also pass `providers`, `packs`, `mode`,
  `host`, `allowedOrigins`, and `openBrowser` (see
  [`surface.config.example.js`](../surface.config.example.js)).
- **`await surface.listen()`** — binds the socket and starts serving. It resolves to
  `{ url }` (e.g. `http://localhost:5757`) and, unless `OPEN_BROWSER=0`, opens a browser.

That is the entire integration: ~5 lines for a live console. See
[`examples/minimal-host`](../examples/minimal-host) for a runnable copy.

## Run from the CLI

You don't need a host file to try it:

```sh
npx surface dev
```

`surface dev` boots a Surface with the built-in echo adapter — or, if a
`./surface.config.js` is present in the working directory, with whatever that config
declares. Copy [`surface.config.example.js`](../surface.config.example.js) to
`surface.config.js` and edit it to wire in a real adapter, providers, packs, and mode.

Environment knobs:

| Var                      | Purpose                                                      |
|--------------------------|--------------------------------------------------------------|
| `SURFACE_PORT` / `PORT`  | HTTP/WS port (default `5757`). Browser opens `localhost:PORT`. |
| `OPEN_BROWSER`           | `0` to skip auto-opening the browser on boot.                |
| `SURFACE_DIR`            | File-store directory (default `./.surface`).                 |

## Your first turn

Open the printed URL. You'll see the locked prompt dock at the bottom — the one input
channel. Type something and send it.

With the echo adapter:

- The **first** turn **mounts** a small set of tiles (a hero, a couple of metrics, a status
  pill).
- Each **later** turn **updates** those same tiles in place rather than repainting the
  canvas — you are watching the retained-mode reconciler patch by component id, which is
  the core difference from a chat transcript.
- Include the word **"ask"** in a prompt and the echo adapter surfaces a glass **decision
  card** and continues the same turn on your tap — a live demo of the bidirectional `ask`
  side channel that real adapters use for permissions and branches.

## How persistence works

Surface persists **presentation** only — never your agent's cognition or org state (the
runtime owns those). The default file `StorageProvider` writes under `SURFACE_DIR`
(default `./.surface`):

- a per-session **frames log** — one self-contained frame per turn, the unit of
  time-travel; and
- the durable **workspace document** — the current retained-mode composition (which
  components, where, bound to what).

Because the store is the source of presentation truth, the **server is logically
stateless**: any instance can serve any session from disk. The *browser* owns session
**identity** — it holds the session id in `localStorage` and replays it with a `resume`
message on (re)connect, so reloading the page restores both the live canvas and its
history.

Scrub past turns with the dock's time-travel rail (read-only; the canvas desaturates to
signal "this is history"); "now" returns you to the present. The agent can also `recall` a
frame to re-surface it verbatim.

The file store is gitignored — don't commit `.surface/`.

## Updating

Surface follows [SemVer](https://semver.org/). Update like any dependency:

```sh
npm update @selfworking-ai/surface
```

Two version lines move independently, and that's deliberate:

- **The package version** (npm SemVer) governs the API surface — `createSurface`, the
  subpath exports, the adapter/provider/pack SDK shapes.
- **The wire protocol version** is negotiated separately. Every message carries an integer
  protocol `v`; the codec tolerates a missing `v` (minimal clients still talk) but rejects
  an *incompatible* one. So if your host and your runtime end up on different protocol
  majors — a real possibility when they update on different cadences — the connection
  **degrades gracefully** (the mismatch is reported) instead of silently corrupting state.
  See [`protocol-spec.md`](protocol-spec.md) for the negotiation rules.

Watch [`CHANGELOG.md`](../CHANGELOG.md) for what changed and the milestone status in the
[README](../README.md) for what's landed.

## Next steps

- [Architecture](architecture.md) — the kernel/userspace split, the protocol, capability
  tiers.
- [Protocol spec](protocol-spec.md) — the message and patch-op reference.
- [Security model](security-model.md) — trust boundaries, modes, the locked dock.
