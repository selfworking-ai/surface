// Business OS — a business operating console (the team persona). The state of a
// business a small team can run at a glance: revenue, customers, and runway up
// top (toned so trouble shows itself), the key facts that frame the quarter, the
// week's commitments, and where the pipeline stands. Composed only from REGISTERED
// built-in components (metric/kv/list/status). Stable ids so the operating agent
// updates the numbers in place each turn rather than re-mounting tiles.

import { definePack } from "../../src/pack-sdk/index.mjs";

/** @type {import("../../src/pack-sdk/pack").PackManifest} */
const manifest = {
  name: "business-os",
  version: "1.0.0",
  components: ["metric", "kv", "list", "status"],
  layout: { columns: 4 },
  permissionProfile: "team",
  agentInstructions:
    "You operate a business OS for a small team. Attribute every action to the "
    + "team principal and be conservative — surface the real numbers, flag risk "
    + "with tone (warn/bad), and never overstate. Keep tiles glanceable and update "
    + "them in place by their stable ids (biz-revenue, biz-customers, biz-runway, "
    + "biz-facts, biz-week, biz-pipeline). Route any decision through ask, never "
    + "the terminal.",
};

export const pack = definePack(manifest, () => [
  // The three headline numbers — revenue, customers, runway. Runway carries a
  // warn tone so a tightening month is visible without reading the value.
  {
    op: "mount",
    id: "biz-revenue",
    component: "metric",
    props: { label: "Revenue (MRR)", value: "$48.2k", delta: "+6.4% MoM", tone: "good" },
  },
  {
    op: "mount",
    id: "biz-customers",
    component: "metric",
    props: { label: "Customers", value: "312", delta: "+9 this month", tone: "good" },
  },
  {
    op: "mount",
    id: "biz-runway",
    component: "metric",
    props: { label: "Runway", value: "11 mo", delta: "watch burn", tone: "warn" },
  },
  // Key facts that frame the operating context — kept terse.
  {
    op: "mount",
    id: "biz-facts",
    component: "kv",
    props: {
      label: "Key facts",
      pairs: [
        { k: "Stage", v: "Seed, post-revenue" },
        { k: "Team", v: "6 people" },
        { k: "Net churn", v: "1.8% / mo" },
        { k: "Top channel", v: "Inbound" },
      ],
    },
  },
  // This week's commitments — the short operating list.
  {
    op: "mount",
    id: "biz-week",
    component: "list",
    props: {
      label: "This week",
      items: ["Close 2 enterprise trials", "Ship billing v2", "Hire support lead", "Board update"],
    },
  },
  // Pipeline health at a glance.
  {
    op: "mount",
    id: "biz-pipeline",
    component: "status",
    props: { label: "Pipeline", value: "Healthy · 14 active deals", tone: "good" },
  },
]);

export default pack;
