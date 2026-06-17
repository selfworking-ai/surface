/**
 * Manifests — Components, Packs, and the Agent PROJECTION.
 *
 * Component  = one Web Component block on the canvas (shadow-DOM isolated; tokens
 *              cascade via CSS custom properties). Registered with a manifest.
 * Pack       = a userspace app: a set of components + layout + data wiring +
 *              optional agent system-prompt fragment + a permission profile.
 * AgentManifest = a PROJECTION of a runtime-owned agent (NOT a source of truth);
 *              Surface caches it to render org topology but the runtime owns it.
 *
 * Components/packs are userspace (low-trust, agent-authorable). The token-only
 * rule (`tokensOnly: true`, enforced at registration — M3) is what makes runtime
 * generation survivable: registration REJECTS hardcoded colors/radii.
 */

/** A minimal JSON-Schema-ish shape (we validate structurally, not with a lib). */
export type JSONSchema = Record<string, unknown>;

export interface ComponentManifest {
  name: string;
  version: string;
  /** Prop schema (validated at mount). */
  props: JSONSchema;
  /** Topics this component publishes/subscribes on the data broker. */
  dataContract?: { topics: string[] };
  /** Required capabilities, e.g. ["network:none", "render"]. */
  capabilities: string[];
  /** Enforced at registration — only design tokens, no hardcoded values. */
  tokensOnly: true;
}

export interface PackManifest {
  name: string;
  version: string;
  /** Component names this pack mounts (must be registered). */
  components: string[];
  /** Initial layout spec seeded on install. */
  layout: Record<string, unknown>;
  /** Optional broker wiring (topic → source bindings). */
  dataWiring?: Record<string, unknown>;
  /** System-prompt fragment appended for agents operating this pack. */
  agentInstructions?: string;
  /** The trust posture this pack runs under. */
  permissionProfile: "operator" | "team" | "visitor";
}

/** PROJECTION of a runtime-owned agent. Cached for rendering; not authoritative. */
export interface AgentManifest {
  id: string;
  role: string;
  reportsTo?: string;
  /** The authority ceiling for this agent (attenuation enforced by the runtime). */
  authorityCeiling: string[];
  spawnableRoles?: string[];
  inboxTopic?: string;
  schedule?: Record<string, unknown>;
}

/** What a pack module default-exports (manifest + optional install hook). */
export interface PackModule {
  manifest: PackManifest;
  /** Optional: produce the initial patch ops to seed the workspace on install. */
  seed?(): import("../protocol/surface-protocol").PatchOp[];
}
