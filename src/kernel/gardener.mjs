// Gardener — the signal-gated REVIEW half of self-improvement. It mutates nothing:
// it READS recorded signals and PROPOSES which components need a revised version.
// Promotion is gated (an operator/agent acts on a proposal; the smith registers a
// NEW version, never mutating a live mount).
//
// The plan's caveat, taken seriously: "the signal is the hard part — design it
// first or it's theater." So the gardener operates ONLY on real, observed signals,
// never on vibes:
//   render-error      a patch op was rejected / a component failed to render
//   unknown-component the agent mounted a name the client had to fall back on
//   markup            a user drew on the component (confusion or interest)
//   dismiss           the component was removed quickly (low utility)
//   dwell             the component stayed on screen a while (healthy — credit)

const WEIGHT = { "render-error": 5, "unknown-component": 4, markup: 2, dismiss: 1 };
const DWELL_CREDIT_PER_MS = 0.0005; // long dwell offsets noise; capped below
const DWELL_CREDIT_CAP = 3;

/**
 * Aggregate signal records per component and propose revisions for those whose
 * negative signal clears `minScore`. Pure; returns a GATED proposal list (sorted,
 * highest-need first) — never applies anything.
 * @param {Array<{ts?:number, kind:string, component?:string, data?:object}>} records
 * @param {{ minScore?: number }} [opts]
 * @returns {Array<{component:string, score:number, signals:object, reason:string, action:"propose-revision"}>}
 */
export function reviewSignals(records, { minScore = 3 } = {}) {
  const list = Array.isArray(records) ? records : [];
  const byComp = new Map();
  for (const r of list) {
    if (!r || typeof r.kind !== "string") continue;
    const comp = r.component || r.data?.component || "(unknown)";
    let e = byComp.get(comp);
    if (!e) { e = { component: comp, score: 0, counts: {} }; byComp.set(comp, e); }
    e.counts[r.kind] = (e.counts[r.kind] || 0) + 1;
    if (r.kind === "dwell") {
      e.score -= Math.min(DWELL_CREDIT_CAP, (r.data?.ms || 0) * DWELL_CREDIT_PER_MS); // healthy → reduces need
    } else {
      e.score += WEIGHT[r.kind] ?? 0;
    }
  }
  return [...byComp.values()]
    .filter((e) => e.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map((e) => ({
      component: e.component,
      score: Math.round(e.score * 100) / 100,
      signals: e.counts,
      reason: reasonFor(e.counts),
      action: "propose-revision", // GATED — a proposal, never an auto-apply
    }));
}

function reasonFor(counts) {
  if (counts["render-error"]) return "render errors — the component or its props failed to render";
  if (counts["unknown-component"]) return "referenced but unregistered — a candidate to author";
  if (counts.markup) return "users mark it up — possible confusion; review legibility";
  if (counts.dismiss) return "dismissed quickly — low utility; review or demote";
  return "accumulated negative signal";
}
