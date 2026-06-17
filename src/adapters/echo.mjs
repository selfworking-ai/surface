// Echo adapter — the M1 reference adapter and the proof that the kernel works
// independent of any real runtime. No subprocess, no LLM: it drives a turn purely
// in-process, painting the prompt back as RETAINED-MODE tiles (mount on the first
// turn, update-in-place after — so you can watch the reconciler patch, not repaint).
//
// It also demonstrates the bidirectional `ask` side channel: include the word
// "ask" in a prompt and it surfaces a decision card and continues the same turn
// on your choice.
//
// Capability Tier C (single agent, no fabric). It is the canonical example for
// `docs/authoring-adapters.md`: an adapter is just `name` + `capabilities` + an
// async-generator `run({prompt, ctx})` that yields canonical TurnEvents.

import { randomUUID } from "node:crypto";

/** @returns {import("../adapter-sdk/adapter").AgentAdapter} */
export function echoAdapter(opts = {}) {
  const label = opts.label || "Echo";
  let turns = 0;

  return {
    name: "echo",
    capabilities: {
      protocolVersion: 1,
      presentation: "presenter",
      resume: true,
      turnBoundary: "iterator-return",
      permissionPrompt: false,
      namespaces: [],
      orgTier: "C",
    },

    async *run({ prompt, ctx }) {
      turns += 1;
      const text = String(prompt ?? "");

      // Session identity: keep the one the browser resumed, or mint a fresh one.
      const id = ctx.sessionId || `echo-${randomUUID().slice(0, 12)}`;
      yield { kind: "session_started", id };
      yield { kind: "status", text: "echoing" };

      // Optional ask demo — blocks until the user taps, then continues the turn.
      let shown = text;
      if (/\bask\b/i.test(text)) {
        const ans = await ctx.ask(
          "How should I echo that?",
          [
            { label: "Shout", value: "shout" },
            { label: "Whisper", value: "whisper" },
            { label: "As-is", value: "asis" },
          ],
          "The echo adapter is demonstrating the decision-card side channel.",
        );
        if (!ans?.cancelled) {
          if (ans.value === "shout") shown = text.toUpperCase();
          else if (ans.value === "whisper") shown = text.toLowerCase();
        }
      }

      const body = "Surface received your prompt and painted this through the retained-mode "
        + "reconciler. Type again — the tiles below update in place rather than repaint.";

      if (turns === 1) {
        yield {
          kind: "patch",
          ops: [
            { op: "layout", spec: { columns: 4 } },
            { op: "mount", id: "echo-hero", component: "hero", props: { label, value: shown || "(empty prompt)", body } },
            { op: "mount", id: "echo-turns", component: "metric", props: { label: "Turns", value: String(turns) } },
            { op: "mount", id: "echo-mode", component: "metric", props: { label: "Mode", value: ctx.mode } },
            { op: "mount", id: "echo-tier", component: "status", props: { label: "Runtime", value: "echo · Tier C", tone: "good" } },
          ],
        };
      } else {
        yield {
          kind: "patch",
          ops: [
            { op: "update", id: "echo-hero", props: { value: shown || "(empty prompt)" } },
            { op: "update", id: "echo-turns", props: { value: String(turns) } },
          ],
        };
      }

      yield { kind: "turn_done", code: 0 };
    },
  };
}

export default echoAdapter;
