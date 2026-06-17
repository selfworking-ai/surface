# Authoring adapters

An **adapter** is the borrowed-fabric seam: it teaches Surface to drive one agent
runtime. Surface owns the surface (dock + retained-mode canvas + protocol); the
adapter translates a runtime's native stream into canonical **TurnEvents** and
declares what the runtime can do via **Capabilities**. Surface writes no agent
logic, memory, or orchestration — the adapter borrows all of that.

The full contract is `src/adapter-sdk/adapter.d.ts`. Two reference adapters ship:
`src/adapters/echo.mjs` (in-process, the minimal example) and
`src/adapters/claude-code.mjs` (subprocess + MCP side channel, the real one).

## The shape

```js
/** @returns {import("@selfworking-ai/surface/adapter-sdk").AgentAdapter} */
export function myAdapter(opts = {}) {
  return {
    name: "my-runtime",
    capabilities: { /* see below */ },
    async *run({ prompt, ctx }) { /* yield TurnEvents until turn_done */ },
    async init() {},            // optional one-time setup
    async resolveBin() {},      // optional, for subprocess runtimes (G1)
  };
}
```

`run()` is an **async generator**. It drives exactly one turn and yields canonical
`TurnEvent`s until it yields `{ kind: "turn_done" }`. This single method replaces
the build plan's `spawn()`/`parseStream()` split (see `adr/0001-adapter-run-iterator.md`)
— because not every runtime is a subprocess. A subprocess adapter spawns + parses
internally; an in-process one yields directly.

## TurnEvents (what `run()` yields)

| kind | payload | effect |
|---|---|---|
| `session_started` | `{ id }` | Surface persists the id (G11) + the browser replays it (G12). Capture once. |
| `patch` | `{ ops }` | Apply mount/update/remove/layout to the retained-mode canvas. |
| `render` | `{ html }` | v1 immediate-mode escape hatch (full repaint). |
| `scene` | `{ spec }` | v2 animated scene (optional player). |
| `tool_call` | `{ id, name, args }` | A row in the activity feed. |
| `usage` | `{ model, inputTokens, outputTokens }` | The context meter. |
| `status` | `{ text }` | The quiet working pill. |
| `projection` | `{ namespace, data }` | A borrowed-namespace projection (org.graph, …). |
| `text_delta` | `{ text }` | Streaming assistant text (not surfaced in v1). |
| `error` | `{ message }` | Toasted in the UI (never a silent hang — G3). |
| `turn_done` | `{ code? }` | Ends the turn. |

## TurnContext (`ctx`) — the bidirectional side channels

A plain event stream can't express things that need a *response*. Those live on
`ctx`:

- `ctx.ask(question, options, context?)` → `Promise<{label, value, cancelled?}>` — surface a glass decision card; blocks the turn until the user taps.
- `ctx.requestPermission(tool, input)` → `Promise<{behavior, updatedInput?, message?}>` — Approve/Deny card.
- `ctx.screenshot()` → `Promise<{ok, dataUrl?, annotated?}>` — composite the live surface (canvas + the user's drawing).
- `ctx.emit(event)` — push a `TurnEvent` out-of-band (used by runtimes whose presentation arrives on a side channel — see below).
- `ctx.sessionId`, `ctx.mode`, `ctx.principal`, `ctx.signal` (aborted on cancel/disconnect).
- `ctx.sideChannel` — `{ baseUrl, token, session }` for runtimes that present out-of-band.

## Pattern A — in-process (echo)

The whole turn runs in-process; `run()` yields events directly. No subprocess, no
side channel. See `src/adapters/echo.mjs`:

```js
async *run({ prompt, ctx }) {
  yield { kind: "session_started", id: ctx.sessionId || mintId() };
  yield { kind: "patch", ops: [{ op: "mount", id: "answer", component: "hero", props: { value: prompt } }] };
  yield { kind: "turn_done", code: 0 };
}
```

## Pattern B — subprocess + side channel (claude-code)

Some runtimes (Claude Code) present **out-of-band**: the agent calls tools that
relay presentation to Surface, while the process's stdout only carries
session/tool/usage metadata. The adapter:

1. Spawns the CLI (resolve the binary first — G1; agent CLIs are shell aliases).
2. Parses stdout NDJSON line-buffered across chunks (G4; use `readNdjson` from the adapter SDK), mapping to `session_started` / `tool_call` / `usage` / `turn_done`.
3. Routes presentation + decisions through a **loopback side channel**: the kernel
   exposes token-scoped `/mcp/*` endpoints (`ctx.sideChannel`); the runtime's
   plugin (here, an MCP server) POSTs `patch`/`ask`/`permission`/`screenshot` to
   them. The kernel funnels those into the same `ctx.emit` / `ctx.ask` machinery,
   so an out-of-band patch is indistinguishable from a yielded one.

Gotchas baked in: both `--include-partial-messages` **and** `--verbose` (G2);
route tool-permission prompts through `ask` so a headless turn never silently
hangs and surface stderr (G3); capture `session_id` once and thread resume (G11).

Keep the stdout→event mapping a **pure function** (`mapClaudeEvent`) so it is
unit-testable without spawning the real binary — the adapter-contract conformance
suite depends on that.

## Capabilities (lights up affordances; graceful degradation)

```js
capabilities: {
  protocolVersion: 1,
  presentation: "presenter" | "mcp" | "sentinel", // how presentation is delivered
  resume: true,                                    // can thread session continuity
  turnBoundary: "iterator-return" | "result-event" | "process-exit",
  permissionPrompt: true,                          // routes tool prompts back to the surface
  namespaces: ["claude.subagents"],                // opt-in extension namespaces
  orgTier: "A" | "B" | "C",                        // A native fabric · B session orchestration · C single agent
}
```

The kernel sends `capabilities` to the browser on connect; richer affordances
(org mode, delegation tree) light up by tier as later milestones land. A Tier C
adapter (echo) simply runs the single-agent console with org features dark.

## Registering an adapter

```js
import { createSurface } from "@selfworking-ai/surface";
import { myAdapter } from "./my-adapter.mjs";
createSurface({ adapter: myAdapter() }).listen();
```

Or point `surface.config.js` at it and run `npx surface dev`:

```js
// surface.config.js
import { myAdapter } from "./my-adapter.mjs";
export default { adapter: myAdapter(), port: 5757 };
```

## Conformance

A reusable adapter-contract suite (every adapter must satisfy it) is the goal:
session-started-once, a turn that ends with `turn_done`, NDJSON robustness across
split chunks, and the capability→affordance mapping. Add your adapter to it so
runtime swaps stay zero-kernel-change.
