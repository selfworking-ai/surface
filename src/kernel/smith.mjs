// Component-smith — the AUTHORING half of self-improvement, COMPOSE-FIRST. Most
// needs are met by arranging registered components (cheap, deterministic, safe);
// authoring a NEW one is the rare, gated path. The smith (1) searches the registry
// first, (2) validates a PROPOSED component (token-only + manifest) BEFORE it's
// registered, and (3) only ever yields a NEW version — it never mutates a live mount.
//
// The actual GENERATION of a new component's code is the CONSOLE AGENT's job (a
// subagent it spawns). This module is the search + the safety gate around it — the
// part that must be deterministic and trustworthy, not generative.

import { validateComponentManifest } from "./registry.mjs";
import { tokenViolationReason } from "../../client/components/token-validator.mjs";

/**
 * Compose-first: is a registered component already enough for `need`? Match by name,
 * else by required capabilities. Returns the manifest to reuse, or null (→ the rare
 * authoring path).
 * @param {string | {name?:string, capabilities?:string[]}} need
 * @param {import("./registry").Registry} registry
 */
export function findComponent(need, registry) {
  if (!registry) return null;
  const name = typeof need === "string" ? need : need?.name;
  if (name && registry.has(name)) return registry.get(name).manifest;
  const want = (typeof need === "object" && Array.isArray(need?.capabilities)) ? need.capabilities : [];
  if (want.length) {
    for (const m of registry.list()) {
      if (want.every((c) => (m.capabilities || []).includes(c))) return m;
    }
  }
  return null;
}

/**
 * Validate a PROPOSED component before it is registered — the gate that keeps
 * runtime generation survivable: manifest shape + token-only styles. Returns
 * `{ ok, errors }`. (The registry enforces the same at `register()`; the smith
 * checks here so a bad proposal is rejected before it ever reaches the catalog.)
 * @param {{ manifest?: object, styles?: string } | object} spec a manifest, or { manifest, styles }
 */
export function validateProposedComponent(spec) {
  if (!spec || typeof spec !== "object") return { ok: false, errors: ["spec-not-object"] };
  const manifest = spec.manifest || spec;
  const errors = [];
  const v = validateComponentManifest(manifest);
  if (!v.ok) errors.push(v.error);
  const styles = spec.styles ?? manifest.styles;
  if (styles != null) {
    const reason = tokenViolationReason(String(styles));
    if (reason) errors.push(reason);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The next patch version for a manifest — the smith registers a NEW version, never
 * overwriting the live one (gated promotion decides which version a mount uses).
 * @param {string} version semver-ish "x.y.z"
 */
export function nextVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ""));
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.1";
}
