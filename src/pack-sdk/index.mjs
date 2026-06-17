// Pack SDK — the public surface for AUTHORING a userspace app (a "pack"). A pack is
// a set of registered components + a layout + data wiring + an optional agent
// system-prompt fragment + a permission profile. Packs are userspace: low-trust and
// agent-authorable at runtime (the token-only component rule is what keeps that
// safe). The typed manifest shapes live in pack.d.ts; starter packs land in M5.

import { isMode, validatePatch } from "../protocol/messages.mjs";

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

/**
 * Install a pack: register any component manifests it ships, then seed the
 * workspace with its layout + initial composition. Returns the applied patch ops
 * (so the kernel can broadcast them). Idempotent-ish via the reconciler's upsert
 * semantics — re-installing replaces the pack's nodes by id.
 *
 * @param {{manifest:object, seed?:Function, componentManifests?:object[]}} pack
 * @param {{ workspace?: import("../kernel/workspace").Workspace, registry?: import("../kernel/registry").Registry }} [ctx]
 * @returns {import("../protocol/surface-protocol").PatchOp[]} the applied ops
 */
export function installPack(pack, { workspace, registry } = {}) {
  if (!pack || !pack.manifest) throw new Error("installPack: a pack module { manifest, seed? } is required");
  const v = validatePackManifest(pack.manifest);
  if (!v.ok) throw new Error(`installPack: ${v.error}`);
  // Register any component manifests the pack ships (built-in-only packs ship none;
  // registration is the token-only trust gate — a bad component throws here).
  if (registry && Array.isArray(pack.componentManifests)) {
    for (const cm of pack.componentManifests) registry.register(cm);
  }
  // Seed: the pack's layout first, then its initial composition.
  const ops = [];
  if (pack.manifest.layout && Object.keys(pack.manifest.layout).length) {
    ops.push({ op: "layout", spec: pack.manifest.layout });
  }
  if (typeof pack.seed === "function") ops.push(...pack.seed());
  if (workspace && ops.length) workspace.applyOps(ops);
  return ops;
}

/**
 * Serialize a pack to a portable JSON object ({manifest, ops}). The seed function
 * is materialized to a static op list so the pack travels as data (export/import).
 * @param {{manifest:object, seed?:Function}} pack
 */
export function exportPack(pack) {
  if (!pack || !pack.manifest) throw new Error("exportPack: a pack module is required");
  return {
    manifest: pack.manifest,
    ops: typeof pack.seed === "function" ? pack.seed() : [],
  };
}

/**
 * Reconstruct a pack module from its exported JSON form. Validates the manifest +
 * the op list (so an imported pack can't smuggle malformed ops past the reconciler).
 * @param {{manifest:object, ops?:object[]}} json
 * @returns {{manifest:object, seed:Function}}
 */
export function importPack(json) {
  if (!json || typeof json !== "object") throw new Error("importPack: object required");
  const ops = Array.isArray(json.ops) ? json.ops : [];
  const p = validatePatch(ops);
  if (!p.ok) throw new Error(`importPack: invalid ops — ${p.error}`);
  return definePack(json.manifest, () => ops.map((o) => ({ ...o })));
}
