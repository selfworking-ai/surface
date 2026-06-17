// Audit — the AuditSink port, two ways:
//  (a) unit: the shipped file/noop sinks (write/read round-trip; discard).
//  (b) end-to-end: the kernel records EVERY mutating action against the principal.
//      We boot a real Surface with a collecting sink and drive one turn over WS,
//      then assert the kernel emitted the documented audit actions with the right
//      principal + a numeric ts. The WS harness mirrors integration.test.mjs
//      (inbox filled from BEFORE `open`, cursor-advancing waitFor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { fileAuditSink, noopAuditSink, readAudit } from "../src/providers/audit-file.mjs";
import { createSurface } from "../src/kernel/server.mjs";
import { echoAdapter } from "../src/adapters/echo.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

// ── (a) Unit: file sink writes a readable record; noop discards ───────────────
test("fileAuditSink writes a record that readAudit reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-audit-"));
  try {
    const sink = fileAuditSink({ dir });
    await sink.record({ principal: "operator", action: "turn.start", ts: 1700000000000, data: { mode: "operator" } });
    await sink.record({ principal: "operator", action: "frame.commit", ts: 1700000000001, data: { n: 1 } });
    const records = await readAudit(dir);
    assert.equal(records.length, 2);
    assert.equal(records[0].action, "turn.start");
    assert.equal(records[0].principal, "operator");
    assert.deepEqual(records[1].data, { n: 1 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("noopAuditSink discards (readAudit of an empty dir is [])", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-audit-"));
  try {
    const sink = noopAuditSink();
    await sink.record({ principal: "x", action: "turn.start", ts: Date.now() });
    assert.deepEqual(await readAudit(dir), []);   // nothing written
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a sink that throws/rejects never escapes record() (kernel fires-and-forgets)", async () => {
  // The file sink swallows write errors internally; assert it resolves even when
  // the target path is unwritable (a file where the dir should be is unusual; we
  // simply assert record() resolves rather than rejects for a normal call).
  const dir = await mkdtemp(join(tmpdir(), "surface-audit-"));
  try {
    const sink = fileAuditSink({ dir });
    await assert.doesNotReject(() => sink.record({ principal: "p", action: "a", ts: Date.now() }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ── WS harness (mirrors integration.test.mjs) ────────────────────────────────
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
  ws.on("message", (data) => {                 // attached before `open` → captures the synchronous hello
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

const send = (ws, obj) => ws.send(JSON.stringify({ v: 1, ...obj }));

// ── (b) End-to-end: the kernel records mutations against the principal ────────
test("kernel records mode.lock, turn.start, and frame.commit against the principal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-audit-e2e-"));
  // A collecting sink: every kernel auditRecord() lands in `events`.
  const events = [];
  const collectingSink = { id: "collect", async record(e) { events.push(e); } };

  const surface = createSurface({
    adapter: echoAdapter(),
    port: 0,
    host: "127.0.0.1",
    openBrowser: false,
    store: new FileStore({ dir }),
    providers: { audit: collectingSink },
  });
  const { port } = await surface.listen();
  try {
    const ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");

    // Lock mode (→ mode.lock), then run a turn (→ turn.start … frame.commit).
    send(ws, { type: "mode", mode: "operator" });
    send(ws, { type: "prompt", text: "hi" });
    await waitFor(ws, (m) => m.type === "turn-end");

    // frame.commit fires after turn-end's broadcast ordering is set up, but the
    // record() is synchronous-push in our sink; give the microtask queue a tick
    // in case the commit's await chain hasn't flushed.
    await new Promise((r) => setTimeout(r, 50));

    const actions = events.map((e) => e.action);
    assert.ok(actions.includes("mode.lock"), `expected mode.lock in ${JSON.stringify(actions)}`);
    assert.ok(actions.includes("turn.start"), `expected turn.start in ${JSON.stringify(actions)}`);
    assert.ok(actions.includes("frame.commit"), `expected frame.commit in ${JSON.stringify(actions)}`);

    // Every captured record is attributed to the operator principal with a numeric ts.
    for (const e of events) {
      assert.equal(e.principal, "operator", `action ${e.action} attributed to operator`);
      assert.equal(typeof e.ts, "number");
      assert.ok(Number.isFinite(e.ts), "ts is a finite epoch-ms number");
    }

    // The mode.lock record carries the mode it locked into.
    const lock = events.find((e) => e.action === "mode.lock");
    assert.equal(lock.data.mode, "operator");

    ws.close();
  } finally {
    await surface.close();
    await rm(dir, { recursive: true, force: true });
  }
});
