/**
 * AgentAdapter — the borrowed-fabric seam. Surface owns the surface; an adapter
 * teaches it to drive ONE agent runtime (Claude Code, Hermes, selfworking.ai CLI,
 * an in-process echo, …). Surface writes no agent logic, memory, or orchestration;
 * the adapter translates a runtime's native stream into canonical {@link TurnEvent}s
 * and declares what the runtime can do via {@link Capabilities}.
 *
 * Design note (refinement of the build plan's spawn()/parseStream()):
 *   The plan sketched a subprocess-shaped adapter (`spawn(): ChildProcess` +
 *   `parseStream(stdout)`). We refine that to a single runtime-agnostic
 *   `run(input): AsyncIterable<TurnEvent>` — because Surface's thesis is that NOT
 *   every runtime is a subprocess (some are HTTP, in-process, or remote). A
 *   subprocess adapter still spawns + parses internally (using the `ndjson` +
 *   `resolveBin` helpers); an in-process adapter just yields events directly.
 *   See docs/adr/0001-adapter-run-iterator.md.
 */

import type { Capabilities, PatchOp, AskOption } from "../protocol/surface-protocol";

/** Canonical, runtime-neutral events an adapter yields during one turn. */
export type TurnEvent =
  /** The runtime started/resumed a session. Surface persists the id (G11/G12). */
  | { kind: "session_started"; id: string }
  /** Streaming assistant text (optional; surfaced as quiet activity, not chat). */
  | { kind: "text_delta"; text: string }
  /** The runtime invoked a tool — surfaced in the activity feed. */
  | { kind: "tool_call"; id?: string; name: string; args?: unknown }
  /** Retained-mode canvas patch (the primary paint channel). */
  | { kind: "patch"; ops: PatchOp[] }
  /** v1 immediate-mode escape hatch. */
  | { kind: "render"; html: string }
  /** v2 animated scene spec. */
  | { kind: "scene"; spec: Record<string, unknown> }
  /** A projection of a borrowed namespace (org.graph, agent.inbox, …). */
  | { kind: "projection"; namespace: string; data: unknown }
  /** Token/usage accounting for the context meter. */
  | { kind: "usage"; model?: string; inputTokens?: number; outputTokens?: number }
  /** A quiet status line. */
  | { kind: "status"; text?: string }
  /** The turn finished cleanly. */
  | { kind: "turn_done"; code?: number }
  /** A recoverable error (surfaced to the UI; never a silent hang — G3). */
  | { kind: "error"; message: string };

/**
 * Per-turn services the kernel hands the adapter — the bidirectional side
 * channels that a plain event stream can't express (they need a response).
 */
export interface TurnContext {
  /** The session id threaded into this turn (null on the first turn). */
  sessionId: string | null;
  /** The working mode of the connection driving this turn. */
  mode: "operator" | "team" | "visitor";
  /** The authenticated principal (or null in single-operator mode). */
  principal: Principal | null;
  /**
   * Opaque capability token for the attributed principal (base64url). Carried
   * into the runtime on spawn so every runtime action can be attributed +
   * attenuated against the principal's ceiling. See identity.capabilityToken().
   */
  capabilityToken: string;
  /**
   * Loopback side channel for runtimes that present OUT-OF-BAND (e.g. the Claude
   * adapter's MCP server POSTs presentation/decisions to `${baseUrl}/mcp/*`
   * with the per-turn `token`). `session` is the live session id (getter).
   */
  sideChannel: { baseUrl: string; token: string; readonly session: string | null };
  /** Surface a decision card and await the user's choice. Blocks the turn. */
  ask(question: string, options: AskOption[], context?: string): Promise<AskAnswer>;
  /** Surface an Approve/Deny permission card and await the decision. */
  requestPermission(tool: string, input: unknown): Promise<PermissionDecision>;
  /** Request a composite screenshot of the live surface (dashboard + markup). */
  screenshot(): Promise<ScreenshotResult>;
  /** Push a TurnEvent out-of-band (e.g. from an MCP side channel callback). */
  emit(event: TurnEvent): void;
  /** Aborted when the user cancels the turn or disconnects. */
  signal: AbortSignal;
}

export interface AskAnswer {
  label?: string;
  value?: string;
  cancelled?: boolean;
  reason?: string;
}

export interface PermissionDecision {
  behavior: "allow" | "deny";
  updatedInput?: unknown;
  message?: string;
}

export interface ScreenshotResult {
  ok: boolean;
  /** data: URL of the composited PNG, when ok. */
  dataUrl?: string;
  /** Human labels of the tiles the user's drawing overlapped. */
  annotated?: string[];
  reason?: string;
}

export interface Principal {
  id: string;
  display?: string;
  /** Capabilities this human may grant (the authority ceiling). */
  ceiling: string[];
  provider?: string;
}

export interface AgentAdapter {
  /** Stable adapter name (e.g. "claude-code", "echo"). */
  name: string;
  /** What this runtime lights up. Drives graceful degradation + affordances. */
  capabilities: Capabilities;
  /**
   * Drive exactly one turn. Yields canonical TurnEvents until `turn_done`.
   * Subprocess adapters spawn + parse internally; in-process ones yield directly.
   */
  run(input: { prompt: string; ctx: TurnContext }): AsyncIterable<TurnEvent>;
  /** Optional one-time setup (e.g. resolve the binary, warm a connection). */
  init?(): Promise<void>;
  /** Optional binary resolver for subprocess runtimes (gotcha G1). */
  resolveBin?(): Promise<string>;
}

/** Factory convention: adapters export a `(opts) => AgentAdapter` factory. */
export type AdapterFactory<O = unknown> = (opts?: O) => AgentAdapter;
