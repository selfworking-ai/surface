# ADR 0001 — Adapter shape: `run()` async-iterator over `spawn()`/`parseStream()`

- **Status:** Accepted
- **Date:** 2026-06-17
- **Context milestone:** informs M2 (Adapter SDK + first real adapter); contract defined in
  M1 (`src/adapter-sdk/adapter.d.ts`).

## Context

The `AgentAdapter` is the **borrowed-fabric seam** — the single interface a runtime
implements so Surface can drive it. It must translate a runtime's native event stream into
canonical `TurnEvent`s, declare what the runtime can do via `Capabilities`, and carry the
bidirectional side channels a console needs (decision cards, permission prompts,
screenshots).

The [build plan](../../README.md) sketched a subprocess-shaped adapter, inherited from the
`body` prototype:

```ts
interface AgentAdapter {
  spawn(prompt, sessionId, ctx): ChildProcess;
  parseStream(stdout: Readable): AsyncIterable<TurnEvent>;
  resolveBin(): Promise<string>;
  resume: { flag: string; idFrom: string } | null;
}
```

That shape bakes in two assumptions: that a turn is **a child process**, and that its
output is **a readable stdout stream**. But Surface's whole thesis is *runtime-agnostic* —
"it owns the surface and borrows the fabric from **whatever** agent runtime is plugged in."
Not every runtime is a subprocess: some are an HTTP/SSE service, some are in-process (the
M1 echo adapter is — no subprocess, no stdout), some are remote. A `spawn(): ChildProcess`
signature can't express those, and `parseStream(stdout)` assumes a stream that may not
exist. It also leaves the side channels (`ask`, permission, screenshot) unspecified, even
though they're essential and can't be modeled as a one-way event stream — they need a
*response*.

## Decision

Refine the adapter to a single **runtime-agnostic** entry point:

```ts
interface AgentAdapter {
  name: string;
  capabilities: Capabilities;
  run(input: { prompt: string; ctx: TurnContext }): AsyncIterable<TurnEvent>;
  init?(): Promise<void>;          // optional one-time setup
  resolveBin?(): Promise<string>;  // optional (subprocess runtimes only, gotcha G1)
}
```

- **`run({ prompt, ctx })`** drives exactly one turn and yields canonical `TurnEvent`s
  until `turn_done`. *How* it produces those events is the adapter's private business:
  - a **subprocess** adapter spawns the CLI and parses its stdout internally, using the
    SDK helpers `resolveBin` (G1: resolve the binary, since CLIs are often shell aliases)
    and `ndjson` (G4: line-buffer NDJSON across stdout chunks);
  - an **in-process** adapter (echo) just `yield`s events directly;
  - an **HTTP/remote** adapter awaits its transport and yields as data arrives.
- **`TurnContext`** carries the bidirectional side channels that a plain event stream
  can't express, because they require a response that blocks the turn:
  - `ask(question, options, context?) → Promise<AskAnswer>` — surface a decision card;
  - `requestPermission(tool, input) → Promise<PermissionDecision>` — Approve/Deny card;
  - `screenshot() → Promise<ScreenshotResult>` — composite of the live surface + markup;
  - plus `emit(event)` (push an out-of-band `TurnEvent`, e.g. from an MCP callback),
    `sessionId`, `mode`, `principal`, and an `AbortSignal` (`signal`).
- Adapters export a `(opts) => AgentAdapter` **factory** (`AdapterFactory`), matching the
  `echoAdapter()` / `claudeCodeAdapter()` call sites.

`resolveBin` survives as an **optional** method (subprocess adapters need G1; in-process
ones don't). The `resume` descriptor from the plan is no longer part of the interface:
session continuity is expressed by the adapter handling `ctx.sessionId` and emitting
`session_started`, with the browser owning identity (G11/G12).

## Consequences

**Positive**

- The interface matches the thesis: a subprocess, an in-process loop, and a remote service
  all implement the *same* `run()` — Surface needs zero special cases per transport.
- The side channels are first-class and typed, so headless turns never silently hang
  (gotcha G3) — `ask`/`requestPermission` block visibly on a card.
- The M1 echo adapter is a faithful, minimal reference (`name` + `capabilities` + an
  async-generator `run`), which keeps the kernel honestly runtime-independent from day one.
- A reusable adapter-contract conformance suite (M2) can drive any adapter purely through
  `run()` + a mock `TurnContext`.

**Negative / costs**

- Subprocess adapters carry slightly more internal machinery (they own their own
  spawn+parse with the SDK helpers) instead of getting it from the framework. We accept
  this: it's encapsulated, and the SDK helpers (`resolve-bin`, `ndjson`) do the heavy
  lifting.
- `AsyncIterable` is the contract, so an adapter that wants to *push* events (callback-style
  side channels) uses `ctx.emit()` to bridge into the iterator — a small adapter-side
  pattern rather than a framework concern.

## References

- Contract: [`src/adapter-sdk/adapter.d.ts`](../../src/adapter-sdk/adapter.d.ts)
- Reference adapter: [`src/adapters/echo.mjs`](../../src/adapters/echo.mjs)
- Related: [ADR 0002 — retained-mode canvas](0002-retained-mode-canvas.md)
