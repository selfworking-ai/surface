// Surface configuration — copy to `surface.config.js` and edit.
//
// `npx surface dev` loads `./surface.config.js` if present, otherwise it boots with the
// built-in echo adapter. The same shape can be passed straight to `createSurface(...)`
// when embedding Surface in a host project. Every field is optional except `adapter`;
// the defaults shown match the kernel's defaults.
//
// This file is plain Node ESM (no build step) — `export default { … }`.

// The adapter is the borrowed-fabric seam: it teaches Surface to drive ONE agent runtime.
// M1 ships the in-process echo adapter (Tier C). The Claude Code adapter lands in M2.
import { echoAdapter } from "@selfworking-ai/surface/adapters/echo.mjs";
// import { claudeCodeAdapter } from "@selfworking-ai/surface/adapters/claude-code.mjs"; // [M2]

// The default file StorageProvider (frames + workspace as JSONL on disk). Swap for a
// Postgres/Redis-backed provider behind the same port for production persistence.
import { fileStore } from "@selfworking-ai/surface/providers/store-file.mjs";

// Starter packs (userspace apps). Each pack default-exports a `{ manifest, seed }`
// module. Uncomment a pack here AND its matching entry in `packs:` below to install it. [M5]
// import missionControl from "@selfworking-ai/surface/packs/mission-control/index.mjs";
// import businessOS from "@selfworking-ai/surface/packs/business-os/index.mjs";
// import agenticSite from "@selfworking-ai/surface/packs/agentic-site/index.mjs";

export default {
  // ── Runtime (required) ──────────────────────────────────────────────────────
  // The agent runtime Surface borrows its fabric from. Exactly one adapter.
  adapter: echoAdapter(),
  // adapter: claudeCodeAdapter({ cwd: process.cwd() }),   // [M2] real Claude Code turns

  // ── Providers (privileged plane, behind kernel ports) ─────────────────────────
  // Trusted system capabilities. The agent CONFIGURES these via an operator-gated flow,
  // it never AUTHORS them. v1 implements only `storage`; the rest land in M4.
  providers: {
    storage: fileStore({ dir: process.env.SURFACE_DIR || "./.surface" }),
    // auth:     googleOIDC({ clientId: "…", clientSecret: "…" }),   // AuthProvider     [M4]
    // identity: webAuthn({ rpName: "Surface", rpID: "localhost" }), // IdentityProvider [M4]
    // audit:    fileAudit({ path: "./.surface/audit.jsonl" }),      // AuditSink        [M4]
    // connectors: [ /* Slack/Stripe → tools + broker topics */ ],   // ConnectorProvider [M4+]
  },

  // ── Packs (userspace apps) ────────────────────────────────────────────────────
  // Sets of components + layout + data wiring + an optional agent system-prompt
  // fragment, installed into the workspace. Agent-authorable; sandboxed, low-trust. [M5]
  // To install a pack: uncomment its import above AND its entry here (the two must match).
  packs: [
    // missionControl,
    // businessOS,
    // agenticSite,   // visitor mode: generation OFF, tools NONE, curated pack only
  ],

  // ── Connection posture ──────────────────────────────────────────────────────
  // operator: full generation + tools (trusted, single human).
  // team:     scoped generation + tools, attributable to a principal.
  // visitor:  generation OFF, tools NONE, a curated pack only (untrusted viewers).
  mode: "operator",

  // ── Transport ─────────────────────────────────────────────────────────────────
  // Default port 5757; env SURFACE_PORT / PORT override this at runtime.
  port: 5757,
  // Bind address. Keep loopback (127.0.0.1) unless you knowingly front Surface with a
  // reverse proxy — see SECURITY.md. The kernel never binds 0.0.0.0 by default.
  host: "127.0.0.1",
  // WebSocket origin allowlist (gotcha G8). Defaults to the loopback origins for `port`.
  // Add an origin here ONLY when fronting Surface behind a proxy on a known host.
  allowedOrigins: [
    "http://localhost:5757",
    "http://127.0.0.1:5757",
  ],

  // Auto-open the browser on boot. Set false (or env OPEN_BROWSER=0) for headless hosts.
  openBrowser: true,
};
