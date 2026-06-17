// Workspace document — the durable retained-mode composition for one session
// (which components, where, bound to what data). DISTINCT from the frames log
// (turn history for time-travel, in the StorageProvider). This wraps the pure
// reconciler with snapshot/restore + optional persistence through a StorageProvider.

import { reconcile, emptyDoc, docToOps } from "./reconciler.mjs";

export class Workspace {
  /**
   * @param {{ session?: string|null, store?: import("../provider-sdk/ports").StorageProvider|null }} [opts]
   */
  constructor({ session = null, store = null } = {}) {
    this.session = session;
    this.store = store;
    this.doc = emptyDoc();
  }

  /** Bind this workspace to a session id (once the runtime reports it). */
  setSession(session) { this.session = session; return this; }

  /**
   * Apply patch ops to the document.
   * @returns {{doc:object, applied:object[], rejected:object[]}}
   */
  applyOps(ops) {
    const r = reconcile(this.doc, ops);
    this.doc = r.doc;
    return r;
  }

  /** Serializable snapshot of the current composition. */
  snapshot() {
    return {
      components: Object.values(this.doc.components).map((n) => ({ ...n })),
      layout: { ...this.doc.layout },
    };
  }

  /** Restore a composition from a snapshot (replaces current state). */
  restore(snap) {
    const doc = emptyDoc();
    if (snap?.layout) doc.layout = { ...doc.layout, ...snap.layout };
    for (const n of snap?.components || []) {
      if (n && typeof n.id === "string" && n.id) doc.components[n.id] = { ...n };
    }
    this.doc = doc;
    return this;
  }

  /** The full composition expressed as mount ops — to (re)hydrate a client. */
  toOps() { return docToOps(this.doc); }

  /** Number of mounted components. */
  get size() { return Object.keys(this.doc.components).length; }

  /** Persist the snapshot through the StorageProvider (if it supports it). */
  async persist() {
    if (this.store?.saveWorkspace && this.session) {
      await this.store.saveWorkspace(this.session, this.snapshot());
    }
  }

  /** Load a persisted snapshot for this session (if any). */
  async load() {
    if (this.store?.loadWorkspace && this.session) {
      const snap = await this.store.loadWorkspace(this.session);
      if (snap) this.restore(snap);
    }
    return this;
  }
}
