// Pure client reconciler core + the SX-2 live/time-travel state machine.
// Mirrors `reconciler.test.mjs` (server, pure) on the op SEMANTICS, and pins the
// two things only this module can prove:
//   1. PARITY — client `applyOp` and server `reconcile` AGREE on the resulting
//      node set + layout for the same op stream (the contract both implement).
//   2. The DOCUMENTED divergence (audit finding #6, made an asserted contract):
//      a client update/remove of an UNKNOWN id is a no-op; the server REJECTS.
//   3. SX-2 — at-now is an EXPLICIT `live` flag, never index-derived; a live patch
//      landing before its frame-commit must NOT snap the view into the past.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCanvasState, applyOp, applyOps,
  createViewState, atNow, enterLive, setFrames, gotoFrame, returnToNow, recallFrame,
} from "../client/reconciler-core.mjs";
import { reconcile, emptyDoc } from "../src/kernel/reconciler.mjs";

// ── createCanvasState ──────────────────────────────────────────────────────────

test("createCanvasState is an empty node map with a default 4-col layout", () => {
  const s = createCanvasState();
  assert.ok(s.nodes instanceof Map);
  assert.equal(s.nodes.size, 0);
  assert.equal(s.layout.columns, 4);
});

// ── mount (UPSERT — props REPLACE) ──────────────────────────────────────────────

test("mount creates a node and reports a first-mount (replaced=false)", () => {
  const s = createCanvasState();
  const d = applyOp(s, { op: "mount", id: "a", component: "metric", props: { value: "1" } });
  assert.equal(d.action, "mount");
  assert.equal(d.id, "a");
  assert.equal(d.component, "metric");
  assert.deepEqual(d.props, { value: "1" });
  assert.equal(d.slot, null);
  assert.equal(d.at, null);
  assert.equal(d.replaced, false);
  assert.equal(s.nodes.get("a").props.value, "1");
});

test("mount carries through slot + at", () => {
  const s = createCanvasState();
  const d = applyOp(s, { op: "mount", id: "a", component: "metric", props: {}, slot: "hero", at: 3 });
  assert.equal(d.slot, "hero");
  assert.equal(d.at, 3);
  assert.equal(s.nodes.get("a").slot, "hero");
  assert.equal(s.nodes.get("a").at, 3);
});

test("mount on an existing id is an UPSERT — props REPLACE wholesale, replaced flips true", () => {
  const s = createCanvasState();
  applyOp(s, { op: "mount", id: "a", component: "metric", props: { value: "1", label: "L" } });
  const d = applyOp(s, { op: "mount", id: "a", component: "metric", props: { value: "2" } });
  assert.equal(d.replaced, true, "2nd mount of same id is a replace");
  assert.equal(s.nodes.get("a").props.value, "2");
  assert.equal(s.nodes.get("a").props.label, undefined, "upsert REPLACES props, does not merge");
});

test("mount stores a COPY of props (caller mutation doesn't leak into state)", () => {
  const s = createCanvasState();
  const props = { value: "1" };
  applyOp(s, { op: "mount", id: "a", component: "metric", props });
  props.value = "mutated";
  assert.equal(s.nodes.get("a").props.value, "1", "stored props are a snapshot, not the live ref");
});

test("mount with non-object props stores {}", () => {
  const s = createCanvasState();
  const d = applyOp(s, { op: "mount", id: "a", component: "metric", props: "nope" });
  assert.deepEqual(d.props, {});
  assert.deepEqual(s.nodes.get("a").props, {});
});

// ── update (SHALLOW-MERGE) ──────────────────────────────────────────────────────

test("update shallow-merges props — untouched keys kept, overlapping keys overridden", () => {
  const s = createCanvasState();
  applyOp(s, { op: "mount", id: "a", component: "metric", props: { value: "1", label: "L" } });
  const d = applyOp(s, { op: "update", id: "a", props: { value: "9", extra: "x" } });
  assert.equal(d.action, "update");
  assert.equal(d.id, "a");
  assert.equal(d.component, "metric", "component comes from the existing node, not the op");
  assert.deepEqual(d.props, { value: "9", label: "L", extra: "x" });
  assert.equal(s.nodes.get("a").props.label, "L", "update keeps untouched props");
});

test("update with non-object props merges nothing (keeps existing)", () => {
  const s = createCanvasState();
  applyOp(s, { op: "mount", id: "a", component: "metric", props: { value: "1" } });
  const d = applyOp(s, { op: "update", id: "a", props: 42 });
  assert.deepEqual(d.props, { value: "1" });
});

// ── remove (DELETE) ─────────────────────────────────────────────────────────────

test("remove deletes the node and returns its component", () => {
  const s = createCanvasState();
  applyOp(s, { op: "mount", id: "a", component: "list", props: {} });
  const d = applyOp(s, { op: "remove", id: "a" });
  assert.equal(d.action, "remove");
  assert.equal(d.id, "a");
  assert.equal(d.component, "list", "removed component name is reported");
  assert.equal(s.nodes.has("a"), false);
});

// ── layout (MERGE) ──────────────────────────────────────────────────────────────

test("layout shallow-merges the spec — columns + an extra key both retained", () => {
  const s = createCanvasState();
  const d = applyOp(s, { op: "layout", spec: { columns: 6, gap: "lg" } });
  assert.equal(d.action, "layout");
  assert.equal(d.columns, 6);
  assert.deepEqual(d.layout, { columns: 6, gap: "lg" });
  // a 2nd layout merges onto the first — columns updated, gap retained
  const d2 = applyOp(s, { op: "layout", spec: { columns: 2 } });
  assert.equal(d2.columns, 2);
  assert.deepEqual(d2.layout, { columns: 2, gap: "lg" }, "prior keys survive a partial layout merge");
});

// ── noops ────────────────────────────────────────────────────────────────────────

test("malformed ops are noop reason=invalid", () => {
  const s = createCanvasState();
  assert.deepEqual(applyOp(s, null), { action: "noop", reason: "invalid" });
  assert.deepEqual(applyOp(s, "nope"), { action: "noop", reason: "invalid" });
  assert.deepEqual(applyOp(s, { op: "bogus" }), { action: "noop", reason: "invalid" });
  assert.deepEqual(applyOp(s, { op: "mount", id: "a" }), { action: "noop", reason: "invalid" }, "mount needs a component");
  assert.deepEqual(applyOp(s, { op: "mount", component: "metric" }), { action: "noop", reason: "invalid" }, "mount needs an id");
  assert.deepEqual(applyOp(s, { op: "layout", spec: "bad" }), { action: "noop", reason: "invalid" }, "layout needs an object spec");
  assert.deepEqual(applyOp(s, { op: "layout" }), { action: "noop", reason: "invalid" }, "layout needs a spec");
});

test("update of an unknown id is a noop reason=update-unknown-id (does NOT create)", () => {
  const s = createCanvasState();
  const d = applyOp(s, { op: "update", id: "ghost", props: { value: "1" } });
  assert.deepEqual(d, { action: "noop", reason: "update-unknown-id" });
  assert.equal(s.nodes.has("ghost"), false);
});

test("remove of an unknown id is a noop reason=remove-unknown-id", () => {
  const s = createCanvasState();
  const d = applyOp(s, { op: "remove", id: "ghost" });
  assert.deepEqual(d, { action: "noop", reason: "remove-unknown-id" });
});

// ── applyOps (batch) ────────────────────────────────────────────────────────────

test("applyOps returns one descriptor per op, in order, including noops", () => {
  const s = createCanvasState();
  const out = applyOps(s, [
    { op: "mount", id: "a", component: "metric", props: { v: 1 } },
    { op: "update", id: "ghost", props: { v: 2 } },   // noop
    { op: "update", id: "a", props: { v: 2 } },
    { op: "remove", id: "a" },
    { op: "remove", id: "a" },                          // noop (already gone)
  ]);
  assert.equal(out.length, 5, "one descriptor per op, noops included");
  assert.deepEqual(out.map((d) => d.action), ["mount", "noop", "update", "remove", "noop"]);
  assert.equal(out[1].reason, "update-unknown-id");
  assert.equal(out[4].reason, "remove-unknown-id");
  assert.equal(s.nodes.size, 0, "net effect: mounted then removed");
});

test("applyOps on a non-array returns []", () => {
  const s = createCanvasState();
  assert.deepEqual(applyOps(s, null), []);
  assert.deepEqual(applyOps(s, "nope"), []);
  assert.deepEqual(applyOps(s, { op: "mount" }), []);
});

// ── PARITY: client applyOp ≡ server reconcile (op semantics) ───────────────────

// Reduce a client canvas state to a comparable {components, layout} shape.
function clientShape(state) {
  const components = {};
  for (const [id, n] of state.nodes) {
    components[id] = { id, component: n.component, props: n.props, slot: n.slot, at: n.at };
  }
  return { components, layout: state.layout };
}
// Reduce a server doc to the same comparable shape.
function serverShape(doc) {
  const components = {};
  for (const [id, n] of Object.entries(doc.components)) {
    components[id] = { id, component: n.component, props: n.props, slot: n.slot ?? null, at: n.at ?? null };
  }
  return { components, layout: doc.layout };
}

test("PARITY: a well-formed op stream yields the SAME node set + layout on both sides", () => {
  const stream = [
    { op: "layout", spec: { columns: 3 } },
    { op: "mount", id: "a", component: "metric", props: { value: "1", label: "L" } },
    { op: "mount", id: "b", component: "list", props: { items: [] } },
    { op: "update", id: "a", props: { value: "9" } },         // shallow-merge both sides
    { op: "mount", id: "a", component: "metric", props: { value: "x" } }, // upsert — props replace both sides
    { op: "remove", id: "b" },
    { op: "layout", spec: { gap: "lg" } },                    // merge onto {columns:3}
  ];

  const cs = createCanvasState();
  applyOps(cs, stream);

  const { doc } = reconcile(emptyDoc(), stream);

  assert.deepEqual(clientShape(cs), serverShape(doc),
    "client applyOp and server reconcile must agree on the resulting composition");
});

test("DIVERGENCE (finding #6): unknown-id update/remove — client noops, server REJECTS", () => {
  // Client: silently ignore so a stray op can't blank the canvas.
  const cs = createCanvasState();
  assert.equal(applyOp(cs, { op: "update", id: "ghost", props: { v: 1 } }).reason, "update-unknown-id");
  assert.equal(applyOp(cs, { op: "remove", id: "ghost" }).reason, "remove-unknown-id");
  assert.equal(cs.nodes.size, 0);

  // Server: the agent should not patch a node it never mounted → rejected, doc untouched.
  const r1 = reconcile(emptyDoc(), [{ op: "update", id: "ghost", props: { v: 1 } }]);
  assert.equal(r1.applied.length, 0);
  assert.equal(r1.rejected.length, 1);
  assert.equal(r1.rejected[0].error, "update-unknown-id");
  assert.deepEqual(r1.doc.components, {});

  const r2 = reconcile(emptyDoc(), [{ op: "remove", id: "ghost" }]);
  assert.equal(r2.rejected.length, 1);
  assert.equal(r2.rejected[0].error, "remove-unknown-id");
});

// ── SX-2: the explicit live flag + time-travel state machine ────────────────────

test("createViewState starts live with no frames", () => {
  const v = createViewState();
  assert.equal(v.live, true);
  assert.equal(v.viewIndex, -1);
  assert.deepEqual(v.frames, []);
  assert.equal(atNow(v), true);
});

test("atNow tracks the explicit live flag, NOT the index", () => {
  const v = createViewState();
  // Force a state where the index is at the right edge but live is false:
  v.frames = [{ n: 0 }, { n: 1 }];
  v.viewIndex = 1; // == frames.length-1, the "looks live by index" trap
  v.live = false;
  assert.equal(atNow(v), false, "atNow reads live, never derives at-now from viewIndex");
});

test("SX-2: enterLive() then setFrames() with a LONGER frames array keeps live===true", () => {
  // The exact bug that bit: a live patch goes live BEFORE its frame commits, then
  // /api/history arrives with the longer log. A derived check (viewIndex>=len-1)
  // would read stale and snap into the past. The explicit flag must NOT.
  const v = createViewState();
  v.frames = [{ n: 0 }, { n: 1 }];
  v.viewIndex = 1;

  enterLive(v);                 // live patch lands; viewIndex pinned to current right edge (1)
  assert.equal(v.live, true);
  assert.equal(v.viewIndex, 1);

  // Now the frame-commit grows the log — the window where a derived check breaks.
  setFrames(v, [{ n: 0 }, { n: 1 }, { n: 2 }]);
  assert.equal(v.live, true, "history refresh must NOT change at-now-ness (SX-2)");
  assert.equal(v.viewIndex, 2, "at-now adopts the new right edge");
  assert.equal(atNow(v), true);
});

test("setFrames on a scrubbed-back view stays put and never touches live", () => {
  const v = createViewState();
  v.frames = [{ n: 0 }, { n: 1 }, { n: 2 }];
  gotoFrame(v, 0);              // scrub back → not live
  assert.equal(v.live, false);
  assert.equal(v.viewIndex, 0);

  setFrames(v, [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(v.viewIndex, 0, "a scrubbed-back view does NOT jump to the new right edge");
  assert.equal(v.live, false, "setFrames never touches live");
});

test("setFrames coerces a non-array to [] and (when live) pins viewIndex to -1", () => {
  const v = createViewState();
  setFrames(v, null);
  assert.deepEqual(v.frames, []);
  assert.equal(v.viewIndex, -1);
  assert.equal(v.live, true, "live untouched");
});

test("gotoFrame to a non-last index → live=false; clamps out-of-range", () => {
  const v = createViewState();
  v.frames = [{ n: 0 }, { n: 1 }, { n: 2 }];
  gotoFrame(v, 1);
  assert.equal(v.viewIndex, 1);
  assert.equal(v.live, false, "scrubbed off the right edge → not live");

  gotoFrame(v, -5);
  assert.equal(v.viewIndex, 0, "clamped to 0");
  assert.equal(v.live, false);

  gotoFrame(v, 99);
  assert.equal(v.viewIndex, 2, "clamped to last");
  assert.equal(v.live, true, "scrubbing to the last tick === live (explicit user scrub)");
});

test("gotoFrame with no frames is a no-op", () => {
  const v = createViewState();
  gotoFrame(v, 5);
  assert.equal(v.viewIndex, -1);
  assert.equal(v.live, true);
});

test("returnToNow → live + pinned to the last frame", () => {
  const v = createViewState();
  v.frames = [{ n: 0 }, { n: 1 }, { n: 2 }];
  gotoFrame(v, 0);
  assert.equal(v.live, false);
  returnToNow(v);
  assert.equal(v.live, true);
  assert.equal(v.viewIndex, 2);
  assert.equal(atNow(v), true);
});

test("recallFrame: hit moves viewIndex + recomputes live and returns true", () => {
  const v = createViewState();
  v.frames = [{ n: 10 }, { n: 20 }, { n: 30 }];
  v.viewIndex = 2;
  const hit = recallFrame(v, 20);
  assert.equal(hit, true);
  assert.equal(v.viewIndex, 1);
  assert.equal(v.live, false, "recalled a non-last frame → not live");

  const hitLast = recallFrame(v, 30);
  assert.equal(hitLast, true);
  assert.equal(v.viewIndex, 2);
  assert.equal(v.live, true, "recalled the last frame → live (same rule as gotoFrame)");
});

test("recallFrame: miss returns false and mutates nothing", () => {
  const v = createViewState();
  v.frames = [{ n: 10 }, { n: 20 }];
  v.viewIndex = 1;
  v.live = true;
  const hit = recallFrame(v, 999);
  assert.equal(hit, false);
  assert.equal(v.viewIndex, 1, "unknown frame number leaves viewIndex untouched");
  assert.equal(v.live, true, "and leaves live untouched");
});
