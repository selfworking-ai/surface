// Mission Control — a personal mission console (the operator persona). A single
// person's day at a glance: what's in focus, what's queued, how the streak is
// holding, and whether the system underneath is healthy. Composed entirely from
// REGISTERED built-in components (hero/metric/list/status) — this pack arranges,
// it does not generate. Stable ids so the operating agent updates tiles in place
// rather than re-mounting them each turn.

import { definePack } from "../../src/pack-sdk/index.mjs";

/** @type {import("../../src/pack-sdk/pack").PackManifest} */
const manifest = {
  name: "mission-control",
  version: "1.0.0",
  // Names of the built-in components this pack mounts (all must be registered).
  components: ["hero", "metric", "list", "status"],
  layout: { columns: 4 },
  permissionProfile: "operator",
  agentInstructions:
    "This is a personal mission-control surface for a single operator. Keep every "
    + "tile glanceable — a person should grasp the whole canvas in ~2 seconds. "
    + "Update tiles in place by their stable ids (mc-hero, mc-focus, mc-tasks, "
    + "mc-streak, mc-priorities, mc-system); never re-mount what already exists. "
    + "Summarize; never dump walls of text into a tile. Surface decisions through "
    + "ask, never the terminal.",
};

export const pack = definePack(manifest, () => [
  // Full-width hero anchors the surface with today's standing.
  {
    op: "mount",
    id: "mc-hero",
    component: "hero",
    props: {
      label: "Mission Control",
      value: "On track",
      body: "Your day at a glance. Focus is holding and the queue is light.",
    },
  },
  // The three pulse metrics — focus, today's load, and the consistency streak.
  {
    op: "mount",
    id: "mc-focus",
    component: "metric",
    props: { label: "Focus", value: "Deep work", delta: "block 2 of 3", tone: "good" },
  },
  {
    op: "mount",
    id: "mc-tasks",
    component: "metric",
    props: { label: "Tasks Today", value: "4", delta: "2 done" },
  },
  {
    op: "mount",
    id: "mc-streak",
    component: "metric",
    props: { label: "Streak", value: "12 days", tone: "good" },
  },
  // Today's priorities — the short list that defines the day.
  {
    op: "mount",
    id: "mc-priorities",
    component: "list",
    props: {
      label: "Today's priorities",
      items: ["Ship the M5 packs", "Review pull requests", "30 min reading", "Plan tomorrow"],
    },
  },
  // System health — the one tile that says whether anything needs attention.
  {
    op: "mount",
    id: "mc-system",
    component: "status",
    props: { label: "System", value: "All systems nominal", tone: "good" },
  },
]);

export default pack;
