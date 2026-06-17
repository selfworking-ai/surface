// orgmock — a SECOND runtime adapter that exists to prove Surface's thesis:
// swap the runtime, change NOTHING in the kernel. Where echo is Tier C (single
// agent) and claude-code is Tier B (session orchestration), orgmock advertises
// Tier A (native fabric) + the `standard` org namespaces, and emits `projection`
// events for org.graph + agent.inbox. The kernel broadcasts those unchanged; the
// CLIENT renders them with GENERIC renderers (namespace → component) — so a
// brand-new Tier-A runtime lights up org mode with no kernel and no bespoke UI.
//
// It's in-process (no subprocess), like echo — the point is the capability
// profile + the projection stream, not a real fabric. A real Tier-A adapter
// (Hermes, selfworking.ai CLI) would emit the same shapes from live org state.

import { randomUUID } from "node:crypto";

// A tiny, stable org: a router over two coordinators over two workers.
const ORG = {
  nodes: [
    { id: "router", role: "Router", reportsTo: null, status: "active" },
    { id: "sales", role: "Sales Coordinator", reportsTo: "router", status: "active" },
    { id: "support", role: "Support Coordinator", reportsTo: "router", status: "idle" },
    { id: "sdr-1", role: "SDR", reportsTo: "sales", status: "active" },
    { id: "agent-x", role: "Support Agent", reportsTo: "support", status: "active" },
  ],
};

/** @returns {import("../adapter-sdk/adapter").AgentAdapter} */
export function orgmockAdapter(opts = {}) {
  const inbox = {
    agent: "router",
    messages: [
      { from: "sales", text: "Pipeline at 12 deals" },
      { from: "support", text: "3 tickets open" },
    ],
  };
  let turns = 0;

  return {
    name: "orgmock",
    capabilities: {
      protocolVersion: 1,
      presentation: "presenter",
      resume: true,
      turnBoundary: "iterator-return",
      permissionPrompt: false,
      // The `standard` org namespaces — what lights up org-mode affordances.
      namespaces: ["org.graph", "agent.spawn", "agent.message", "agent.inbox", "schedule"],
      orgTier: "A", // native fabric
    },

    async *run({ prompt, ctx }) {
      turns += 1;
      const id = ctx.sessionId || `org-${randomUUID().slice(0, 12)}`;
      yield { kind: "session_started", id };
      yield { kind: "status", text: "org" };

      // "talk to <node>" — route a message to a node + reflect it in the inbox.
      const m = /\btalk to\s+([a-z0-9-]+)/i.exec(String(prompt || ""));
      const target = m && ORG.nodes.find((n) => n.id === m[1].toLowerCase());
      if (target) {
        inbox.messages.unshift({ from: "you", text: `→ ${target.id}: ${prompt}` });
        inbox.agent = target.id;
      }

      // The org graph + the inbox as PROJECTIONS — generic, runtime-neutral data.
      // The kernel relays them untouched; the client maps namespace → renderer.
      yield { kind: "projection", namespace: "org.graph", data: ORG };
      yield { kind: "projection", namespace: "agent.inbox", data: inbox };

      // A hero making the point explicit (composed from the same retained-mode
      // patch vocabulary every adapter uses).
      const headline = target ? `Routed to ${target.role}` : "Org mode · Tier A";
      yield {
        kind: "patch",
        ops: [
          { op: "layout", spec: { columns: 4 } },
          {
            op: "mount", id: "org-hero", component: "hero",
            props: {
              label: "Runtime: orgmock",
              value: headline,
              body: "A second runtime — same kernel, no changes. It advertises Tier A + the org namespaces; "
                + "the org chart and inbox below are GENERIC renderers fed by its projections. Tap a node to talk to it.",
            },
          },
          { op: "mount", id: "org-tier", component: "status", props: { label: "Capability", value: "Tier A · native fabric", tone: "good" } },
        ],
      };

      yield { kind: "turn_done", code: 0 };
    },
  };
}

export default orgmockAdapter;
