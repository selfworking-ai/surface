// mockIdentityProvider — an in-memory IdentityProvider for tests and local dev.
// IdentityProvider registers + verifies a principal (the real impl is WebAuthn /
// passkeys — see identity-webauthn.mjs). This mock keeps a Map keyed by principal
// id: `register(p)` stores, `verify({id})` returns the stored principal or throws.
// A deterministic round-trip with no crypto. See provider-sdk/ports.d.ts.

/**
 * @returns {import("../provider-sdk/ports").IdentityProvider}
 */
export function mockIdentityProvider() {
  const store = new Map();   // principal.id → Principal
  return {
    id: "mock",

    async register(p) {
      if (!p || typeof p.id !== "string" || !p.id) {
        throw new Error("mockIdentity.register: principal with a string id is required");
      }
      store.set(p.id, p);
    },

    async verify(req) {
      const id = req && req.id;
      const p = id != null ? store.get(id) : undefined;
      if (!p) throw new Error(`mockIdentity.verify: unknown principal "${id}"`);
      return p;
    },
  };
}

export default mockIdentityProvider;
