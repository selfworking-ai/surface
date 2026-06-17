/**
 * The Surface Protocol — the typed contract between the browser surface and the
 * kernel, and between the kernel and an agent runtime (via an adapter).
 *
 * Editor types only; no build step (assumption A3). The runtime codec lives in
 * `messages.mjs` and is the executable source of truth for framing + versioning;
 * this file is the human/editor-facing shape. Keep them in lockstep.
 *
 * Versioning: every wire message is wrapped in a {@link ProtocolEnvelope} that
 * carries the integer protocol `v`. The major version is negotiated once at the
 * `hello`/`capabilities` handshake (see {@link Capabilities.protocolVersion});
 * the per-message `v` is a cheap guard so a host/runtime mismatch degrades
 * gracefully instead of corrupting state.
 */

/** Current protocol major version. Bump on a breaking wire change. */
export type ProtocolVersion = 1;

/** Every wire message is stamped with the protocol version on encode. */
export interface ProtocolEnvelope {
  /** Protocol major version. */
  v: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retained-mode canvas — the patch vocabulary (the biggest change vs `body`).
//
// `body` was immediate-mode: render(html) repainted the whole canvas each turn.
// Surface is retained-mode: the agent PATCHES a persistent canvas. A tiny vanilla
// DOM reconciler keyed by component `id` diffs and applies these ops. The durable
// composition (which components, where, bound to what) is the WORKSPACE DOCUMENT;
// the turn history (for time-travel) is the FRAMES LOG — two distinct stores.
// ─────────────────────────────────────────────────────────────────────────────

/** Mount a new component instance into a layout slot, keyed by stable `id`. */
export interface MountOp {
  op: "mount";
  /** Stable, caller-chosen id. Re-mounting an existing id is treated as update. */
  id: string;
  /** Registered component name (e.g. "metric", "list", "status"). */
  component: string;
  /** Initial props; validated against the component manifest's prop schema. */
  props?: Record<string, unknown>;
  /** Named layout slot / region. Omitted → the default grid flow. */
  slot?: string;
  /** Optional ordering hint within the slot (lower = earlier). */
  at?: number;
}

/** Shallow-merge new props into an existing mounted component. */
export interface UpdateOp {
  op: "update";
  id: string;
  props: Record<string, unknown>;
}

/** Remove a mounted component (and its DOM node) by id. No-op if absent. */
export interface RemoveOp {
  op: "remove";
  id: string;
}

/** Replace/patch the layout spec (grid template, slot definitions, density). */
export interface LayoutOp {
  op: "layout";
  spec: LayoutSpec;
}

export type PatchOp = MountOp | UpdateOp | RemoveOp | LayoutOp;

/** Layout spec for the canvas. Intentionally small in v1; grows with packs. */
export interface LayoutSpec {
  /** Grid columns (default 4). */
  columns?: number;
  /** Optional named slots and their column spans. */
  slots?: Record<string, { span?: number; rows?: number }>;
  /** Visual density hint. */
  density?: "calm" | "compact";
  [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client → server messages (from the locked dock / surface).
// ─────────────────────────────────────────────────────────────────────────────

export type ClientMsg =
  /** A prompt typed into the dock — the one trusted input channel. */
  | { type: "prompt"; text: string }
  /** Answer to an `ask` decision card. `value` is the chosen option's intent. */
  | { type: "answer"; id: string; label?: string; value: string; cancelled?: boolean }
  /** Decision on a `permission` card. */
  | { type: "decision"; id: string; decision: "allow" | "deny"; message?: string }
  /** Browser owns session identity (G12); replays it on (re)connect. */
  | { type: "resume"; sessionId: string }
  /** Lock the working mode for the connection (operator | team | visitor). */
  | { type: "mode"; mode: Mode }
  /** Re-surface a past frame by turn number (time-travel; read-only look-back). */
  | { type: "recall"; n: number }
  /** Abort the in-flight turn. */
  | { type: "abort" }
  /**
   * Generic browser event channel — drawing-present, tile-marked, dwell/dismiss
   * telemetry, screenshot composite replies, etc. Keeps the core small while
   * userspace features ride along. `name` namespaces the event.
   */
  | { type: "event"; name: string; data?: unknown };

// ─────────────────────────────────────────────────────────────────────────────
// Server → client messages.
// ─────────────────────────────────────────────────────────────────────────────

export type ServerMsg =
  /** Handshake: announce modes/defaults and the negotiated protocol version. */
  | { type: "hello"; protocolVersion: number; modes: Mode[]; defaultMode: Mode }
  /** What the connected runtime lit up (LSP-style capability declaration). */
  | { type: "capabilities"; caps: Capabilities }
  /** Retained-mode canvas patch (the primary paint channel). */
  | { type: "patch"; ops: PatchOp[]; recalled?: number }
  /** v1 immediate-mode escape hatch — full HTML fragment repaint. */
  | { type: "render"; html: string; recalled?: number }
  /** v2 animated scene spec (played by an optional scene player). */
  | { type: "scene"; spec: Record<string, unknown>; recalled?: number }
  /** Surface a glass decision card; blocks the runtime until `answer`. */
  | { type: "ask"; id: string; question: string; options: AskOption[]; context?: string }
  /** Surface an Approve/Deny permission card; blocks until `decision`. */
  | { type: "permission"; id: string; tool: string; input: unknown }
  /** An ask/permission was resolved elsewhere (timeout, abort) — clear its card. */
  | { type: "resolved"; id: string; kind: "ask" | "permission"; outcome?: string }
  /** Quiet working indicator. `state` drives the pill; absent text = heartbeat. */
  | { type: "status"; state: "working" | "idle"; text?: string }
  /** Streaming activity feed row (a tool the runtime invoked this turn). */
  | { type: "tool"; id: string; name: string; input?: unknown }
  /** Context-meter usage update (model + token accounting). */
  | { type: "usage"; model?: string; contextUsed: number; contextWindow: number; pct: number }
  /** Session id captured from the runtime — browser persists + replays it. */
  | { type: "session"; id: string }
  /** A turn's final frame was committed to the frames log (timeline grew). */
  | { type: "frame"; n: number }
  /** Generic projection of a borrowed namespace (org.graph, agent.inbox, …). */
  | { type: "projection"; namespace: string; data: unknown }
  /** Turn ended. `code`/`stderr` surfaced so silent hangs aren't silent (G3). */
  | { type: "turn-end"; code?: number; stderr?: string }
  /** Recoverable error to toast in the UI. */
  | { type: "error"; message: string };

/** One option on a decision card. `value` is returned to the runtime verbatim. */
export interface AskOption {
  /** Button text (or input placeholder when `freeText`). */
  label: string;
  /** The instruction returned as the user's intent. May contain {user_input}. */
  value: string;
  /** Render a text input instead of a button. */
  freeText?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities — the LSP-style declaration that lights up affordances.
// ─────────────────────────────────────────────────────────────────────────────

export interface Capabilities {
  /** Protocol major the runtime/adapter speaks. Negotiated against the kernel. */
  protocolVersion: number;
  /** How the runtime delivers presentation calls (paint/ask/patch). */
  presentation: "mcp" | "sentinel" | "presenter";
  /** Whether the runtime can resume a prior session (threaded continuity). */
  resume: boolean;
  /** How a turn's end is detected. */
  turnBoundary: "result-event" | "process-exit" | "iterator-return";
  /** Whether the runtime routes tool-permission prompts back through the surface. */
  permissionPrompt: boolean;
  /** Capability namespaces advertised (standard + vendor). Empty = core only. */
  namespaces: string[];
  /**
   * Org tier — graceful degradation:
   *  A native fabric (durable agents + registry + messaging + spawn)
   *  B session orchestration (subagents within a turn; employees emulated)
   *  C single agent (no fabric; org features stay dark)
   */
  orgTier: "A" | "B" | "C";
}

// ─────────────────────────────────────────────────────────────────────────────
// Modes — the trust/permission posture of a connection.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * operator: full generation + tool access (trusted, single human).
 * team:     scoped generation + tools, attributable to a principal.
 * visitor:  generation OFF, tool access NONE, a curated pack only (untrusted).
 */
export type Mode = "operator" | "team" | "visitor";

/** Result of negotiating a remote protocol version against the local one. */
export interface VersionNegotiation {
  compatible: boolean;
  /** "exact" | "compatible-minor" | "incompatible" */
  outcome: "exact" | "compatible-minor" | "incompatible";
  local: number;
  remote: number;
}
