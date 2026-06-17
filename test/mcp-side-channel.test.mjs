// End-to-end coverage for the loopback side channel (/mcp/* — gotcha G2/G3, the M2
// out-of-band runtime seam). A runtime that presents OUT-OF-BAND (the Claude adapter
// spawns an MCP server) POSTs presentation + decisions to /mcp/* instead of streaming
// them on stdout. Every call carries the per-turn `x-surface-token`; it works only
// while THAT turn is live (the trust boundary that scopes the side channel to the
// spawned runtime). These tests drive the bridge from INSIDE a live turn via a
// controllable adapter that exposes `ctx.sideChannel.{baseUrl, token, session}` to the
// test, mimicking the real MCP subprocess, and assert against a connected WS client.
//
// Honors SX-3 (the WS harness: message listener attached BEFORE `open`; a per-socket
// consumption cursor so sequential waitFor()s see distinct messages) and SX-6
// (ephemeral port:0; read it back from listen()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createSurface } from "../src/kernel/server.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

// ── WS harness (SX-3 — identical shape to integration.test.mjs) ──────────────────
const send = (ws, obj) => ws.send(JSON.stringify({ v: 1, ...obj }));

function waitFor(ws, pred, ms = 4000) {
  for (let i = ws._cursor; i < ws._inbox.length; i++) {
    if (pred(ws._inbox[i])) { ws._cursor = i + 1; return Promise.resolve(ws._inbox[i]); }
  }
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { ws._pending = null; reject(new Error("timeout waiting for message")); }, ms);
    ws._pending = { pred, resolve, to };
  });
}

async function open(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws._inbox = [];
  ws._cursor = 0;
  ws._pending = null;
  ws.on("message", (data) => {            // attached before `open` → captures synchronous hello
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

// ── Controllable adapter — a live turn the test holds open ───────────────────────
// `run` reports a (valid) session id, then publishes its TurnContext to the test and
// blocks on a release promise. While blocked the turn is in-flight: `turnToken` and
// `currentCtx` are live, so /mcp/* accepts the bearer. The test drives the bridge
// over HTTP (exactly as the real MCP subprocess does), then releases the turn.
function controllableAdapter() {
  let publish;                            // resolves with the live ctx
  const ready = new Promise((r) => { publish = r; });
  let release;                            // the test calls finish() to end the turn
  const released = new Promise((r) => { release = r; });

  const adapter = {
    name: "controllable",
    capabilities: {
      protocolVersion: 1, presentation: "presenter", resume: true,
      turnBoundary: "iterator-return", permissionPrompt: true, namespaces: [], orgTier: "C",
    },
    async *run({ ctx }) {
      const id = ctx.sessionId || "mcp-test-session";
      yield { kind: "session_started", id };
      yield { kind: "status", text: "bridging" };
      publish(ctx);                       // hand the side channel to the test
      await released;                     // keep the turn live until finish()
      yield { kind: "turn_done", code: 0 };
    },
    // Test handles — not part of the AgentAdapter contract, just plumbing.
    ready,
    finish: () => release(),
  };
  return adapter;
}

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "surface-mcp-"));
  const adapter = controllableAdapter();
  const surface = createSurface({ adapter, port: 0, host: "127.0.0.1", openBrowser: false, store: new FileStore({ dir }) });
  const { port } = await surface.listen();
  return { surface, adapter, dir, port, teardown: async () => { await surface.close(); await rm(dir, { recursive: true, force: true }); } };
}

// Start a turn, wait for the adapter to publish its live ctx (= side channel + token).
async function startTurn(ws, adapter, text = "drive the bridge") {
  await waitFor(ws, (m) => m.type === "hello");
  send(ws, { type: "mode", mode: "operator" });
  send(ws, { type: "prompt", text });
  await waitFor(ws, (m) => m.type === "session");
  const ctx = await adapter.ready;
  return ctx.sideChannel;                 // { baseUrl, token, session }
}

// POST a JSON body to a /mcp/* route with an explicit token header.
function mcpPost(sc, route, body, token = sc.token) {
  return fetch(`${sc.baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token != null ? { "x-surface-token": token } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

// ── Token / 409 gate ─────────────────────────────────────────────────────────────

test("/mcp/event rejects a missing or wrong token with 409 (the trust boundary)", async () => {
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);

    // No token header → 409.
    const noTok = await mcpPost(sc, "/mcp/event", { kind: "status", text: "x" }, null);
    assert.equal(noTok.status, 409);
    assert.deepEqual(await noTok.json(), { error: "no active turn or bad token" });

    // Wrong token → 409.
    const badTok = await mcpPost(sc, "/mcp/event", { kind: "status", text: "x" }, "not-the-token");
    assert.equal(badTok.status, 409);
    assert.deepEqual(await badTok.json(), { error: "no active turn or bad token" });

    adapter.finish();
    ws.close();
  } finally { await teardown(); }
});

test("/mcp/event is rejected with 409 once the turn ends (token is cleared)", async () => {
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);   // captures the (then-valid) token

    // End the turn; turnToken/currentCtx are torn down in the run-loop finally.
    adapter.finish();
    await waitFor(ws, (m) => m.type === "turn-end");

    // The same token that worked mid-turn is now stale → 409.
    const after = await mcpPost(sc, "/mcp/event", { kind: "status", text: "late" });
    assert.equal(after.status, 409);
    assert.deepEqual(await after.json(), { error: "no active turn or bad token" });
    ws.close();
  } finally { await teardown(); }
});

// ── /mcp/event → WS patch broadcast + fire-and-forget ack ────────────────────────

test("/mcp/event with a patch broadcasts a WS patch and acks {ok:true}", async () => {
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);

    const ops = [
      { op: "mount", id: "bridge-hero", component: "hero", props: { label: "Bridge", value: "live" } },
    ];
    const res = await mcpPost(sc, "/mcp/event", { kind: "patch", ops });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true }, "fire-and-forget ack");

    // The connected WS client receives the applied ops verbatim.
    const patch = await waitFor(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "bridge-hero"));
    const hero = patch.ops.find((o) => o.id === "bridge-hero");
    assert.equal(hero.op, "mount");
    assert.equal(hero.component, "hero");
    assert.equal(hero.props.value, "live");

    adapter.finish();
    ws.close();
  } finally { await teardown(); }
});

// ── /mcp/ask round-trip ──────────────────────────────────────────────────────────

test("/mcp/ask surfaces a card and resolves the HTTP call with the chosen answer", async () => {
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);

    // The bridge POSTs an ask; the HTTP call BLOCKS until the user answers over WS.
    const askDone = mcpPost(sc, "/mcp/ask", {
      question: "Ship it?",
      options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
      context: "side-channel ask",
    });

    const card = await waitFor(ws, (m) => m.type === "ask");
    assert.equal(card.question, "Ship it?");
    assert.ok(card.options.some((o) => o.value === "yes"));

    // Client answers (matches case "answer": { id, label, value }).
    send(ws, { type: "answer", id: card.id, label: "Yes", value: "yes" });

    const ans = await (await askDone).json();
    assert.deepEqual(ans, { label: "Yes", value: "yes" }, "the HTTP ask resolves with the chosen option");

    // The kernel also broadcasts a resolution receipt.
    const resolved = await waitFor(ws, (m) => m.type === "resolved" && m.id === card.id && m.kind === "ask");
    assert.equal(resolved.outcome, "answered");

    adapter.finish();
    ws.close();
  } finally { await teardown(); }
});

// ── /mcp/permission round-trip (allow + deny) ────────────────────────────────────

test("/mcp/permission resolves allow with {behavior:'allow', updatedInput}", async () => {
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);

    const input = { command: "rm -rf /tmp/scratch" };
    const permDone = mcpPost(sc, "/mcp/permission", { tool: "Bash", input });

    const card = await waitFor(ws, (m) => m.type === "permission");
    assert.equal(card.tool, "Bash");
    assert.deepEqual(card.input, input);

    // Client allows (matches case "decision": { id, decision:"allow" }).
    send(ws, { type: "decision", id: card.id, decision: "allow" });

    const dec = await (await permDone).json();
    assert.equal(dec.behavior, "allow");
    assert.deepEqual(dec.updatedInput, input, "allow echoes the original input back to the runtime");

    const resolved = await waitFor(ws, (m) => m.type === "resolved" && m.id === card.id && m.kind === "permission");
    assert.equal(resolved.outcome, "allow");

    adapter.finish();
    ws.close();
  } finally { await teardown(); }
});

test("/mcp/permission resolves deny with {behavior:'deny', message}", async () => {
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);

    const permDone = mcpPost(sc, "/mcp/permission", { tool: "Bash", input: { command: "shutdown" } });
    const card = await waitFor(ws, (m) => m.type === "permission");

    // Client denies with a message.
    send(ws, { type: "decision", id: card.id, decision: "deny", message: "operator said no" });

    const dec = await (await permDone).json();
    assert.equal(dec.behavior, "deny");
    assert.equal(dec.message, "operator said no", "the deny carries the operator's reason");

    const resolved = await waitFor(ws, (m) => m.type === "resolved" && m.id === card.id && m.kind === "permission");
    assert.equal(resolved.outcome, "deny");

    adapter.finish();
    ws.close();
  } finally { await teardown(); }
});

// ── resume continuity ────────────────────────────────────────────────────────────

test("a returning connection rehydrates the persisted composition on connect", async () => {
  // The realistic resume path: a turn paints + commits a frame, then a SECOND
  // connection to the same surface gets the retained workspace replayed on connect
  // (wss.on("connection") sends workspace.toOps()). That is the deterministic
  // continuity we can verify end-to-end.
  //
  // NOTE: the {type:"resume", sessionId} wire (case "resume", server.mjs) only adopts
  // the browser's id when the server has NONE yet. Here the adapter mints a session id
  // on the first turn, so by the time a second connection sends resume the server
  // already holds that id and the resume is a no-op — the on-connect workspace replay
  // is what carries continuity in this single-instance setup. Cross-instance resume
  // (a fresh server adopting a browser-owned id from the store) is exercised by the
  // store/workspace unit tests; asserting it here would need a second createSurface
  // sharing the same FileStore dir, which the single-active-turn model doesn't model
  // cleanly. Left as a known gap rather than a flaky assertion.
  const { adapter, port, teardown } = await boot();
  try {
    const ws = await open(port);
    const sc = await startTurn(ws, adapter);

    // Paint a component via the bridge, then end the turn so the frame commits.
    await mcpPost(sc, "/mcp/event", {
      kind: "patch",
      ops: [{ op: "mount", id: "persist-me", component: "metric", props: { label: "Kept", value: "42" } }],
    });
    await waitFor(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "persist-me"));
    const session = sc.session;
    assert.ok(session, "the adapter reported a session id through the side channel");

    adapter.finish();
    await waitFor(ws, (m) => m.type === "turn-end");
    ws.close();

    // A second connection to the SAME surface replays the retained composition.
    const ws2 = await open(port);
    await waitFor(ws2, (m) => m.type === "hello");
    const replay = await waitFor(ws2, (m) => m.type === "patch" && m.ops.some((o) => o.id === "persist-me"));
    const kept = replay.ops.find((o) => o.id === "persist-me");
    assert.equal(kept.op, "mount", "rehydration expresses the composition as mounts");
    assert.equal(kept.props.value, "42", "the painted value survives across the reconnect");

    // The persisted frame is also recoverable via /api/history for this session.
    const r = await fetch(`http://127.0.0.1:${port}/api/history?session=${encodeURIComponent(session)}`);
    const { frames } = await r.json();
    assert.equal(frames.length, 1, "one committed frame for the session");
    assert.ok(frames[0].snapshot.components.some((c) => c.id === "persist-me"), "frame snapshot holds the painted component");

    ws2.close();
  } finally { await teardown(); }
});
