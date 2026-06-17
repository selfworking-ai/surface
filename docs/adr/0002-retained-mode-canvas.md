# ADR 0002 — Retained-mode canvas over immediate-mode `render(html)`

- **Status:** Accepted
- **Date:** 2026-06-17
- **Context milestone:** M1 (kernel core). Contracts in
  `src/protocol/surface-protocol.d.ts`; reconciler in `src/kernel/reconciler.mjs`.

## Context

The `body` prototype was **immediate-mode**: each turn the agent called `render(html)`,
which replaced the entire canvas with a freshly generated HTML fragment. That is simple and
worked for a single-agent dashboard, but it has structural costs that block Surface's goals:

- **The agent regenerates the whole surface every turn.** Even to nudge one number it must
  re-emit the full dashboard — expensive (it's all generation) and visually jarring (the
  page repaints wholesale).
- **There is no durable composition.** The "current state of the canvas" exists only as the
  last HTML blob. There's nothing to *bind* a live data source to, nothing to address by
  id, nothing for components to subscribe to.
- **Time-travel stores opaque blobs.** History is a list of HTML strings; you can replay a
  past frame but you can't reason about *what* is on the canvas.

Surface wants a **composable, persistent, living** canvas where most turns *arrange
registered components* (cheap, deterministic) and authoring a new component is the rare,
gated path — and where components are isolated but flexible (publish/subscribe through a
broker). Immediate-mode HTML can't provide that.

## Decision

Make the canvas **retained-mode**: the agent **patches** a persistent canvas instead of
repainting it.

- **Patch vocabulary** (`PatchOp`): `mount` / `update` / `remove` / `layout`, with fixed
  semantics — `mount` = upsert, `update` = shallow-merge, `remove` = delete, `layout` =
  merge.
- **Two distinct stores:**
  - the **workspace document** — the durable composition (which components, where, bound to
    what data); and
  - the **frames log** — turn history for time-travel (kept from `body`).
- **Two reconcilers, identical semantics:** a pure server-side reconciler
  (`reconciler.mjs`) maintains the authoritative workspace document; a tiny vanilla DOM
  reconciler on the client applies the same ops to the page. Keyed by component `id`, they
  agree op-for-op — that agreement is the load-bearing invariant.
- **Self-contained per-turn snapshots for time-travel.** A retained-mode frame stores a
  self-contained `WorkspaceSnapshot` of the workspace *after* the turn, so `recall`/seek can
  rebuild the canvas at turn N directly — **without** folding the entire op history forward.
  (v1 `html` and v2 `scene` frames are stored on the same `Frame` shape for those escape
  hatches.)
- **Keep `render(html)` as a v1 escape hatch.** Immediate-mode survives for the cases where
  a one-off bespoke fragment is genuinely the right tool; it just stops being the *only*
  tool. The `scene` spec (v2) rides alongside it.

## Consequences

**Positive**

- Most turns become **cheap, deterministic composition** (mount/update a registered
  component) rather than full generation — directly enabling "compose ≠ generate".
- The workspace document is a real, addressable model: components have stable ids,
  data-binding through the broker becomes possible, and the UI can be *living* (a source
  pushes a topic; a bound tile updates in place).
- Updates patch in place — no wholesale repaint — so the surface stays calm and glanceable.
- Time-travel reasons over structured snapshots, and because each frame is self-contained
  the server stays logically stateless (any instance serves any session from the store).

**Negative / costs**

- **Two reconcilers must not drift.** Their identical op semantics are an invariant we have
  to *test* (the reconciler diff/apply suite), not assume. This is deliberate and pinned.
- A **workspace document distinct from the frames log** is more moving parts than a single
  blob list — but the separation is exactly what buys composability and clean time-travel.
- Adapters/agents must think in patches, not in "print the whole page." The `render(html)`
  escape hatch softens the transition, and the echo adapter demonstrates the patch idiom
  (mount on turn 1, update thereafter) as the canonical example.

## References

- Protocol types: [`src/protocol/surface-protocol.d.ts`](../../src/protocol/surface-protocol.d.ts)
- Codec + op validation: [`src/protocol/messages.mjs`](../../src/protocol/messages.mjs)
- Frame / snapshot shapes: [`src/provider-sdk/ports.d.ts`](../../src/provider-sdk/ports.d.ts)
- Related: [ADR 0001 — adapter run-iterator](0001-adapter-run-iterator.md)
