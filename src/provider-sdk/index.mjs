// Provider SDK — the public surface for the PRIVILEGED extension plane. Providers
// supply system capabilities behind kernel PORTS (auth, identity, storage, audit,
// transport, connectors). They are trusted/vetted and CONFIGURED by the agent at
// runtime, never AUTHORED by it (contrast: apps/packs are userspace + agent-
// authorable). The typed port contracts live in ports.d.ts.
//
// Concrete implementations live in `src/providers/` — v1 ships only the default
// StorageProvider there (`providers/store-file.mjs`, jsonl-on-disk). The rest of
// the ports are defined (types) for M4 to implement against a stable contract.

/** The kernel port names, in the order they're documented in ports.d.ts. */
export const PORT_NAMES = /** @type {const} */ ([
  "storage",
  "auth",
  "identity",
  "audit",
  "transport",
  "connectors",
]);

/**
 * Structural check that an object satisfies the StorageProvider port — the only
 * port the kernel hard-requires in v1 (frames + workspace persistence). Shape
 * only; we don't probe behavior.
 * @param {any} p
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateStorageProvider(p) {
  if (!p || typeof p !== "object") return { ok: false, error: "provider-not-object" };
  for (const fn of ["get", "put", "appendFrame", "listFrames"]) {
    if (typeof p[fn] !== "function") return { ok: false, error: `storage-missing-${fn}` };
  }
  // saveWorkspace/loadWorkspace are optional in the port (Workspace.persist guards
  // on their presence), so we don't require them here.
  return { ok: true };
}
