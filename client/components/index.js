// The design-system registry (client side). Importing this DEFINES every built-in
// Web Component (as a side effect of each module) and exposes their manifests +
// a name→tag resolver the reconciler uses. The kernel's server-side Registry holds
// the same manifests (and enforces token-only styles at registration).

import { manifest as metric } from "./metric.js";
import { manifest as hero } from "./hero.js";
import { manifest as list } from "./list.js";
import { manifest as status } from "./status.js";
import { manifest as text } from "./text.js";
import { manifest as kv } from "./kv.js";
import { manifest as orgGraph } from "./org-graph.js";
import { manifest as inbox } from "./inbox.js";
import { manifest as fallback } from "./fallback.js";

/** All built-in component manifests (each carries its validated `styles`). */
export const MANIFESTS = [metric, hero, list, status, text, kv, orgGraph, inbox, fallback];

const TAGS = new Set(MANIFESTS.map((m) => "surface-" + m.name));

/** Resolve a component name to its custom-element tag, or the fallback tag. */
export function tagFor(name) {
  const tag = "surface-" + String(name || "");
  return TAGS.has(tag) && tag !== "surface-fallback" ? tag : "surface-fallback";
}

/** Whether a component name maps to a real (non-fallback) registered element. */
export function isRegistered(name) {
  const tag = "surface-" + String(name || "");
  return TAGS.has(tag) && tag !== "surface-fallback";
}
