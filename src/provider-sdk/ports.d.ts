/**
 * Provider ports — the privileged extension plane. Providers supply SYSTEM
 * capabilities (auth, identity, storage, audit, transport, connectors) behind
 * kernel ports. They are trusted, vetted/signed, and CONFIGURED by the agent at
 * runtime but never AUTHORED by it (contrast: apps/packs are userspace, low-trust,
 * agent-authorable). Decision rule: touches trust / persistence / transport →
 * provider behind a port; composes on the canvas + safe at runtime → app/pack.
 *
 * v1 (M1) ships only the default {@link StorageProvider} (jsonl-on-disk). The
 * rest are defined here so M4 implementations target a stable contract.
 */

import type { Principal } from "../adapter-sdk/adapter";

/** A turn-history frame (one committed dashboard). The time-travel unit. */
export interface Frame {
  /** 1-based turn number within the session. */
  n: number;
  /** ISO timestamp the frame was committed. */
  ts: string;
  /** The prompt that produced this turn. */
  prompt: string;
  /**
   * The committed presentation. For retained-mode turns we store a self-contained
   * `snapshot` of the workspace AFTER the turn — so time-travel/recall rebuilds the
   * canvas at turn N without folding the whole history. `html`/`spec` carry the v1
   * escape-hatch / v2 scene frames instead.
   */
  snapshot?: WorkspaceSnapshot | null;
  html?: string | null;
  spec?: Record<string, unknown> | null;
}

/** A workspace document snapshot (the durable retained-mode composition). */
export interface WorkspaceSnapshot {
  components: Array<{ id: string; component: string; props?: object; slot?: string; at?: number }>;
  layout: Record<string, unknown>;
}

/**
 * StorageProvider — persistence of PRESENTATION (frames + workspace + kv). Surface
 * never persists cognition or org state (the runtime owns those). The default
 * impl is jsonl-on-disk; swap for Postgres/Redis/etc. behind this port.
 */
export interface StorageProvider {
  id: string;
  /** Generic kv get/put (session metadata, layout prefs). */
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  /** Append one frame to a session's frames log. */
  appendFrame(session: string, frame: Frame): Promise<void>;
  /** List a session's frames (oldest → newest). */
  listFrames(session: string): Promise<Frame[]>;
  /** Persist / load the durable workspace document for a session. */
  saveWorkspace?(session: string, snapshot: WorkspaceSnapshot): Promise<void>;
  loadWorkspace?(session: string): Promise<WorkspaceSnapshot | null>;
}

/** AuthProvider — establishes a human Principal (SSO/OIDC). [M4] */
export interface AuthProvider {
  id: string;
  begin(req: unknown): Promise<AuthChallenge>;
  complete(req: unknown): Promise<Principal>;
}
export interface AuthChallenge {
  /** Where to redirect / what to present to the human. */
  redirect?: string;
  challenge?: unknown;
}

/** IdentityProvider — registers/verifies a principal (WebAuthn/passkey). [M4] */
export interface IdentityProvider {
  id: string;
  register(p: Principal): Promise<void>;
  verify(req: unknown): Promise<Principal>;
}

/** AuditSink — every runtime action carries Surface's principal token here. [M4] */
export interface AuditSink {
  id?: string;
  record(e: {
    principal: string;
    action: string;
    agent?: string;
    ts: number;
    data?: unknown;
  }): Promise<void>;
}

/**
 * SignalSink — every REAL, observed self-improvement signal lands here (render-
 * error, unknown-component, markup, dwell/dismiss). The gardener aggregates these
 * into GATED revision proposals; the smith validates a proposed component before a
 * NEW version is registered. "The signal is the hard part" — only genuine
 * observations, never vibes. Fire-and-forget; `record()` must never throw. [M7]
 */
export interface SignalSink {
  id?: string;
  record(s: {
    kind: string;
    component?: string | null;
    ts: number;
    data?: unknown;
  }): Promise<void>;
}

/** TransportProvider — swap the ws hub for sse/etc. behind this port. [later] */
export interface TransportProvider {
  id: string;
  /** Implementation-defined; the kernel adapts its broadcast to this. */
  [k: string]: unknown;
}

/** ConnectorProvider — external systems (Slack/Stripe) → tools + broker topics. */
export interface ConnectorProvider {
  id: string;
  tools(): ToolDef[];
  topics(): string[];
}
export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: object;
}

/** The bundle of providers a host wires into the kernel. */
export interface ProviderSet {
  storage?: StorageProvider;
  auth?: AuthProvider;
  identity?: IdentityProvider;
  audit?: AuditSink;
  signals?: SignalSink;
  transport?: TransportProvider;
  connectors?: ConnectorProvider[];
}
