# Multi-runtime

Surface drives agent runtimes through a single seam — the **adapter**. Surface owns
the surface (the dock, the retained-mode canvas, the protocol, the security model);
the adapter borrows the runtime's brain (its agent logic, memory, orchestration) and
translates its native stream into canonical **TurnEvents**. The thesis of this whole
project lives here:

> **Swap the runtime, change nothing in the kernel.**

The console you talk to does not know — and must not need to know — whether it's
driving a toy echo loop, the Claude Code CLI, or a self-organizing agent fabric. It
knows the protocol. The adapter knows the runtime. That's the entire contract.

## Capability tiers

An adapter declares what its runtime can do via `capabilities`. The headline field is
`orgTier`, a coarse three-rung ladder of *organizational* capability:

| Tier | Name | What the runtime is | Shipped adapter |
|---|---|---|---|
| **C** | single agent | one agent, one turn at a time; no internal org | `src/adapters/echo.mjs` |
| **B** | session orchestration | one agent that can fan out to sub-agents *within a turn* | `src/adapters/claude-code.mjs` |
| **A** | native fabric | a standing organization of agents (router → coordinators → workers) | `src/adapters/orgmock.mjs` |

The tier is paired with a `namespaces` list — the specific org capabilities the
runtime supports:

- **echo (C)** — `namespaces: []`, `orgTier: "C"`. The minimal in-process example.
  No org; it paints a hero and echoes. The floor of the contract.
- **claude-code (B)** — `namespaces: ["claude.subagents"]`, `orgTier: "B"`. The real
  subprocess adapter: the Claude CLI can spawn sub-agents inside a turn, but there's
  no *persistent* org to project. Presentation comes over the MCP side channel, not
  stdout.
- **orgmock (A)** — `namespaces: ["org.graph", "agent.spawn", "agent.message",
  "agent.inbox", "schedule"]`, `orgTier: "A"`. The native-fabric reference: a standing
  org it projects as `org.graph` + `agent.inbox` each turn.

Tiers are about *organizational shape*, not raw power. A Tier-C runtime can be a
frontier model; it's "C" because there's no org to surface, not because it's weak.

## orgmock — the agnosticism proof

The point of `orgmock` is not that it's a useful fabric (it's an in-process fixture).
The point is that it **proves the thesis is real**, not aspirational. It is a *second*
adapter, written after the kernel was done, that:

1. advertises **Tier A** + the `standard` org namespaces, and
2. streams `org.graph` + `agent.inbox` **projections** and routes a `talk to <id>`
   prompt,

…and it lights up full **org mode** (the org chart, the inbox, the talk-to-any-node
gesture — see `docs/org-mode.md`) through the **exact same kernel that runs echo**.
Zero kernel change. Zero bespoke UI. The kernel relays orgmock's projections byte for
byte; generic client renderers (keyed by namespace) paint them. The `test/org.test.mjs`
e2e test asserts this end to end: boot a Surface on `orgmock`, and the `org.graph`
projection arrives over the wire with its nodes intact.

If adding a runtime of a higher organizational tier required editing the kernel, the
seam would be a lie. orgmock is the regression test against that.

## Authoring an adapter

An adapter is `name` + `capabilities` + an `async *run({ prompt, ctx })` generator
that yields TurnEvents until `{ kind: "turn_done" }`. Two references ship: `echo.mjs`
(in-process, minimal) and `claude-code.mjs` (subprocess + MCP side channel, the real
one). To make a new runtime org-aware, advertise `orgTier: "A"` + the org namespaces
and yield `{ kind: "projection", namespace: "org.graph", data: { nodes } }` (and
`agent.inbox`) from `run()`. The full contract and a step-by-step guide are in
**`docs/authoring-adapters.md`** (`src/adapter-sdk/adapter.d.ts` is the typed source).

## The identity / authority handshake

Multi-runtime cuts across a trust boundary: Surface runs locally and authenticates the
**human**; the runtime may spawn a tree of agents that act on that human's behalf. The
handshake (`src/kernel/identity.mjs`) is deliberately one-directional:

- **Surface sets the ceiling.** It authenticates the human principal and computes
  their **authority ceiling** — "this human may grant *up to* X." It mints an opaque
  capability token carrying that principal + ceiling and passes it into the runtime on
  every turn (`ctx.principal`, `ctx.capabilityToken`).
- **The runtime attenuates.** Within its own agent tree the runtime may only grant
  *less* than the ceiling — never more. Surface does not police each sub-agent; it
  sets the maximum and trusts the runtime to attenuate downward, while every runtime
  action carries Surface's principal token to the audit sink (M4).

So authority flows **down** from Surface's ceiling, never up from the runtime. A
Tier-A fabric with a hundred agents still operates under the single ceiling Surface
granted at the top of the turn — the same property whether the runtime is echo,
Claude Code, or a native fabric. (The v1 capability token is integrity-by-obscurity —
i.e. none; signing is an M4 concern. See `docs/security-model.md`.)
