// googleAuth — a REAL Google OIDC AuthProvider, config-gated. Implements the
// AuthProvider port (provider-sdk/ports.d.ts): a begin→complete authorization-code
// flow that establishes a human Principal from a Google account.
//
//   begin({ state })   → an auth URL to redirect the human to Google's consent screen.
//   complete({ code }) → exchange the code for tokens, validate the id_token, and
//                        return a Principal { id: sub, display, ceiling, provider:"google" }.
//
// PROVENANCE / TRUST: this is a privileged provider — vetted, CONFIGURED by an
// operator, never authored by the agent at runtime. It needs REAL Google
// credentials (a client id + secret from a Google Cloud OAuth 2.0 "Web
// application" client) and a registered redirect URI. It therefore CANNOT be
// end-to-end tested without those creds + a browser consent round-trip; the URL
// builder below (`buildGoogleAuthUrl`) is split out precisely so the
// no-network-needed part stays unit-testable. Secrets come from env
// (surface.config.js reads process.env), never committed — see docs/deployment.md.
//
// TOKEN VALIDATION: rather than hand-roll RS256 + JWKS verification (easy to get
// subtly wrong), `complete()` validates the returned id_token via Google's
// tokeninfo endpoint, which performs signature + expiry checks server-side and
// returns the decoded claims. This is the pragmatic, safe default. PRODUCTION may
// prefer LOCAL verification (fetch Google's JWKS once, cache, verify RS256 with a
// vetted JOSE library) to avoid a network round-trip per login and the tokeninfo
// rate limits — that belongs in an optional, vetted provider package, not the
// zero-dep core (same boundary as identity-webauthn.mjs).

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

/** Default ceiling for a Google-authenticated principal (attributable, non-destructive). */
const DEFAULT_CEILING = ["render", "ask", "read", "compose"];
/** Default OIDC scopes — enough to identify the human (sub) + display name/email. */
const DEFAULT_SCOPES = "openid email profile";

/**
 * Build the Google authorization-code consent URL. Pure (no network) so it is
 * unit-testable on its own. `scope` accepts a string or an array of scopes.
 * @param {{ clientId:string, redirectUri:string, state?:string, scopes?:string|string[],
 *           prompt?:string, accessType?:string }} opts
 * @returns {string}
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state, scopes, prompt, accessType } = {}) {
  if (!clientId) throw new Error("googleAuth: clientId is required to build an auth URL");
  if (!redirectUri) throw new Error("googleAuth: redirectUri is required to build an auth URL");
  const scope = Array.isArray(scopes) ? scopes.join(" ") : (scopes || DEFAULT_SCOPES);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
  });
  if (state != null) params.set("state", String(state));
  if (prompt) params.set("prompt", prompt);
  if (accessType) params.set("access_type", accessType);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * @param {{ clientId:string, clientSecret:string, redirectUri:string,
 *           ceiling?:string[], scopes?:string|string[] }} opts
 * @returns {import("../provider-sdk/ports").AuthProvider}
 */
export function googleAuth({ clientId, clientSecret, redirectUri, ceiling, scopes } = {}) {
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "googleAuth requires { clientId, clientSecret, redirectUri } — real Google OAuth 2.0 " +
      "credentials with a registered redirect URI. Provide them from env (never commit secrets).",
    );
  }

  return {
    id: "google",

    // begin: hand the caller a consent URL to redirect the human to. The caller
    // (host route) is responsible for round-tripping `state` (CSRF) back to complete().
    async begin(req) {
      const state = req && req.state;
      return { redirect: buildGoogleAuthUrl({ clientId, redirectUri, state, scopes }), state };
    },

    // complete: exchange the authorization code for tokens, then VALIDATE the
    // id_token via Google's tokeninfo (signature + expiry checked server-side),
    // confirm the audience is us, and map verified claims → Principal.
    async complete(req) {
      const code = req && req.code;
      if (!code) throw new Error("googleAuth.complete: missing authorization `code`");

      // 1) Authorization-code → tokens (form-encoded POST, per the OAuth spec).
      const tokenRes = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        const detail = await safeText(tokenRes);
        throw new Error(`googleAuth: token exchange failed (${tokenRes.status}) ${detail}`);
      }
      const tokens = await tokenRes.json();
      const idToken = tokens && tokens.id_token;
      if (!idToken) throw new Error("googleAuth: token response had no id_token");

      // 2) Validate the id_token. tokeninfo verifies the RS256 signature + expiry
      //    on Google's side and returns the decoded claims (see PRODUCTION note in
      //    the file header for the local-JWKS alternative).
      const infoRes = await fetch(`${TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(idToken)}`);
      if (!infoRes.ok) {
        const detail = await safeText(infoRes);
        throw new Error(`googleAuth: id_token validation failed (${infoRes.status}) ${detail}`);
      }
      const claims = await infoRes.json();

      // 3) Audience check: the token MUST have been minted for THIS client.
      if (claims.aud !== clientId) {
        throw new Error("googleAuth: id_token audience mismatch (token not issued for this client)");
      }
      if (!claims.sub) throw new Error("googleAuth: id_token missing `sub` (subject)");

      // 4) Verified claims → Principal. `sub` is Google's stable user id.
      return {
        id: claims.sub,
        display: claims.name || claims.email || claims.sub,
        ceiling: ceiling || DEFAULT_CEILING,
        provider: "google",
      };
    },
  };
}

/** Read a response body as text without throwing (for error messages). */
async function safeText(res) {
  try { return (await res.text()).slice(0, 500); } catch { return ""; }
}

export default googleAuth;
