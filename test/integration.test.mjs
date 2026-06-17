// End-to-end M1 acceptance: a live console driven by the echo adapter. Boots a
// real Surface, connects a WS client, and exercises the full turn loop —
// handshake, retained-mode paint (mount then update), the ask side channel,
// frame history, and the visitor-mode generation block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createSurface } from "../src/kernel/server.mjs";
import { echoAdapter } from "../src/adapters/echo.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

const send = (ws, obj) => ws.send(JSON.stringify({ v: 1, ...obj }));

// Wait for the next UNCONSUMED message matching `pred`, scanning from a per-socket
// cursor. The inbox is filled from BEFORE `open` resolves (so the synchronous
// hello/capabilities are never missed), and the cursor advances past each match so
// sequential waits see distinct turns (turn 1's mount vs turn 2's update). Tests
// use it sequentially (one pending wait at a time).
function waitFor(ws, pred, ms = 4000) {
  for (let i = ws._cursor; i < ws._inbox.length; i++) {
    if (pred(ws._inbox[i])) { ws._cursor = i + 1; return Promise.resolve(ws._inbox[i]); }
  }
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { ws._pending = null; reject(new Error("timeout waiting for message")); }, ms);
    ws._pending = { pred, resolve, to };
  });
}

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "surface-it-"));
  const surface = createSurface({ adapter: echoAdapter(), port: 0, host: "127.0.0.1", openBrowser: false, store: new FileStore({ dir }) });
  const { port } = await surface.listen();
  return { surface, dir, port, teardown: async () => { await surface.close(); await rm(dir, { recursive: true, force: true }); } };
}

async function open(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws._inbox = [];
  ws._cursor = 0;
  ws._pending = null;
  ws.on("message", (data) => {       // attached before `open` → captures synchronous hello
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

test("handshake announces protocol version + capabilities", async () => {
  const { port, teardown } = await boot();
  try {
    const ws = await open(port);
    const hello = await waitFor(ws, (m) => m.type === "hello");
    assert.equal(hello.protocolVersion, 1);
    assert.deepEqual(hello.modes, ["operator", "team", "visitor"]);
    const caps = await waitFor(ws, (m) => m.type === "capabilities");
    assert.equal(caps.caps.orgTier, "C");
    ws.close();
  } finally { await teardown(); }
});

test("echo turn paints a retained-mode mount, then updates in place", async () => {
  const { port, teardown } = await boot();
  try {
    const ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");
    send(ws, { type: "mode", mode: "operator" });

    send(ws, { type: "prompt", text: "hello world" });
    const session = await waitFor(ws, (m) => m.type === "session");
    assert.ok(session.id, "a session id is reported");
    const patch = await waitFor(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "echo-hero"));
    const hero = patch.ops.find((o) => o.id === "echo-hero");
    assert.equal(hero.op, "mount");
    assert.equal(hero.component, "hero");
    assert.equal(hero.props.value, "hello world");
    await waitFor(ws, (m) => m.type === "turn-end");

    // Second turn → retained-mode UPDATE (not a re-mount): proves the canvas persists.
    send(ws, { type: "prompt", text: "again" });
    const patch2 = await waitFor(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "echo-hero"));
    const upd = patch2.ops.find((o) => o.id === "echo-hero");
    assert.equal(upd.op, "update");
    assert.equal(upd.props.value, "again");
    await waitFor(ws, (m) => m.type === "turn-end");

    // History grew to 2 frames, each carrying a self-contained snapshot.
    const r = await fetch(`http://127.0.0.1:${port}/api/history?session=${encodeURIComponent(session.id)}`);
    const { frames } = await r.json();
    assert.equal(frames.length, 2);
    assert.ok(frames[0].snapshot, "frame stores a workspace snapshot for time-travel");
    assert.ok(frames[1].snapshot.components.some((c) => c.id === "echo-hero"));
    ws.close();
  } finally { await teardown(); }
});

test("the ask side channel blocks the turn and resumes on the answer", async () => {
  const { port, teardown } = await boot();
  try {
    const ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");
    send(ws, { type: "mode", mode: "operator" });

    send(ws, { type: "prompt", text: "please ask me" });
    const ask = await waitFor(ws, (m) => m.type === "ask");
    assert.ok(ask.id);
    assert.ok(ask.options.some((o) => o.value === "shout"));
    // Answer "shout" → echo upper-cases the painted value.
    send(ws, { type: "answer", id: ask.id, label: "Shout", value: "shout" });
    const patch = await waitFor(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "echo-hero"));
    const hero = patch.ops.find((o) => o.id === "echo-hero");
    assert.equal(hero.props.value, "PLEASE ASK ME");
    ws.close();
  } finally { await teardown(); }
});

test("visitor mode blocks generation (the safety property)", async () => {
  const { port, teardown } = await boot();
  try {
    const ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");
    send(ws, { type: "mode", mode: "visitor" });
    send(ws, { type: "prompt", text: "do something" });
    const err = await waitFor(ws, (m) => m.type === "error");
    assert.match(err.message, /visitor/i);
    ws.close();
  } finally { await teardown(); }
});
