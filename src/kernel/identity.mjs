// Identity — principal plumbing. Surface authenticates the HUMAN principal and
// sets their authority ceiling ("this human may grant up to X"), then passes a
// principal + a capability token into the runtime on spawn; the runtime enforces
// attenuation within its own agent tree. Every runtime action carries Surface's
// principal token to the AuditSink (M4).
//
// M1 status: single local operator, no real auth. `defaultPrincipal()` is the
// trusted-self principal with a wildcard ceiling; `capabilityToken()` is an opaque
// (NOT signed) JSON+base64 envelope. Real auth providers + token SIGNING are M4 —
// see provider-sdk AuthProvider/IdentityProvider. The token shape is fixed now so
// the runtime contract is stable across that change.

/**
 * The default single-operator principal: full local authority, no external IdP.
 * @returns {import("../adapter-sdk/adapter").Principal}
 */
export function defaultPrincipal() {
  return { id: "operator", display: "Operator", ceiling: ["*"], provider: "local" };
}

/**
 * Mint an opaque capability token carrying the principal's identity + ceiling.
 * The runtime treats this as a bearer credential for attribution + the grant
 * ceiling. v1 is base64url(JSON) — INTEGRITY-ONLY-BY-OBSCURITY, i.e. none; M4
 * swaps in real signing (HMAC/JWT via the AuthProvider) without changing the
 * call site or the decoded shape.
 *
 * @param {import("../adapter-sdk/adapter").Principal} principal
 * @returns {string} an opaque token string
 */
export function capabilityToken(principal) {
  const p = principal || defaultPrincipal();
  const payload = {
    id: p.id,
    ceiling: Array.isArray(p.ceiling) ? p.ceiling : ["*"],
    provider: p.provider || "local",
    // `iat` lets a future signed scheme expire tokens; harmless in v1.
    iat: Date.now(),
  };
  // base64url so the token is URL/header-safe.
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decode a capability token back to its payload. Never throws — returns null on a
 * malformed token (callers treat null as "no authority"). v1 performs NO signature
 * verification (there is no signature); M4's verifier slots in here.
 * @param {string} token
 * @returns {{id:string, ceiling:string[], provider:string, iat:number} | null}
 */
export function decodeToken(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const obj = JSON.parse(json);
    if (!obj || typeof obj.id !== "string") return null;
    if (!Array.isArray(obj.ceiling)) obj.ceiling = ["*"];
    return obj;
  } catch { return null; }
}
