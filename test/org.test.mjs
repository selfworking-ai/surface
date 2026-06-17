// M6 — org projection acceptance. The thesis under test: SWAP THE RUNTIME, ZERO
// KERNEL CHANGE. The orgmock adapter advertises Tier A + the `standard` org
// namespaces and streams org.graph / agent.inbox projections; the SAME kernel that
// runs echo (Tier C) relays them unchanged, and generic client renderers paint
// them. These tests prove (1) the adapter's capability profile + projection
// stream, (2) the "talk to a node" routing, (3) the token-only design rule that
// keeps the generic renderers survivable, (4) the org-console pack frames the
// surface, and (5) — end to end — a booted Surface relays the 2nd adapter's
// org.graph projection over the wire with no kernel change.
//
// Node-pure: this file never imports the client component .js modules (they call
// customElements.define, which has no DOM in node). The renderers' real styles are
// guarded at definition (defineComponent) + at registration (Registry); here we
// prove the RULE with validateTokens on synthetic CSS, and the pack via Workspace.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { orgmockAdapter } from "../src/adapters/orgmock.mjs";
import { definePack, installPack } from "../src/pack-sdk/index.mjs";
import { validateComponentManifest } from "../src/kernel/registry.mjs";
import { validateTokens } from "../client/components/token-validator.mjs";
import { Workspace } from "../src/kernel/workspace.mjs";
import { createSurface } from "../src/kernel/server.mjs";
import { FileStore } from "../src/providers/store-file.mjs";
import orgConsole from "../packs/org-console/index.mjs";

// Drain an async-generator run() into an array of TurnEvents.
async function collect(gen) {
  const out = [];
  for await (const evt of gen) out.push(evt);
  return out;
}
const runCtx = (over = {}) => ({ sessionId: null, mode: "operator", signal: new AbortController().signal, ...over });

// ── 1. Capability profile — the Tier-A + org-namespaces advertisement ─────────
test("orgmock advertises Tier A and the standard org namespaces", () => {
  const a = orgmockAdapter();
  assert.equal(a.capabilities.orgTier, "A", "orgmock is a native fabric (Tier A)");
  const ns = a.capabilities.namespaces;
  assert.ok(Array.isArray(ns), "namespaces is an array");
  for (const n of ["org.graph", "agent.inbox", "agent.spawn"]) {
    assert.ok(ns.includes(n), `namespaces includes ${n}`);
  }
});

// ── 2. The projection stream — org.graph + agent.inbox + a turn boundary ──────
test("orgmock.run() emits org.graph + agent.inbox projections and a turn_done", async () => {
  const a = orgmockAdapter();
  const events = await collect(a.run({ prompt: "hi", ctx: runCtx() }));

  const graph = events.find((e) => e.kind === "projection" && e.namespace === "org.graph");
  assert.ok(graph, "an org.graph projection is emitted");
  assert.ok(Array.isArray(graph.data.nodes), "org.graph carries a nodes array");
  assert.ok(graph.data.nodes.length > 0, "the org has at least one node");

  const inbox = events.find((e) => e.kind === "projection" && e.namespace === "agent.inbox");
  assert.ok(inbox, "an agent.inbox projection is emitted");
  assert.ok(Array.isArray(inbox.data.messages), "agent.inbox carries a messages array");

  assert.ok(events.some((e) => e.kind === "turn_done"), "the turn closes with turn_done");
});

// ── 3. The "talk to a node" routing — message prepended, inbox retargeted ─────
test("orgmock routes 'talk to <id>' to that node and reflects it in the inbox", async () => {
  const a = orgmockAdapter();
  const events = await collect(a.run({ prompt: "talk to sales", ctx: runCtx() }));
  const inbox = events.find((e) => e.kind === "projection" && e.namespace === "agent.inbox");
  assert.ok(inbox, "the inbox projection is present");
  assert.equal(inbox.data.agent, "sales", "the inbox is retargeted to the addressed node");
  assert.equal(inbox.data.messages[0].from, "you", "a routed message from 'you' is prepended");
});

// ── 4. The token-only rule — the design contract behind the generic renderers ─
// The org-graph + inbox real styles are guarded by defineComponent (dev-time) and
// Registry.register (load-bearing). Here we prove the RULE itself: a token-only
// manifest validates; one whose styles smuggle a literal color/radius is rejected.
test("validateComponentManifest + validateTokens enforce token-only styles", () => {
  const tokenOnlyCss = `
    .node { background: var(--glass); border: 1px solid var(--hairline-soft); border-radius: var(--r-inner); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); }
    .node:hover { background: color-mix(in srgb, var(--accent) 12%, var(--glass)); }
    .pill { border-radius: 999px; }
  `;
  assert.deepEqual(validateTokens(tokenOnlyCss), { ok: true, violations: [] }, "pure token CSS passes");

  const goodManifest = {
    name: "org-graph", version: "1.0.0",
    props: { nodes: { type: "array" } }, capabilities: ["render"], tokensOnly: true,
    styles: tokenOnlyCss,
  };
  assert.deepEqual(validateComponentManifest(goodManifest), { ok: true }, "a token-only component manifest registers");

  // Non-token styling must be caught — a hardcoded color AND a design radius.
  const badCss = `.node { background: #ff0000; border-radius: 12px; }`;
  const bad = validateTokens(badCss);
  assert.equal(bad.ok, false, "literal color + radius are rejected");
  assert.ok(bad.violations.some((v) => v.type === "color"), "the hex color is flagged");
  assert.ok(bad.violations.some((v) => v.type === "radius"), "the 12px radius is flagged");

  const badManifest = { ...goodManifest, styles: badCss };
  assert.equal(validateComponentManifest(badManifest).ok, false, "a non-token component manifest is rejected");
});

// ── 5. The org-console pack — frames the surface; projections fill the rest ───
test("org-console pack seeds a framing hero on a 4-column layout", () => {
  // It is a real pack module (definePack validated its manifest at import).
  assert.equal(orgConsole.manifest.name, "org-console");
  assert.equal(orgConsole.manifest.permissionProfile, "operator");
  assert.equal(orgConsole.manifest.layout.columns, 4);

  const ws = new Workspace();
  installPack(orgConsole, { workspace: ws });
  assert.ok(ws.size >= 1, "the pack seeds at least the framing hero");
  assert.equal(ws.doc.layout.columns, 4, "the pack's layout is applied");
  const hero = ws.doc.components["oc-hero"];
  assert.ok(hero, "the framing hero is mounted by its stable id");
  assert.equal(hero.component, "hero");

  // definePack rejects a malformed manifest (a pack is a unit of installable trust).
  assert.throws(() => definePack({ name: "x" }), /definePack/);
});

// ── 6. e2e — the agnosticism proof over the wire ─────────────────────────────
// Boot a real Surface with the SECOND adapter (orgmock). The kernel is byte-for-byte
// the one that runs echo. Assert it advertises Tier A on connect and relays the
// adapter's org.graph projection UNCHANGED after a prompt — no kernel change.
function waitFor(ws, pred, ms = 4000) {
  for (let i = ws._cursor; i < ws._inbox.length; i++) {
    if (pred(ws._inbox[i])) { ws._cursor = i + 1; return Promise.resolve(ws._inbox[i]); }
  }
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { ws._pending = null; reject(new Error("timeout waiting for message")); }, ms);
    ws._pending = { pred, resolve, to };
  });
}
const send = (ws, obj) => ws.send(JSON.stringify({ v: 1, ...obj }));

async function open(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws._inbox = []; ws._cursor = 0; ws._pending = null;
  ws.on("message", (data) => {        // attached before `open` → captures synchronous hello/capabilities
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    ws._inbox.push(m);
    if (ws._pending) {
      for (let i = ws._cursor; i < ws._inbox.length; i++) {
        if (ws._pending.pred(ws._inbox[i])) {
          ws._cursor = i + 1;
          clearTimeout(ws._pending.to);
          const p = ws._pending; ws._pending = null;
          p.resolve(ws._inbox[i]);
          break;
        }
      }
    }
  });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  return ws;
}

test("e2e: the same kernel running orgmock advertises Tier A and relays its org.graph projection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-org-"));
  const surface = createSurface({ adapter: orgmockAdapter(), port: 0, host: "127.0.0.1", openBrowser: false, store: new FileStore({ dir }) });
  const { port } = await surface.listen();
  try {
    const ws = await open(port);
    // hello arrives first, then capabilities (the LSP-style handshake). Consume in
    // order — waitFor advances a cursor past each match, so out-of-order waits skip.
    await waitFor(ws, (m) => m.type === "hello");
    // The capability profile reaches the browser unchanged — Tier A from the adapter.
    const caps = await waitFor(ws, (m) => m.type === "capabilities");
    assert.equal(caps.caps.orgTier, "A", "the kernel relays the orgmock Tier-A capability");

    send(ws, { type: "mode", mode: "operator" });
    send(ws, { type: "prompt", text: "hi" });

    // The load-bearing assertion: the kernel broadcasts the adapter's org.graph
    // projection verbatim (NS the client maps to the generic org-graph renderer).
    const proj = await waitFor(ws, (m) => m.type === "projection" && m.namespace === "org.graph");
    assert.ok(proj.data && Array.isArray(proj.data.nodes), "the org.graph projection arrives with its nodes intact");
    assert.ok(proj.data.nodes.some((n) => n.id === "router"), "the projection data is the runtime's, unchanged");

    ws.close();
  } finally {
    await surface.close();
    await rm(dir, { recursive: true, force: true });
  }
});
