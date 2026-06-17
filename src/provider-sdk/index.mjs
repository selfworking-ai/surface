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

// The M4 ports. Each validator is shape-only — it proves the seam exists, not
// that the impl behaves. Concrete implementations live in `src/providers/`:
//   audit    → audit-file.mjs      (file / console / noop sinks)
//   auth     → auth-mock.mjs · auth-google.mjs
//   identity → identity-mock.mjs · identity-webauthn.mjs

/**
 * Structural check that an object satisfies the AuditSink port (`record(e)`).
 * The kernel calls `record()` on every mutating action (fire-and-forget); a sink
 * only needs that one method. `id` is optional metadata.
 * @param {any} p
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateAuditSink(p) {
  if (!p || typeof p !== "object") return { ok: false, error: "provider-not-object" };
  if (typeof p.record !== "function") return { ok: false, error: "audit-missing-record" };
  return { ok: true };
}

/**
 * Structural check that an object satisfies the AuthProvider port — the
 * begin→complete OIDC/SSO handshake that establishes a human Principal.
 * @param {any} p
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateAuthProvider(p) {
  if (!p || typeof p !== "object") return { ok: false, error: "provider-not-object" };
  for (const fn of ["begin", "complete"]) {
    if (typeof p[fn] !== "function") return { ok: false, error: `auth-missing-${fn}` };
  }
  return { ok: true };
}

/**
 * Structural check that an object satisfies the IdentityProvider port — the
 * register→verify pair (WebAuthn/passkey, or a mock for tests).
 * @param {any} p
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateIdentityProvider(p) {
  if (!p || typeof p !== "object") return { ok: false, error: "provider-not-object" };
  for (const fn of ["register", "verify"]) {
    if (typeof p[fn] !== "function") return { ok: false, error: `identity-missing-${fn}` };
  }
  return { ok: true };
}

/**
 * Validate every PRESENT member of a ProviderSet against its port. Absent members
 * are fine (the kernel supplies defaults / leaves them null) — this only checks
 * the shapes a host actually wired. `connectors` is an array; each is validated.
 * @param {any} set  a {@link ProviderSet}-shaped bundle
 * @returns {{ok:true} | {ok:false, errors:Array<{port:string,error:string}>}}
 */
export function validateProviderSet(set) {
  if (!set || typeof set !== "object") return { ok: false, errors: [{ port: "set", error: "not-an-object" }] };
  const errors = [];
  const check = (port, value, fn) => {
    if (value == null) return;              // absent → kernel default; nothing to validate
    const r = fn(value);
    if (!r.ok) errors.push({ port, error: r.error });
  };
  check("storage", set.storage, validateStorageProvider);
  check("audit", set.audit, validateAuditSink);
  check("auth", set.auth, validateAuthProvider);
  check("identity", set.identity, validateIdentityProvider);
  if (set.connectors != null) {
    if (!Array.isArray(set.connectors)) {
      errors.push({ port: "connectors", error: "not-an-array" });
    } else {
      set.connectors.forEach((c, i) => {
        if (!c || typeof c.tools !== "function" || typeof c.topics !== "function") {
          errors.push({ port: `connectors[${i}]`, error: "connector-missing-tools-or-topics" });
        }
      });
    }
  }
  // transport is implementation-defined ([k:string]:unknown) — no fixed shape to check.
  return errors.length ? { ok: false, errors } : { ok: true };
}
