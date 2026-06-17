// M7 self-improvement acceptance. Exercises the four real, deterministic pieces of
// the loop — the signal SINK (capture), the GARDENER (gated review → proposals), the
// component-SMITH (compose-first search + validate-before-register), and the kernel's
// end-to-end signal RECORDING (a rejected patch op → a render-error signal; a client
// {type:"event", name:"signal"} → its kind). What is NOT tested here, because it is
// not deterministic and not in this layer: the GENERATION of revised component code
// (the console agent's gated job) and the PROMOTION of a new version (operator-gated).
// Surface ships the signal + the gate; the test proves exactly that part is real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { reviewSignals } from "../src/kernel/gardener.mjs";
import { findComponent, validateProposedComponent, nextVersion } from "../src/kernel/smith.mjs";
import { Registry } from "../src/kernel/registry.mjs";
import { createSurface } from "../src/kernel/server.mjs";
import { FileStore } from "../src/providers/store-file.mjs";
import {
  fileSignalSink,
  consoleSignalSink,
  noopSignalSink,
  readSignals,
} from "../src/providers/signals-file.mjs";
import { validateSignalSink } from "../src/provider-sdk/index.mjs";

// ── Gardener — the gated, signal-driven review ───────────────────────────────────

test("gardener ranks render-errors above a lone dismiss and gates every proposal", () => {
  const records = [
    { kind: "dismiss", component: "list" },                  // weight 1 → below minScore
    { kind: "render-error", component: "chart" },            // weight 5
    { kind: "render-error", component: "chart" },            // weight 5 → 10 total
  ];
  const proposals = reviewSignals(records);                  // default minScore 3

  // chart (10) clears the gate; list (1) does not.
  assert.equal(proposals.length, 1, "only the component over minScore is proposed");
  assert.equal(proposals[0].component, "chart");
  // Every proposal is GATED (a proposal, never an auto-apply) and carries a reason.
  assert.equal(proposals[0].action, "propose-revision");
  assert.ok(typeof proposals[0].reason === "string" && proposals[0].reason.length > 0);
  assert.deepEqual(proposals[0].signals, { "render-error": 2 });
});

test("gardener does NOT propose a component with only healthy long dwell", () => {
  const records = [
    { kind: "dwell", component: "metric", data: { ms: 60000 } }, // long dwell → credit, not need
  ];
  const proposals = reviewSignals(records);
  assert.equal(proposals.length, 0, "long dwell is a positive signal — never a revision candidate");
});

test("gardener sorts highest-need first", () => {
  const records = [
    { kind: "markup", component: "low" },                    // weight 2
    { kind: "markup", component: "low" },                    // → 4
    { kind: "render-error", component: "high" },             // weight 5
    { kind: "unknown-component", component: "high" },        // weight 4 → 9
  ];
  const proposals = reviewSignals(records);
  assert.deepEqual(proposals.map((p) => p.component), ["high", "low"]);
  assert.ok(proposals[0].score > proposals[1].score, "ranking is highest-score-first");
});

// ── Component-smith — compose-first search + the validate-before-register gate ────

test("smith findComponent is compose-first: by name, by capability, else null", () => {
  const reg = new Registry();
  reg.register({
    name: "metric",
    version: "1.0.0",
    props: {},
    capabilities: ["render"],
    tokensOnly: true,
  });

  // By name (the cheap, deterministic compose path).
  const byName = findComponent("metric", reg);
  assert.ok(byName && byName.name === "metric", "an exact name match reuses the registered component");

  // No match → null (this is the rare, gated AUTHORING path, not a smith failure).
  assert.equal(findComponent("nope", reg), null);

  // By capability (still composing — find an existing component that can render).
  const byCap = findComponent({ capabilities: ["render"] }, reg);
  assert.ok(byCap && byCap.name === "metric", "a capability need is met by an existing component");
});

test("smith validateProposedComponent accepts token-only, rejects non-token + bad manifest", () => {
  // Good: token-only styles + a well-formed manifest.
  const good = validateProposedComponent({
    manifest: { name: "metric", version: "1.0.1", props: {}, capabilities: [], tokensOnly: true },
    styles: ":host{color:var(--ink)}",
  });
  assert.equal(good.ok, true, good.errors?.join("; "));

  // Bad: hardcoded color smuggled past the token rule (the load-bearing rejection).
  const nonToken = validateProposedComponent({
    manifest: { name: "metric", version: "1.0.1", props: {}, capabilities: [], tokensOnly: true },
    styles: ":host{color:#f00}",
  });
  assert.equal(nonToken.ok, false);
  assert.ok(nonToken.errors.some((e) => /non-token/.test(e)), "the non-token color is named in the errors");

  // Bad: a manifest missing the tokensOnly contract flag.
  const noFlag = validateProposedComponent({
    manifest: { name: "metric", version: "1.0.1", props: {}, capabilities: [] },
  });
  assert.equal(noFlag.ok, false);
  assert.ok(noFlag.errors.some((e) => /tokensOnly/.test(e)), "missing tokensOnly is rejected");
});

test("smith nextVersion bumps the patch (new version, never a live mutation)", () => {
  assert.equal(nextVersion("1.2.3"), "1.2.4");
});

// ── SignalSink — the file/noop sinks + the structural validator ──────────────────

test("fileSignalSink writes a record that readSignals reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-sig-"));
  try {
    const sink = fileSignalSink({ dir });
    await sink.record({ kind: "render-error", component: "chart", ts: Date.now(), data: { error: "boom" } });
    const back = await readSignals(dir);
    assert.equal(back.length, 1);
    assert.equal(back[0].kind, "render-error");
    assert.equal(back[0].component, "chart");
    assert.equal(back[0].data.error, "boom");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("noopSignalSink discards (never throws, nothing persisted)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-sig-"));
  try {
    const sink = noopSignalSink();
    await sink.record({ kind: "dismiss", component: "x", ts: Date.now() });
    assert.deepEqual(await readSignals(dir), [], "the noop sink persists nothing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateSignalSink accepts a sink with record(), rejects a bare object", () => {
  assert.deepEqual(validateSignalSink(fileSignalSink()), { ok: true });
  assert.deepEqual(validateSignalSink(consoleSignalSink()), { ok: true });
  assert.equal(validateSignalSink({}).ok, false, "a sink without record() is rejected");
});

// ── Kernel signal recording (e2e) — the real capture path ────────────────────────
//
// A TINY inline adapter: it yields a session, then a deliberately-bad patch (an
// update against an id that was never mounted → the reconciler rejects it → the
// kernel records a render-error signal), then turn_done. This proves the kernel's
// rejected-op → signal path end-to-end, then we exercise the client→kernel relay.

function badPatchAdapter() {
  return {
    name: "bad-patch",
    capabilities: { protocolVersion: 1, presentation: "presenter", resume: true, turnBoundary: "iterator-return", permissionPrompt: false, namespaces: [], orgTier: "C" },
    async *run({ ctx }) {
      yield { kind: "session_started", id: ctx.sessionId || "t" };
      // Valid SHAPE (string id + object props) but a phantom id → rejected at apply
      // with "update-unknown-id" → server.mjs emits a render-error signal.
      yield { kind: "patch", ops: [{ op: "update", id: "ghost", props: {} }] };
      yield { kind: "turn_done", code: 0 };
    },
  };
}

const send = (ws, obj) => ws.send(JSON.stringify({ v: 1, ...obj }));

// Buffer pre-open like test/integration.test.mjs so the synchronous hello is caught.
function open(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws._inbox = [];
  ws._cursor = 0;
  ws._pending = null;
  ws.on("message", (data) => {
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
  return new Promise((res, rej) => { ws.once("open", () => res(ws)); ws.once("error", rej); });
}

function waitFor(ws, pred, ms = 4000) {
  for (let i = ws._cursor; i < ws._inbox.length; i++) {
    if (pred(ws._inbox[i])) { ws._cursor = i + 1; return Promise.resolve(ws._inbox[i]); }
  }
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { ws._pending = null; reject(new Error("timeout waiting for message")); }, ms);
    ws._pending = { pred, resolve, to };
  });
}

test("kernel records a render-error signal for a rejected op, and relays client signals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-sig-e2e-"));
  const captured = [];
  const collectingSink = { id: "collecting", async record(s) { captured.push(s); } };
  const surface = createSurface({
    adapter: badPatchAdapter(),
    port: 0,
    host: "127.0.0.1",
    openBrowser: false,
    store: new FileStore({ dir }),
    providers: { signals: collectingSink },
  });
  const { port } = await surface.listen();
  let ws;
  try {
    ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");
    send(ws, { type: "mode", mode: "operator" });

    // 1) A rejected patch op must surface as a render-error signal (kernel path).
    send(ws, { type: "prompt", text: "go" });
    await waitFor(ws, (m) => m.type === "turn-end");
    const renderError = captured.find((s) => s.kind === "render-error");
    assert.ok(renderError, "a rejected op produced a render-error signal");
    assert.equal(renderError.component, "ghost", "the signal carries the offending component id");

    // 2) A client-observed signal must relay through to the same sink (relay path).
    // The relay is fire-and-forget over the WS (no acknowledging reply), so poll the
    // captured array briefly rather than waiting on a WS message.
    send(ws, { type: "event", name: "signal", data: { kind: "dismiss", component: "metric", ms: 100 } });
    const dismiss = await waitForSignal(captured, (s) => s.kind === "dismiss" && s.component === "metric");
    assert.ok(dismiss, "the client→kernel relay recorded a dismiss signal");
  } finally {
    if (ws) ws.close();
    await surface.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// The client→kernel signal relay has no acknowledging WS reply, so poll the sink's
// captured array for the expected record (bounded). Returns the record or null.
async function waitForSignal(arr, pred, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = arr.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}
