// Org Console — the userspace app for a Tier-A (native fabric) runtime. Unlike the
// other packs, this one barely composes anything itself: it seeds a single framing
// hero and then gets OUT OF THE WAY. The org chart and the agent inbox arrive as
// live PROJECTIONS from the runtime (org.graph + agent.inbox), which the kernel
// relays unchanged and the client mounts via generic renderers keyed by namespace
// (proj:org.graph → org-graph, proj:agent.inbox → inbox). So the pack frames a
// surface whose substance is filled by whatever native-fabric runtime is attached
// (orgmock here; a real fabric in production) — proof that org mode is runtime
// agnostic. Tap any node in the org chart to talk to it.

import { definePack } from "../../src/pack-sdk/index.mjs";

/** @type {import("../../src/pack-sdk/pack").PackManifest} */
const manifest = {
  name: "org-console",
  version: "1.0.0",
  // The components this surface relies on being registered: the framing hero plus
  // the two generic projection renderers the runtime's org.graph / agent.inbox feed.
  components: ["hero", "org-graph", "inbox"],
  layout: { columns: 4 },
  permissionProfile: "operator",
  agentInstructions:
    "This is an org console over a Tier-A (native fabric) runtime. The org chart "
    + "(proj:org.graph) and inbox (proj:agent.inbox) are LIVE projections from the "
    + "runtime — do not re-mount or fabricate them; the kernel paints them from the "
    + "runtime's projection stream. Keep the framing hero (oc-hero) glanceable and "
    + "update it in place by id. To act on a node, talk to it (the org chart's nodes "
    + "are tappable); surface any decision through ask, never the terminal.",
};

export const pack = definePack(manifest, () => [
  // The one tile this pack owns: a framing hero. The org-graph + inbox land beside
  // it as live projections, so the pack only sets the stage and the layout.
  {
    op: "mount",
    id: "oc-hero",
    component: "hero",
    props: {
      label: "Org Console",
      value: "Talk to any node",
      body: "A native-fabric runtime drives this surface. The org chart and inbox below "
        + "are live projections from it — tap any node in the chart to talk to that agent.",
    },
  },
]);

export default pack;
