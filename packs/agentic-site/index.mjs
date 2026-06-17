// Agentic Site — a PUBLIC, curated, locked-down surface (the visitor persona).
// This is the canvas a visitor sees. It is deliberately welcoming and read-only:
// a hero, a couple of info tiles, and a single status pill — composed only from
// REGISTERED built-in components (hero/text/metric/status).
//
// Visitor mode is the kernel-enforced safety property: generation is OFF and tools
// are NONE for a visitor connection (see src/kernel/server.mjs — a {type:"prompt"}
// in visitor mode is rejected with an error). So this pack IS the curated surface
// a visitor sees; the visitor cannot drive the agent to change it. A richer
// "interactive visitor" — compose-only prompting against a tight allowlist of
// registered components — is a documented future refinement (see
// docs/authoring-packs.md), not part of this locked-down starter.

import { definePack } from "../../src/pack-sdk/index.mjs";

/** @type {import("../../src/pack-sdk/pack").PackManifest} */
const manifest = {
  name: "agentic-site",
  version: "1.0.0",
  components: ["hero", "text", "metric", "status"],
  layout: { columns: 4 },
  permissionProfile: "visitor",
  agentInstructions:
    "This surface is visitor-facing and curated. Compose ONLY from registered "
    + "built-in components and keep the canvas welcoming, calm, and read-only. "
    + "Visitor mode disables generation and grants no tools (kernel-enforced), so "
    + "treat this composition as the public face of the project — do not expose "
    + "internal state, and never invent components or props.",
};

export const pack = definePack(manifest, () => [
  // Welcoming full-width hero — the front door.
  {
    op: "mount",
    id: "site-hero",
    component: "hero",
    props: {
      label: "Welcome",
      value: "Built on Surface",
      body: "A glanceable, agent-operated console. This is the public, curated view.",
    },
  },
  // A short "what this is" info tile.
  {
    op: "mount",
    id: "site-about",
    component: "text",
    props: {
      label: "What this is",
      text: "Surface turns an agent CLI into an ambient operator console — a calm, "
        + "composable canvas instead of a wall of text. This page is the visitor view.",
    },
  },
  // A friendly how-it-works tile.
  {
    op: "mount",
    id: "site-how",
    component: "text",
    props: {
      label: "How it works",
      text: "An agent composes registered glass components into a dashboard and "
        + "patches it in place. Decisions surface as tappable cards, never buried prompts.",
    },
  },
  // One headline info metric — a public, non-sensitive number.
  {
    op: "mount",
    id: "site-uptime",
    component: "metric",
    props: { label: "Uptime", value: "99.9%", tone: "good" },
  },
  // A single status pill confirming the surface is live.
  {
    op: "mount",
    id: "site-status",
    component: "status",
    props: { label: "Status", value: "Live · curated view", tone: "good" },
  },
]);

export default pack;
