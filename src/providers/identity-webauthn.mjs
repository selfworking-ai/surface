// webauthnIdentity — a WebAuthn / passkey IdentityProvider (the register→verify
// port; see provider-sdk/ports.d.ts).
//
// ┌─ INTENTIONAL BOUNDARY — READ THIS ────────────────────────────────────────┐
// │ Surface ships the SAFE, zero-dep parts of WebAuthn: minting cryptographically │
// │ random challenges and shaping the PublicKeyCredentialCreationOptions /        │
// │ RequestOptions the browser's navigator.credentials API expects. It does NOT   │
// │ ship attestation/assertion SIGNATURE verification.                            │
// │                                                                               │
// │ Verifying a WebAuthn registration (attestation) or login (assertion) means    │
// │ parsing CBOR/COSE keys, checking authenticator-data flags + signature counts, │
// │ and verifying ES256/RS256/EdDSA signatures against the stored credential —    │
// │ security-critical crypto that is easy to get subtly, dangerously wrong.       │
// │ Zero-dep-core will NOT hand-roll unverified crypto. That verification belongs │
// │ in an OPTIONAL, VETTED provider package (wire @simplewebauthn/server or a      │
// │ similar audited library) — the same island pattern as auth-google.mjs's       │
// │ "production prefers local JWKS" note. So register()/verify() THROW a clear,    │
// │ documented error here. This is honest and safe, not a stub-by-omission.       │
// │ See docs/providers.md → "The WebAuthn boundary".                              │
// └───────────────────────────────────────────────────────────────────────────┘

import { randomBytes } from "node:crypto";

/** Buffer → base64url (the encoding WebAuthn challenges/ids travel as on the wire). */
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }

/** The single error register()/verify() raise — points at the vetted-verifier seam. */
const VERIFY_ERROR =
  "webauthn verify() requires a vetted verifier — wire @simplewebauthn/server or similar; see docs/providers.md";

/**
 * @param {{ rpId?:string, rpName?:string, ceiling?:string[] }} [opts]
 *   rpId   the Relying Party ID (the site's registrable domain, e.g. "example.com").
 *   rpName a human label shown in the passkey UI.
 * @returns {import("../provider-sdk/ports").IdentityProvider & {
 *   registrationOptions: Function, authenticationOptions: Function }}
 */
export function webauthnIdentity({ rpId, rpName, ceiling } = {}) {
  const relyingPartyId = rpId || "localhost";
  const relyingPartyName = rpName || "Surface";

  return {
    id: "webauthn",

    // ── Safe, zero-dep halves: challenge minting + option shaping ──────────────

    /**
     * PublicKeyCredentialCreationOptions for navigator.credentials.create(). The
     * challenge is a fresh 32-byte CSPRNG value the authenticator must sign over.
     * @param {{ id:string, name?:string, displayName?:string }} user
     */
    registrationOptions(user) {
      if (!user || typeof user.id !== "string" || !user.id) {
        throw new Error("webauthn.registrationOptions: user with a string id is required");
      }
      const challenge = b64url(randomBytes(32));
      return {
        challenge,
        rp: { id: relyingPartyId, name: relyingPartyName },
        user: {
          id: b64url(Buffer.from(user.id, "utf8")),
          name: user.name || user.id,
          displayName: user.displayName || user.name || user.id,
        },
        // ES256 (-7) and RS256 (-257) — the broadly-supported COSE algorithms.
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: 60_000,
        attestation: "none",
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      };
    },

    /**
     * PublicKeyCredentialRequestOptions for navigator.credentials.get(). Fresh
     * challenge per call (anti-replay).
     * @param {{ allowCredentials?: Array<{id:string,type?:string}> }} [opts]
     */
    authenticationOptions(opts = {}) {
      const challenge = b64url(randomBytes(32));
      return {
        challenge,
        rpId: relyingPartyId,
        timeout: 60_000,
        userVerification: "preferred",
        ...(Array.isArray(opts.allowCredentials)
          ? { allowCredentials: opts.allowCredentials.map((c) => ({ type: c.type || "public-key", id: c.id })) }
          : {}),
      };
    },

    // ── The vetted-crypto boundary: NOT implemented here (see file header) ─────

    // register() would verify an attestation response + persist the credential's
    // public key + signCount. That verification needs a vetted verifier.
    async register(_principal) { throw new Error(VERIFY_ERROR); },

    // verify() would verify an assertion signature against the stored public key.
    // Same boundary.
    async verify(_req) { throw new Error(VERIFY_ERROR); },
  };
}

export default webauthnIdentity;
