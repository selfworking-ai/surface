// The Surface Protocol codec — the executable source of truth for wire framing
// and version negotiation. Pure, dependency-free, and the same module the kernel
// and (optionally) the client import so they cannot drift. See the typed shapes
// in `surface-protocol.d.ts`.
//
// Framing: every message is wrapped in a {v, ...msg} envelope on encode. On
// decode we tolerate a missing `v` (simple clients) but reject an incompatible
// one — a host/runtime mismatch degrades gracefully instead of corrupting state.

/** Current protocol major version. Bump on a breaking wire change. */
export const PROTOCOL_VERSION = 1;

/** Trust/permission postures a connection can lock into. */
export const MODES = /** @type {const} */ (["operator", "team", "visitor"]);

/** The retained-mode patch vocabulary. */
export const PATCH_OPS = /** @type {const} */ (["mount", "update", "remove", "layout"]);

/**
 * Stamp the protocol version onto a message and serialize it.
 * @param {object} msg a ClientMsg or ServerMsg (without the envelope field)
 * @returns {string} JSON wire string
 */
export function encode(msg) {
  if (msg == null || typeof msg !== "object" || Array.isArray(msg)) {
    throw new TypeError("encode: message must be a plain object");
  }
  if (typeof msg.type !== "string" || !msg.type) {
    throw new TypeError("encode: message needs a string `type`");
  }
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}

/**
 * Parse + validate a wire message. Never throws.
 * @param {string|object} raw JSON string (or already-parsed object)
 * @returns {{ok:true, msg:object, version:number, negotiation:object} | {ok:false, error:string, negotiation?:object, msg?:object}}
 */
export function decode(raw) {
  let parsed;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { ok: false, error: "invalid-json" }; }
  } else {
    parsed = raw;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "not-an-object" };
  }
  if (typeof parsed.type !== "string" || !parsed.type) {
    return { ok: false, error: "missing-type" };
  }
  // Tolerate an absent `v` (treat as current) so minimal clients still talk.
  const version = typeof parsed.v === "number" ? parsed.v : PROTOCOL_VERSION;
  const negotiation = negotiate(version);
  if (!negotiation.compatible) {
    return { ok: false, error: "incompatible-version", negotiation, msg: parsed };
  }
  const { v: _v, ...msg } = parsed;
  return { ok: true, msg, version, negotiation };
}

/**
 * Negotiate a remote protocol version against the local one.
 * @param {number} remote
 * @returns {{compatible:boolean, outcome:"exact"|"compatible-minor"|"incompatible", local:number, remote:number}}
 */
export function negotiate(remote) {
  const local = PROTOCOL_VERSION;
  const r = Number(remote);
  if (!Number.isInteger(r) || r < 1) {
    return { compatible: false, outcome: "incompatible", local, remote: r };
  }
  if (r === local) return { compatible: true, outcome: "exact", local, remote: r };
  // v1 uses integer majors only: any differing integer is a breaking mismatch.
  // The "compatible-minor" outcome is reserved for a future minor scheme.
  return { compatible: false, outcome: "incompatible", local, remote: r };
}

/**
 * Validate a single patch op (shared by the reconciler).
 * @param {any} op
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validatePatchOp(op) {
  if (!op || typeof op !== "object") return { ok: false, error: "op-not-object" };
  switch (op.op) {
    case "mount":
      if (typeof op.id !== "string" || !op.id) return { ok: false, error: "mount-needs-id" };
      if (typeof op.component !== "string" || !op.component) return { ok: false, error: "mount-needs-component" };
      if (op.props != null && (typeof op.props !== "object" || Array.isArray(op.props))) return { ok: false, error: "mount-props-must-be-object" };
      return { ok: true };
    case "update":
      if (typeof op.id !== "string" || !op.id) return { ok: false, error: "update-needs-id" };
      if (op.props == null || typeof op.props !== "object" || Array.isArray(op.props)) return { ok: false, error: "update-needs-props" };
      return { ok: true };
    case "remove":
      if (typeof op.id !== "string" || !op.id) return { ok: false, error: "remove-needs-id" };
      return { ok: true };
    case "layout":
      if (op.spec == null || typeof op.spec !== "object" || Array.isArray(op.spec)) return { ok: false, error: "layout-needs-spec" };
      return { ok: true };
    default:
      return { ok: false, error: "unknown-op" };
  }
}

/**
 * Validate an array of patch ops.
 * @param {any} ops
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validatePatch(ops) {
  if (!Array.isArray(ops)) return { ok: false, error: "ops-not-array" };
  for (let i = 0; i < ops.length; i++) {
    const r = validatePatchOp(ops[i]);
    if (!r.ok) return { ok: false, error: `op[${i}]: ${r.error}` };
  }
  return { ok: true };
}

/** True if `mode` is a recognized working mode. */
export function isMode(mode) {
  return MODES.includes(mode);
}
