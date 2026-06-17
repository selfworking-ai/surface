// Retained-mode reconciler — the heart of Surface's biggest change vs `body`.
// `body` was immediate-mode (render(html) repainted every turn). Surface keeps a
// persistent WORKSPACE DOCUMENT and applies keyed PATCH OPS to it. This module is
// the PURE diff/apply core (no I/O, no DOM) so it is trivially testable; the
// client ships an identical-semantics DOM reconciler, and `workspace.mjs` wraps
// this with persistence.
//
// Op semantics (the contract both server + client implement identically):
//   mount  = UPSERT — create the node, or fully replace an existing one (same id).
//   update = PATCH  — shallow-merge props into an existing node (no-op-reject if absent).
//   remove = DELETE — drop the node (reject if absent).
//   layout = MERGE  — shallow-merge the spec into the layout.

import { validatePatchOp } from "../protocol/messages.mjs";

/** A fresh, empty workspace document. */
export function emptyDoc() {
  return { components: {}, layout: { columns: 4 } };
}

function cloneDoc(doc) {
  const base = doc && typeof doc === "object" ? doc : emptyDoc();
  return {
    components: { ...(base.components || {}) },
    layout: { ...(base.layout || { columns: 4 }) },
  };
}

/**
 * Apply patch ops to a document, purely. Never mutates `doc`.
 * @param {object} doc current workspace document (or null/undefined → empty)
 * @param {import("../protocol/surface-protocol").PatchOp[]} ops
 * @returns {{doc: object, applied: object[], rejected: {op:any, error:string}[]}}
 *   `applied` is the normalized op list to broadcast/replay (only ops that
 *   actually changed the doc); `rejected` carries why an op was dropped.
 */
export function reconcile(doc, ops) {
  const next = cloneDoc(doc);
  const applied = [];
  const rejected = [];
  const list = Array.isArray(ops) ? ops : [];

  for (const op of list) {
    const v = validatePatchOp(op);
    if (!v.ok) { rejected.push({ op, error: v.error }); continue; }

    switch (op.op) {
      case "mount": {
        // UPSERT: create or fully replace. Props replace (use `update` to merge).
        next.components[op.id] = {
          id: op.id,
          component: op.component,
          props: op.props ? { ...op.props } : {},
          slot: op.slot ?? null,
          at: op.at ?? null,
        };
        applied.push({ op: "mount", id: op.id, component: op.component, props: op.props ? { ...op.props } : {}, slot: op.slot ?? null, at: op.at ?? null });
        break;
      }
      case "update": {
        const existing = next.components[op.id];
        if (!existing) { rejected.push({ op, error: "update-unknown-id" }); break; }
        const merged = { ...existing, props: { ...(existing.props || {}), ...op.props } };
        next.components[op.id] = merged;
        applied.push({ op: "update", id: op.id, props: { ...op.props } });
        break;
      }
      case "remove": {
        if (!next.components[op.id]) { rejected.push({ op, error: "remove-unknown-id" }); break; }
        delete next.components[op.id];
        applied.push({ op: "remove", id: op.id });
        break;
      }
      case "layout": {
        next.layout = { ...next.layout, ...op.spec };
        applied.push({ op: "layout", spec: { ...next.layout } });
        break;
      }
    }
  }

  return { doc: next, applied, rejected };
}

/**
 * Serialize a document to mount ops — used to replay the whole composition to a
 * fresh / reconnecting client (so a refresh mid-session rebuilds the canvas).
 * @param {object} doc
 * @returns {import("../protocol/surface-protocol").PatchOp[]}
 */
export function docToOps(doc) {
  const d = doc && typeof doc === "object" ? doc : emptyDoc();
  const ops = [{ op: "layout", spec: { ...(d.layout || { columns: 4 }) } }];
  const nodes = Object.values(d.components || {});
  // Stable order: explicit `at` first (ascending), then insertion order.
  nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const aa = a.n.at == null ? Infinity : a.n.at;
      const bb = b.n.at == null ? Infinity : b.n.at;
      return aa === bb ? a.i - b.i : aa - bb;
    })
    .forEach(({ n }) => {
      ops.push({ op: "mount", id: n.id, component: n.component, props: n.props || {}, slot: n.slot ?? undefined, at: n.at ?? undefined });
    });
  return ops;
}

/**
 * Build mount ops from a persisted workspace SNAPSHOT ({components:[], layout}) —
 * used to re-surface a past frame (recall/time-travel) onto a live canvas.
 * @param {{components?: any[], layout?: object}} snap
 * @returns {import("../protocol/surface-protocol").PatchOp[]}
 */
export function snapshotToOps(snap) {
  const doc = emptyDoc();
  if (snap?.layout) doc.layout = { ...doc.layout, ...snap.layout };
  for (const n of snap?.components || []) if (n && typeof n.id === "string" && n.id) doc.components[n.id] = { ...n };
  return docToOps(doc);
}
