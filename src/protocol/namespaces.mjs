// Capability namespaces (the LSP-model extension planes). The core protocol is
// guaranteed for every runtime; namespaces are opt-in, lit up by what an adapter
// advertises in its Capabilities. Surface ships GENERIC renderers for `standard`
// namespaces (M6); `vendor` namespaces are a passthrough escape hatch the runtime
// renders with its own pack.
//
// This module is the registry + light projection validator. The generic renderers
// and the org-chart pack land in M6; here we pin the names and shapes so adapters
// and packs target a stable contract.

/** Standard namespaces — Surface provides generic renderers. */
export const STANDARD_NAMESPACES = /** @type {const} */ ([
  "org.graph",      // the org as a graph of agents/roles (projection of runtime truth)
  "agent.spawn",    // spawn a (sub)agent
  "agent.message",  // agent-to-agent messaging
  "agent.inbox",    // an agent's inbox projection
  "schedule",       // scheduled triggers / cron
  "memory",         // memory surfaces
]);

/** Vendor namespaces follow `vendor.feature`; rendered by the vendor's own pack. */
export const VENDOR_PREFIXES = /** @type {const} */ (["claude", "hermes", "selfworking"]);

/** True for a recognized standard namespace. */
export function isStandardNamespace(ns) {
  return STANDARD_NAMESPACES.includes(ns);
}

/** True for a vendor-namespaced capability (e.g. "claude.subagents"). */
export function isVendorNamespace(ns) {
  if (typeof ns !== "string" || !ns.includes(".")) return false;
  return VENDOR_PREFIXES.includes(ns.split(".", 1)[0]);
}

/** True for any namespace Surface understands enough to route. */
export function isKnownNamespace(ns) {
  if (typeof ns !== "string" || !ns) return false;
  // Match exact standard names and any `standard.sub` (e.g. "org.graph").
  if (isStandardNamespace(ns)) return true;
  if (STANDARD_NAMESPACES.some((s) => ns === s || ns.startsWith(s + "."))) return true;
  return isVendorNamespace(ns);
}

/**
 * Light validation of a `projection` payload before it reaches a renderer.
 * Generic renderers expect `{ namespace, data }`; vendor passthroughs only need
 * a namespace + opaque data (the vendor pack interprets it).
 * @param {{namespace?:string, data?:unknown}} p
 * @returns {{ok:true, generic:boolean} | {ok:false, error:string}}
 */
export function validateProjection(p) {
  if (!p || typeof p !== "object") return { ok: false, error: "projection-not-object" };
  if (typeof p.namespace !== "string" || !p.namespace) return { ok: false, error: "projection-needs-namespace" };
  if (!("data" in p)) return { ok: false, error: "projection-needs-data" };
  if (!isKnownNamespace(p.namespace)) return { ok: false, error: `unknown-namespace:${p.namespace}` };
  return { ok: true, generic: !isVendorNamespace(p.namespace) };
}
