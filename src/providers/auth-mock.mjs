// mockAuthProvider — a deterministic AuthProvider for tests and local-dev login
// flows. AuthProvider establishes a human Principal via a begin→complete
// handshake (real impls redirect to an IdP and exchange a code; this one just
// hands back a fixed principal). See provider-sdk/ports.d.ts (AuthProvider) and
// auth-google.mjs for the real OIDC implementation.
//
// The Principal it returns carries a `ceiling` (the capabilities this human may
// grant); the kernel bounds every grant by `mode.grantable ⊆ principal.ceiling`
// (src/kernel/permissions.mjs). A mock principal gets a conservative default
// ceiling (no fs:write / network / agent.* — those are operator-only).

/** Default ceiling for a mock principal: the attributable, non-destructive set. */
const DEFAULT_CEILING = ["render", "ask", "read", "compose"];

/**
 * @param {{ principal?: import("../adapter-sdk/adapter").Principal, ceiling?: string[] }} [opts]
 * @returns {import("../provider-sdk/ports").AuthProvider}
 */
export function mockAuthProvider({ principal, ceiling } = {}) {
  return {
    id: "mock",

    // begin() would normally return a redirect URL to the IdP. The mock returns a
    // fixed challenge + state so a test can assert a deterministic round-trip.
    async begin(_req) {
      return { challenge: "mock", state: "mock-state" };
    },

    // complete() would normally exchange the IdP's code for verified claims. The
    // mock returns the configured principal, or synthesizes one from the request.
    async complete(req) {
      if (principal) return principal;
      return {
        id: (req && req.id) || "mock-user",
        display: "Mock User",
        ceiling: ceiling || DEFAULT_CEILING,
        provider: "mock",
      };
    },
  };
}

export default mockAuthProvider;
