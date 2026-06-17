// Pure, DOM-free core of the client reconciler + the live/time-travel state
// machine. Extracted from kernel.js so it can be unit-tested under plain node
// (no document/window/customElements). This is the `token-validator.mjs`
// pattern: a pure module both the browser kernel and `node:test` import — so the
// op SEMANTICS + the SX-2 live-flag logic can't drift untested.
//
// CRITICAL: kernel.js CONSUMES this module for ALL state bookkeeping (what's in
// `nodes`, what `layout` becomes, the live/viewIndex transitions). The DOM work
// (createElement, appendChild/replaceChild/remove, el.props=, classList, signals)
// stays in kernel.js — `applyOp` RETURNS a descriptor telling the kernel what DOM
// action to take, but the state decision itself lives here.
//
// Op semantics — IDENTICAL to the server reconciler (`src/kernel/reconciler.mjs`):
//   mount  = UPSERT       — create the node, or replace an existing one (same id).
//   update = SHALLOW-MERGE — merge props into an existing node.
//   remove = DELETE       — drop the node.
//   layout = MERGE        — shallow-merge the spec into the layout.
//
// Divergence from the server (audit finding #6, made EXPLICIT here): an `update`
// or `remove` of an UNKNOWN id is a CLIENT no-op (action "noop"), NOT a rejection.
// The server rejects (the agent should not patch a node it never mounted); the
// client silently ignores so a stray op can't blank the canvas. A test asserts
// this by reading the returned `action`.

// ── Canvas-state model ──────────────────────────────────────────────────────

/**
 * A fresh canvas state: the live composition.
 * `nodes` is id → { component, props, slot, at } (the STATE only — kernel.js
 * stores the matching DOM `el`/`mountedAt` on its own node records, or wraps
 * these). `layout` is the merged layout spec.
 * @returns {{ nodes: Map<string, {component:string, props:object, slot:any, at:any}>, layout: {columns?: number} }}
 */
export function createCanvasState() {
  return { nodes: new Map(), layout: { columns: 4 } };
}

function isObj(x) { return x && typeof x === "object"; }

/**
 * Apply ONE patch op to the canvas state, purely (mutates `state.nodes` /
 * `state.layout`, returns a descriptor of the DOM action to perform). The kernel
 * reads `action` to drive the DOM; the state is already updated on return.
 *
 * Return shapes (discriminated by `action`):
 *   mount  → { action:"mount",  id, component, props, slot, at, replaced:boolean }
 *            `replaced` is true when an existing id was upserted (swap in place),
 *            false when it's a first mount (rise in).
 *   update → { action:"update", id, component, props }   (props = the MERGED props)
 *   remove → { action:"remove", id, component, mountedFor?:number } | { action:"noop", reason }
 *            (`mountedFor` is only known to the kernel; the core leaves it absent)
 *   layout → { action:"layout", layout, columns }        (layout = the MERGED spec)
 *   unknown id update/remove → { action:"noop", reason:"update-unknown-id" | "remove-unknown-id" }
 *   malformed op → { action:"noop", reason:"invalid" }
 *
 * @param {{nodes: Map, layout: object}} state
 * @param {{op:string, id?:string, component?:string, props?:object, slot?:any, at?:any, spec?:object}} op
 * @returns {{action:string, [k:string]:any}}
 */
export function applyOp(state, op) {
  if (!isObj(op)) return { action: "noop", reason: "invalid" };
  switch (op.op) {
    case "mount":   return opMount(state, op);
    case "update":  return opUpdate(state, op);
    case "remove":  return opRemove(state, op);
    case "layout":  return opLayout(state, op);
    default:        return { action: "noop", reason: "invalid" };
  }
}

function opMount(state, { id, component, props, slot, at }) {
  if (!id || !component) return { action: "noop", reason: "invalid" };
  const replaced = state.nodes.has(id);
  const stored = isObj(props) ? { ...props } : {};
  // UPSERT: create or fully replace. Props REPLACE (use `update` to merge) —
  // matches the server reconciler's mount.
  state.nodes.set(id, { component, props: stored, slot: slot ?? null, at: at ?? null });
  return { action: "mount", id, component, props: stored, slot: slot ?? null, at: at ?? null, replaced };
}

function opUpdate(state, { id, props }) {
  const node = state.nodes.get(id);
  if (!node) return { action: "noop", reason: "update-unknown-id" };   // CLIENT divergence: ignore (server rejects)
  // SHALLOW-MERGE props onto the existing node — no mount-rise replay.
  node.props = { ...node.props, ...(isObj(props) ? props : {}) };
  return { action: "update", id, component: node.component, props: node.props };
}

function opRemove(state, { id }) {
  const node = state.nodes.get(id);
  if (!node) return { action: "noop", reason: "remove-unknown-id" };   // CLIENT divergence: ignore (server rejects)
  const component = node.component;
  state.nodes.delete(id);
  return { action: "remove", id, component };
}

function opLayout(state, { spec }) {
  if (!isObj(spec)) return { action: "noop", reason: "invalid" };
  state.layout = { ...state.layout, ...spec };
  return { action: "layout", layout: state.layout, columns: state.layout.columns };
}

/**
 * Apply a list of ops, purely. Returns the per-op action descriptors (same order,
 * including "noop" entries) so the kernel can drive the DOM one op at a time.
 * @param {{nodes: Map, layout: object}} state
 * @param {object[]} ops
 * @returns {{action:string, [k:string]:any}[]}
 */
export function applyOps(state, ops) {
  if (!Array.isArray(ops)) return [];
  return ops.map((op) => applyOp(state, op));
}

// ── Live / time-travel state machine ─────────────────────────────────────────
//
// SX-2 (the #1 lesson): "at now" is an EXPLICIT `live` boolean, NEVER derived
// from `viewIndex >= frames.length - 1`. A live patch lands BEFORE its
// frame-commit grows `frames`, so a derived check reads STALE in that window and
// would snap the view into the past on the very next /api/history refresh.
//
// The transitions below keep `live` explicit. The ONE place `live` is computed
// from the index is `gotoFrame`/`recallFrame` — and that is NOT the SX-2 trap:
// it's the user/agent EXPLICITLY scrubbing to a frame, where landing on the last
// tick legitimately means "you scrubbed back to now". The forbidden derivation is
// reading at-now from the index during a live PATCH window; that path is `live =
// true` set immediately (enterLive), independent of `frames.length`.

/**
 * A fresh view state. `live` is the explicit at-now flag; `viewIndex` is the
 * frame on screen (-1 = none yet); `frames` is the committed-turn log.
 * @returns {{ live: boolean, viewIndex: number, frames: any[] }}
 */
export function createViewState() {
  return { live: true, viewIndex: -1, frames: [] };
}

/** The at-now predicate — the ONLY source of "are we live" (SX-2). */
export function atNow(view) { return view.live === true; }

/**
 * A new live event (patch / render / scene) IS the present: go live and pin the
 * view to the last frame. Set IMMEDIATELY, before any frame-commit grows
 * `frames` — this is why `live` is explicit and not index-derived (SX-2).
 * @param {{live:boolean, viewIndex:number, frames:any[]}} view
 */
export function enterLive(view) {
  view.live = true;
  view.viewIndex = view.frames.length - 1;
  return view;
}

/**
 * Adopt a refreshed frames log (from /api/history). Only advances `viewIndex` to
 * the new right edge WHEN we're at-now — a scrubbed-back view stays put. Never
 * touches `live` (SX-2: history refresh must not change at-now-ness).
 * @param {{live:boolean, viewIndex:number, frames:any[]}} view
 * @param {any[]} frames
 */
export function setFrames(view, frames) {
  view.frames = Array.isArray(frames) ? frames : [];
  if (atNow(view)) view.viewIndex = view.frames.length - 1;
  return view;
}

/**
 * Scrub to frame `i` (clamped). Landing on the last tick === live (the user
 * explicitly dragged to now). Not the SX-2 trap (see header) — this is an
 * EXPLICIT scrub, not a passive at-now read during a patch window.
 * @param {{live:boolean, viewIndex:number, frames:any[]}} view
 * @param {number} i
 */
export function gotoFrame(view, i) {
  if (!view.frames.length) return view;
  view.viewIndex = Math.max(0, Math.min(i, view.frames.length - 1));
  view.live = view.viewIndex >= view.frames.length - 1;
  return view;
}

/** Return to the present: live + pin to the last frame. */
export function returnToNow(view) {
  view.live = true;
  view.viewIndex = view.frames.length - 1;
  return view;
}

/**
 * Agent-driven recall — re-surface the frame whose `n` matches (read-only
 * look-back). Returns whether a matching frame was found; on a hit it moves
 * `viewIndex` and recomputes `live` (last tick === live, same rule as gotoFrame).
 * @param {{live:boolean, viewIndex:number, frames:any[]}} view
 * @param {number} n the frame number to recall
 * @returns {boolean} true if a frame with that `n` existed
 */
export function recallFrame(view, n) {
  const idx = view.frames.findIndex((f) => f && f.n === n);
  if (idx < 0) return false;
  view.viewIndex = idx;
  view.live = idx >= view.frames.length - 1;
  return true;
}
