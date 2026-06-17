// Pack SDK — the public surface for AUTHORING a userspace app (a "pack"). A pack is
// a set of registered components + a layout + data wiring + an optional agent
// system-prompt fragment + a permission profile. Packs are userspace: low-trust and
// agent-authorable at runtime (the token-only component rule is what keeps that
// safe). The typed manifest shapes live in pack.d.ts; starter packs land in M5.

import { isMode } from "../protocol/messages.mjs";

/**
 * Structural validation of a PackManifest (see pack.d.ts). Shape only.
 * @param {any} m
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validatePackManifest(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, error: "manifest-not-object" };
  if (typeof m.name !== "string" || !m.name) return { ok: false, error: "manifest-needs-name" };
  if (typeof m.version !== "string" || !m.version) return { ok: false, error: "manifest-needs-version" };
  if (!Array.isArray(m.components)) return { ok: false, error: "manifest-needs-components-array" };
  if (m.layout == null || typeof m.layout !== "object" || Array.isArray(m.layout)) return { ok: false, error: "manifest-needs-layout" };
  // The trust posture a pack runs under must be a real mode (operator|team|visitor).
  if (!isMode(m.permissionProfile)) return { ok: false, error: "manifest-needs-valid-permissionProfile" };
  return { ok: true };
}

/**
 * Define a pack module: validate the manifest and pair it with an optional `seed`
 * hook (produces the initial patch ops to compose the workspace on install).
 * Throws on an invalid manifest — a pack is a unit of installable trust, so a
 * malformed one must fail at author/install time, not at mount time.
 *
 * @param {object} manifest a PackManifest
 * @param {() => import("../protocol/surface-protocol").PatchOp[]} [seed]
 * @returns {{manifest: object, seed?: Function}} a PackModule
 */
export function definePack(manifest, seed) {
  const v = validatePackManifest(manifest);
  if (!v.ok) throw new Error(`definePack: ${v.error}`);
  if (seed != null && typeof seed !== "function") {
    throw new TypeError("definePack: seed must be a function when provided");
  }
  return seed ? { manifest, seed } : { manifest };
}
