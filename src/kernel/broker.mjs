// Broker — the kernel's topic pub/sub data bus. Components on the canvas publish
// and subscribe to named topics (the `dataContract.topics` in a ComponentManifest)
// so a tile can react to data without knowing who produced it; connectors (M4) and
// the agent push onto the same bus. Decoupling the producer from the consumer is
// what lets userspace packs wire data flows declaratively.
//
// M1 status: shipped now, lightly used — the kernel itself doesn't yet route
// adapter events through it (that's M3, when the design-system components land).
// Kept tiny and synchronous: publish fans out in-process to current subscribers.

export class Broker {
  constructor() {
    /** @type {Map<string, Set<(data:any, topic:string)=>void>>} topic → handlers */
    this._topics = new Map();
  }

  /**
   * Publish `data` to everyone subscribed to `topic`. Synchronous fan-out; a
   * throwing handler is isolated so one bad subscriber can't break the publish
   * or starve the others. Returns the number of handlers notified.
   * @param {string} topic
   * @param {unknown} data
   * @returns {number}
   */
  publish(topic, data) {
    const set = this._topics.get(topic);
    if (!set || set.size === 0) return 0;
    // Snapshot so a handler that (un)subscribes during dispatch can't mutate the
    // set we're iterating.
    for (const fn of [...set]) {
      try { fn(data, topic); }
      catch (err) { console.error(`[surface] broker handler for "${topic}" threw:`, err?.message ?? err); }
    }
    return set.size;
  }

  /**
   * Subscribe `fn` to `topic`. Returns an idempotent unsubscribe function — call
   * it to detach (and prune the empty topic). Re-subscribing the same fn is a
   * no-op (Set semantics).
   * @param {string} topic
   * @param {(data:any, topic:string)=>void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(topic, fn) {
    if (typeof fn !== "function") throw new TypeError("broker.subscribe: handler must be a function");
    let set = this._topics.get(topic);
    if (!set) { set = new Set(); this._topics.set(topic, set); }
    set.add(fn);
    let active = true;
    return () => {
      if (!active) return;            // idempotent
      active = false;
      const s = this._topics.get(topic);
      if (s) { s.delete(fn); if (s.size === 0) this._topics.delete(topic); }
    };
  }

  /** List topics that currently have at least one subscriber. */
  topics() {
    return [...this._topics.keys()];
  }
}

export default Broker;
