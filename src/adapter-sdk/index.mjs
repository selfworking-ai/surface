// Adapter SDK — the public surface for AUTHORING an adapter (the borrowed-fabric
// seam). An adapter teaches Surface to drive one agent runtime; it is just
// `name` + `capabilities` + an async-generator `run({prompt, ctx})` that yields
// canonical TurnEvents (see adapter.d.ts and adapters/echo.mjs for the reference).
//
// This barrel re-exports the two subprocess helpers most adapters need (G1, G4)
// plus a tiny `defineAdapter` identity helper for ergonomics + editor types.

export { readNdjson, splitLines } from "./ndjson.mjs";
export { resolveBin } from "./resolve-bin.mjs";

/**
 * Identity helper documenting the adapter shape. Returns its argument unchanged —
 * its only job is to give authors a typed call site and a single import to hang a
 * JSDoc `@type` on. Adapters are conventionally exported as `(opts) => AgentAdapter`
 * factories; you may call `defineAdapter` inside the factory or on the object.
 *
 * @template {import("./adapter").AgentAdapter} A
 * @param {A} adapter
 * @returns {A}
 *
 * @example
 *   export const myAdapter = (opts = {}) => defineAdapter({
 *     name: "my-runtime",
 *     capabilities: { protocolVersion: 1, presentation: "presenter", resume: false,
 *       turnBoundary: "iterator-return", permissionPrompt: false, namespaces: [], orgTier: "C" },
 *     async *run({ prompt, ctx }) { yield { kind: "turn_done", code: 0 }; },
 *   });
 */
export function defineAdapter(adapter) {
  return adapter;
}
