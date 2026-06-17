// Permissions — the kernel's authority boundary, expressed as the containment
// chain from the design:
//
//     component.caps  ⊆  mode.grantable  ⊆  principal.ceiling
//
// A capability is grantable to a running component only if (a) the connection's
// MODE is allowed to grant it AND (b) the authenticated PRINCIPAL's ceiling covers
// it. Modes set the policy posture; the principal sets the absolute hard cap. The
// runtime enforces attenuation WITHIN its agent tree (spawned ≤ spawner) — that's
// runtime-owned; here we only decide what Surface itself hands across the seam.
//
// `"*"` is the wildcard ceiling (operator / single-human local default). Capability
// names are opaque strings (e.g. "network", "fs:write", "agent.spawn"); we match by
// exact string, with `"*"` meaning "any".

import { MODES, isMode } from "../protocol/messages.mjs";

// Re-export the canonical mode list/predicate so callers have one import for the
// whole permission surface (modes live in the protocol — single source of truth).
export { MODES, isMode };

/**
 * Per-mode capability sets — what each working mode is ALLOWED to grant.
 *  operator : everything (trusted single human at the console) → wildcard.
 *  team     : a scoped, attributable set (no destructive/system-level grants).
 *  visitor  : nothing — generation OFF, tools NONE, curated pack only (untrusted).
 *
 * These are the mid-link of the containment chain. M1 keeps the `team` set
 * deliberately small + conservative; packs widen it per-pack later (M5).
 */
export const GRANTABLE = Object.freeze({
  operator: ["*"],
  team: ["render", "ask", "read", "compose", "network:scoped"],
  visitor: [],
});

/** True if a capability set (array, or ["*"]) covers `capability`. */
function setCovers(set, capability) {
  if (!Array.isArray(set)) return false;
  if (set.includes("*")) return true;
  return set.includes(capability);
}

/**
 * Decide whether `capability` may be granted to a component, given the connection
 * `mode` and the principal's authority `ceiling`. Implements
 * `component.caps ⊆ mode.grantable ⊆ principal.ceiling`: the capability must clear
 * BOTH gates.
 *
 * @param {string} capability  the capability a component is requesting
 * @param {import("../protocol/surface-protocol").Mode} mode  the connection's locked mode
 * @param {string[]} [ceiling]  the principal's authority ceiling (default ["*"], single-operator)
 * @returns {boolean}
 */
export function canGrant(capability, mode, ceiling = ["*"]) {
  if (typeof capability !== "string" || !capability) return false;
  if (!isMode(mode)) return false;
  const grantable = GRANTABLE[mode] || [];
  // mode.grantable must allow it AND principal.ceiling must cover it.
  return setCovers(grantable, capability) && setCovers(ceiling, capability);
}

/**
 * Whether a mode permits runtime GENERATION (authoring new components / free HTML)
 * at all. Visitor mode is curated-only: it composes pre-registered components but
 * never generates — the property that makes a public-facing surface safe.
 * @param {import("../protocol/surface-protocol").Mode} mode
 * @returns {boolean}
 */
export function modeAllowsGeneration(mode) {
  return isMode(mode) && mode !== "visitor";
}
