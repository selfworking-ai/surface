// Regression coverage for AUDIT P2 — the resume race (server.mjs, case "resume"
// + runTurn). A `{type:"resume", sessionId}` triggers workspace.load() (async);
// load() calls restore(snap), which WHOLESALE-REPLACES this.doc. If a prompt
// arrives while that load is still pending, the turn's just-mounted components
// would be clobbered the moment restore() lands — UNLESS runTurn awaits the
// in-flight load BEFORE mounting anything.
//
// The fix: case "resume" records the load in `pendingLoad`; runTurn (after
// setting turnInFlight) does `if (pendingLoad) await pendingLoad` BEFORE it
// builds liveFrame / runs the adapter. So restore() (doc = {old-tile}) lands
// first, then the turn mounts new-tile → doc = {old-tile, new-tile}. Without the
// await, the ordering inverts and new-tile is clobbered.
//
// To force the race deterministically we wrap the StorageProvider so
// loadWorkspace() resolves only after a real setTimeout delay — long enough that
// the turn's mount path (a few microtask hops through the adapter's async
// generator) finishes WITHIN the load window. With the await, the turn waits the
// full load before mounting, so order is preserved; without it, the turn mounts
// new-tile first and the late restore() then clobbers it.
//
// NOTE: this test FAILS if runTurn stops awaiting pendingLoad. Without the await,
// the turn mounts new-tile into the fresh doc; ~50ms later the delayed load's
// restore() WHOLESALE-REPLACES this.doc with only {old-tile}, dropping new-tile —
// the final-composition assertion (new-tile survived) fails. It also guards the
// ORDERING: the restored ops broadcast (workspace.toOps from pendingLoad's .then)
// must arrive BEFORE the turn's new-tile mount. (Verified by temporarily deleting
// the `await pendingLoad` line and watching this test go red.)
//
// Honors SX-3 (WS harness: message listener attached BEFORE `open`; per-socket
// consumption cursor) and SX-6 (ephemeral port:0; read it back from listen()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createSurface } from "../src/kernel/server.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

// ── WS harness (SX-3 — identical shape to integration / mcp-side-channel) ─────────
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

// Non-cursor scan: resolve once ANY inbox message (already buffered or arriving
// later) matches — used for the order/settling checks here, where the two paths
// (fixed vs buggy) interleave the restore + the turn DIFFERENTLY, so a forward-only
// cursor would skip a message that legitimately arrived out of the expected order.
function seen(ws, pred, ms = 4000) {
  const found = ws._inbox.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const hit = ws._inbox.find(pred);
      if (hit) { clearInterval(iv); resolve(hit); }
      else if (Date.now() - start > ms) { clearInterval(iv); reject(new Error("timeout: no inbox message matched")); }
    }, 5);
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

// ── Delayed store — loadWorkspace returns a prior snapshot after a timer delay ────
// loadWorkspace returns a PRIOR snapshot (one component "old-tile") but only after
// a real setTimeout, so the load is guaranteed still pending while the prompt's
// turn runs its (microtask-fast) mount path. saveWorkspace/appendFrame/listFrames/
// get/put delegate to a real FileStore (tmp dir) so commitFrame + the on-connect
// workspace replay stay deterministic.
const LOAD_DELAY_MS = 50;                 // > the turn's mount path (microtask hops)
function delayedStore(dir) {
  const real = new FileStore({ dir });
  const priorSnapshot = {
    components: [{ id: "old-tile", component: "metric", props: { label: "Prior", value: "1" } }],
    layout: {},
  };
  return {
    id: "delayed",
    async loadWorkspace(session) {
      await new Promise((r) => setTimeout(r, LOAD_DELAY_MS));   // real timer → spans the turn's mount
      return session ? priorSnapshot : null;
    },
    saveWorkspace: (s, snap) => real.saveWorkspace(s, snap),
    appendFrame: (s, f) => real.appendFrame(s, f),
    listFrames: (s) => real.listFrames(s),
    get: (k) => real.get(k),
    put: (k, v) => real.put(k, v),
  };
}

// ── Controllable adapter — mounts "new-tile" then turn_done ───────────────────────
// Reports the resumed session id (ctx.sessionId, adopted by case "resume" before
// the turn runs), then mounts a NEW component "new-tile" via a patch TurnEvent.
function newTileAdapter() {
  return {
    name: "new-tile",
    capabilities: {
      protocolVersion: 1, presentation: "presenter", resume: true,
      turnBoundary: "iterator-return", permissionPrompt: true, namespaces: [], orgTier: "C",
    },
    async *run({ ctx }) {
      const id = ctx.sessionId || "resume-race-session";
      yield { kind: "session_started", id };
      yield { kind: "patch", ops: [{ op: "mount", id: "new-tile", component: "metric", props: { label: "Fresh", value: "2" } }] };
      yield { kind: "turn_done", code: 0 };
    },
  };
}

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "surface-resume-"));
  const store = delayedStore(dir);
  const adapter = newTileAdapter();
  const surface = createSurface({ adapter, port: 0, host: "127.0.0.1", openBrowser: false, store });
  const { port } = await surface.listen();
  return { surface, store, dir, port, teardown: async () => { await surface.close(); await rm(dir, { recursive: true, force: true }); } };
}

const SESSION = "resume-race-session";

// ── The race: a prompt right after resume must NOT clobber the restore ────────────

test("resume's load completes before the turn mounts — neither tile is clobbered", async () => {
  const { port, teardown } = await boot();
  try {
    const ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");

    // Lock a mode, then resume (kicks off the delayed loadWorkspace), then
    // IMMEDIATELY prompt. runTurn sets turnInFlight and parks on `await pendingLoad`
    // until the delayed load resolves (restore lands), then mounts new-tile.
    send(ws, { type: "mode", mode: "operator" });
    send(ws, { type: "resume", sessionId: SESSION });
    send(ws, { type: "prompt", text: "paint the fresh tile" });

    // Let BOTH the turn and the (delayed) restore fully settle: wait for turn-end,
    // then for the restore's broadcast (old-tile, from pendingLoad's .then) to land.
    // Use the non-cursor `seen` — in the buggy path the restore arrives AFTER
    // turn-end, so a forward-only cursor (already past turn-end) would miss it.
    await waitFor(ws, (m) => m.type === "turn-end");
    await seen(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "old-tile"));
    await seen(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === "new-tile"));

    // Ordering guard: the restore broadcast (old-tile) must precede the turn's
    // new-tile mount in the stream. With the fix, runTurn awaits the load so
    // old-tile is broadcast first; without it, new-tile is broadcast first and the
    // late restore silently clobbers it. Compare first-occurrence indices in the inbox.
    const idxOld = ws._inbox.findIndex((m) => m.type === "patch" && m.ops.some((o) => o.id === "old-tile"));
    const idxNew = ws._inbox.findIndex((m) => m.type === "patch" && m.ops.some((o) => o.id === "new-tile"));
    assert.ok(idxOld >= 0 && idxNew >= 0, "both the restored old-tile and the turn's new-tile were broadcast");
    assert.ok(idxOld < idxNew, "the restore (old-tile) broadcasts BEFORE the turn's new-tile (the awaited ordering)");

    ws.close();

    // The decisive assertion: a fresh connection replays the FULL live composition
    // (workspace.toOps on connect). It must contain BOTH old-tile (the restore
    // landed) AND new-tile (the turn's mount survived — was not clobbered by the
    // late restore). Without the await, new-tile is absent here → this fails.
    const ws2 = await open(port);
    await waitFor(ws2, (m) => m.type === "hello");
    const replay = await seen(ws2, (m) => m.type === "patch" && m.ops.some((o) => o.id === "old-tile"));
    const ids = new Set(replay.ops.filter((o) => o.id).map((o) => o.id));
    assert.ok(ids.has("old-tile"), "restored old-tile is present after the turn (the load landed)");
    assert.ok(ids.has("new-tile"), "the turn's new-tile survived (NOT clobbered by the late restore)");
    ws2.close();
  } finally { await teardown(); }
});

// ── The removed {type:"recall"} ClientMsg is handled gracefully ───────────────────

test("a removed {type:\"recall\"} message is a graceful no-op (no crash, socket stays alive)", async () => {
  // {type:"recall"} is no longer in the ClientMsg contract. decode() tolerates an
  // unknown type (valid string `type` → ok:true), and onClientMessage's switch has
  // no matching case, so it falls through to a silent no-op. The connection must
  // survive: a subsequent valid message (a mode lock, observable via its audit /
  // an invalid-mode error path) still works.
  const { port, teardown } = await boot();
  try {
    const ws = await open(port);
    await waitFor(ws, (m) => m.type === "hello");

    // Send the removed message — must not crash the handler or drop the socket.
    send(ws, { type: "recall", n: 1 });

    // Prove the socket is still alive + processing: an invalid mode draws the
    // kernel's error reply (the message round-trips after the no-op recall).
    send(ws, { type: "mode", mode: "not-a-real-mode" });
    const err = await waitFor(ws, (m) => m.type === "error");
    assert.match(err.message, /invalid mode/, "the connection still processes messages after the dropped recall");
    assert.equal(ws.readyState, WebSocket.OPEN, "the socket stayed open through the unknown message");
    ws.close();
  } finally { await teardown(); }
});
