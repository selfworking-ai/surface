// Registry — the component catalog. The retained-mode canvas mounts components by
// NAME (a `mount` op names a registered component); the registry maps that name to
// its manifest + an optional server-side factory. "Compose ≠ generate": most turns
// arrange already-registered components (cheap, deterministic, safe); AUTHORING a
// new component is the rare, gated path that registers a new entry here.
//
// M1 status: validates manifest SHAPE only. The load-bearing security rule —
// `tokensOnly: true`, registration REJECTS hardcoded colors/radii so runtime-
// generated components can't smuggle non-token styling — is an M3 hook; see the
// clearly-marked TODO in validateComponentManifest.

/**
 * Structural validation of a ComponentManifest (see pack-sdk/pack.d.ts). M1 checks
 * shape; returns {ok:true} for any well-formed manifest.
 * @param {any} m
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateComponentManifest(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, error: "manifest-not-object" };
  if (typeof m.name !== "string" || !m.name) return { ok: false, error: "manifest-needs-name" };
  if (typeof m.version !== "string" || !m.version) return { ok: false, error: "manifest-needs-version" };
  if (m.props == null || typeof m.props !== "object" || Array.isArray(m.props)) return { ok: false, error: "manifest-needs-props-schema" };
  if (!Array.isArray(m.capabilities)) return { ok: false, error: "manifest-needs-capabilities-array" };
  // tokensOnly is the design contract; M1 requires the flag be present + true so
  // manifests are forward-compatible with the M3 enforcement pass.
  if (m.tokensOnly !== true) return { ok: false, error: "manifest-must-set-tokensOnly-true" };

  // TODO(M3): token-only ENFORCEMENT. When a component ships a stylesheet/template,
  // parse it and reject any hardcoded color/length not drawn from the :root glass
  // tokens (the rule that makes runtime generation survivable). Shape-only for now.
  return { ok: true };
}

export class Registry {
  constructor() {
    /** @type {Map<string, {manifest: object, factory: Function|null}>} */
    this._byName = new Map();
  }

  /**
   * Register a component by manifest, with an optional server-side factory (e.g. a
   * data-binding/seed hook). Throws on an invalid manifest (registration is a
   * trust boundary — fail loud, don't half-register). Re-registering a name
   * replaces it (last-writer-wins; intentional for hot component authoring).
   * @param {object} manifest a ComponentManifest
   * @param {Function} [factory]
   * @returns {this}
   */
  register(manifest, factory) {
    const v = validateComponentManifest(manifest);
    if (!v.ok) throw new Error(`registry.register: ${v.error}`);
    if (factory != null && typeof factory !== "function") {
      throw new TypeError("registry.register: factory must be a function when provided");
    }
    this._byName.set(manifest.name, { manifest, factory: factory ?? null });
    return this;
  }

  /** Look up a registered entry by name, or undefined. */
  get(name) {
    return this._byName.get(name);
  }

  /** Whether a component name is registered. */
  has(name) {
    return this._byName.has(name);
  }

  /** All registered manifests (the catalog the agent composes from). */
  list() {
    return [...this._byName.values()].map((e) => e.manifest);
  }
}

export default Registry;
