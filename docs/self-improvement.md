# Self-improvement — the signal, the gate, and the honest line

Surface can get better at painting *over time* — but only along a path that is
deterministic and operator-gated end to end. The principle, taken straight from the
build plan:

> **The signal is the hard part — design it first or it's theater.**

So Surface captures **real, observed signals**, the gardener and smith **propose and
validate**, and the actual **generation** of new component code is the console agent's
job — never auto-applied, never silently promoted. This page is the honest model of
what is real (the loop, the signals, the validation, the gate) and what is *not* magic
(the generation step and the promotion decision).

The pieces live in [`src/kernel/gardener.mjs`](../src/kernel/gardener.mjs),
[`src/kernel/smith.mjs`](../src/kernel/smith.mjs),
[`src/providers/signals-file.mjs`](../src/providers/signals-file.mjs), and the kernel's
signal-emission paths in [`src/kernel/server.mjs`](../src/kernel/server.mjs).

## The loop

A single, four-stage loop, each stage owned by a different, named piece:

```
emit ──▶ observe ──▶ critique ──▶ revise ──▶ re-validate ──▶ register a NEW version
(kernel   (Signal     (gardener:   (console     (smith:          (registry: a new
 + client) Sink)       proposals)   agent)        validate)        version, gated)
```

1. **Emit.** The kernel and the client emit a signal whenever something real happens
   to a component on the canvas (below).
2. **Observe.** A **SignalSink** records each signal durably (file) or discards it
   (noop, the default) — fire-and-forget, never blocking a turn.
3. **Critique.** The **gardener** aggregates recorded signals per component and
   returns a **gated proposal list** — which components need a revision, ranked by
   need. It mutates nothing.
4. **Revise.** The **console agent** (the orchestrator) generates the revised
   component's code. *This is the only non-deterministic step, and it is agent-driven.*
5. **Re-validate.** The **smith** validates the proposed component (manifest shape +
   token-only styles) **before** it is registered — the gate that keeps runtime
   generation survivable.
6. **Register a new version.** The registry registers a **new version**; it never
   mutates a live mount. Which version a mount uses is a separate, operator-gated
   promotion decision.

Nothing in stages 4–6 is automatic. Stages 1–3 and 5 are deterministic and tested
(see [`test/self-improvement.test.mjs`](../test/self-improvement.test.mjs)).

## The signals — real observations, not vibes

Each signal is a genuine thing that happened on the canvas, not a heuristic guess. The
kernel emits the first two; the client emits the rest over
`{type:"event", name:"signal", data}`:

| Signal | What it means | Emitted by | Weight |
|--------|---------------|------------|-------:|
| `render-error` | A patch op was rejected — a component or its props failed to render. | kernel (a rejected reconcile op) | 5 |
| `unknown-component` | The agent mounted a name the client had to fall back on (no registered component). | client (fallback mount) | 4 |
| `markup` | A user drew freehand over a component — confusion, or interest worth reviewing. | client | 2 |
| `dismiss` | A component was removed quickly — low utility. | client (short lifetime on remove) | 1 |
| `dwell` | A component stayed on screen a while — **healthy**; this *credits* the component (reduces its need), it does not add to it. | client (long lifetime on remove) | credit |

The weights are the gardener's, in [`src/kernel/gardener.mjs`](../src/kernel/gardener.mjs).
A `render-error` is the loudest because it is unambiguous — the reconciler literally
could not apply the op. `dwell` is the only *positive* signal: long dwell offsets
noise, so a component people keep on screen is never proposed for revision on dwell
alone.

The kernel's emission path is small and load-bearing: a rejected reconcile op becomes
a `render-error` (`server.mjs`, the `patch` case), and a client `signal` event is
relayed to the sink verbatim (the `event` branch). Both go through one
`signalRecord(kind, component, data)` helper — fire-and-forget, swallowing errors, so
a misbehaving sink can never break a turn.

## The SignalSink — observe without coupling

A **SignalSink** is one method: `record({ kind, component, ts, data })`, async, and it
**must never throw**. Three ship, mirroring the AuditSink trio
([`src/providers/signals-file.mjs`](../src/providers/signals-file.mjs)):

- **`fileSignalSink({ dir })`** — append one JSON line per signal to
  `<dir>/signals.jsonl`. `readSignals(dir)` reads them back — this is the gardener's
  input.
- **`consoleSignalSink()`** — a one-line `[signal] <ts> <kind> <component>` to stderr,
  for dev.
- **`noopSignalSink()`** — discards. This is the **kernel default**: Surface emits
  signals regardless, but a host opts *in* to a durable sink. No sink, no theater.

A host wires one through `createSurface({ providers: { signals } })`; the structural
validator is `validateSignalSink` in
[`src/provider-sdk/index.mjs`](../src/provider-sdk/index.mjs).

## The gardener — gated review, never auto-apply

`reviewSignals(records, { minScore = 3 })` aggregates the recorded signals by
component, sums their weights (crediting `dwell` down), and returns a **sorted,
gated** proposal list — highest need first. Each proposal is:

```js
{ component, score, signals, reason, action: "propose-revision" }
```

The `action` is always `"propose-revision"` — a proposal, **never** an auto-apply. A
component below `minScore` (e.g. one with only a single `dismiss`, or only healthy
`dwell`) is simply not proposed. The gardener reads signals and proposes; it mutates
nothing. Promotion is somebody else's gated decision.

## The component-smith — compose-first, validate-before-register

Most needs are met by **arranging registered components** — cheap, deterministic,
safe. Authoring a *new* component is the rare path. The smith
([`src/kernel/smith.mjs`](../src/kernel/smith.mjs)) is the search + the safety gate
around that path, the deterministic part — *not* the generative one:

- **`findComponent(need, registry)`** — **compose-first.** Match by name, else by
  required capabilities, else `null`. A `null` is the signal to fall through to the
  rare authoring path; it is not a failure.
- **`validateProposedComponent(spec)`** — the gate. Checks the manifest shape **and**
  enforces **token-only styles** (no hardcoded colors/radii — only `:root` glass
  tokens) **before** the component is ever registered. The registry enforces the same
  at `register()`; the smith checks first so a bad proposal is rejected before it
  reaches the catalog.
- **`nextVersion(version)`** — bumps the patch. The smith only ever yields a **new
  version**; it never mutates a live mount. Which version a mount actually uses is the
  gated promotion decision, made elsewhere.

The **generation** of the new component's code is explicitly *not* the smith's job —
that is the console agent's (a subagent it spawns). The smith is the part that must be
deterministic and trustworthy.

## Agent topology

- **Orchestrator** — the **console agent**. It runs the turn, and when a proposal
  warrants a new component, *it* generates the code (compose-first; generate only as a
  fallback) and routes it through the smith's validation.
- **Smith** — a subagent. The compose-first search and the validate-before-register
  gate.
- **Gardener** — a subagent. The signal-gated review that surfaces *which* components
  to revise.

The orchestrator owns the only generative step; the subagents own the deterministic
search, review, and validation around it.

## The candid caveat

Be precise about what Surface ships here, because the difference is the whole point:

- **Real and deterministic:** the four-stage loop, the signals (genuine observations,
  not vibes), the gardener's gated review, and the smith's validate-before-register
  gate. All tested.
- **Agent-driven, not deterministic:** the **generation** of revised component code.
  That is the console agent's job, and it is as good (or as fallible) as the agent.
- **Operator-gated, not automatic:** the **promotion** of a new version onto a live
  mount. A human (or an explicitly authorized agent) decides; nothing self-promotes.

So: **Surface ships the signal and the gate — not auto-magic.** The system can *notice*
that a component is failing or being ignored, can *propose* a revision, and can *refuse*
to register anything off-system. It cannot, and does not, silently rewrite the canvas
under you. That restraint is the design, not a limitation to be removed later.
