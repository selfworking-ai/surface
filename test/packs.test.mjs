// M5 starter packs — manifest validity, seed composition, install, export/import
// round-trip, and the visitor-mode lockdown end-to-end. Packs are userspace apps:
// each seeds the canvas from REGISTERED built-in components only. These tests pin
// that contract so a future pack edit can't drift off the built-in vocabulary or
// break the install/seed path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import {
  validatePackManifest,
  installPack,
  exportPack,
  importPack,
} from "../src/pack-sdk/index.mjs";
import { Workspace } from "../src/kernel/workspace.mjs";
import { createSurface } from "../src/kernel/server.mjs";
import { echoAdapter } from "../src/adapters/echo.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

import missionControlPack from "../packs/mission-control/index.mjs";
import businessOsPack from "../packs/business-os/index.mjs";
import agenticSitePack from "../packs/agentic-site/index.mjs";

// The built-in component vocabulary a pack may compose from (design-system.md).
const BUILTINS = ["metric", "hero", "list", "status", "text", "kv"];

const STARTERS = [
  ["mission-control", missionControlPack],
  ["business-os", businessOsPack],
  ["agentic-site", agenticSitePack],
];

// ── Manifest validation ─────────────────────────────────────────────────────

test("validatePackManifest accepts each starter's manifest", () => {
  for (const [name, pack] of STARTERS) {
    const v = validatePackManifest(pack.manifest);
    assert.equal(v.ok, true, `${name}: ${v.ok ? "" : v.error}`);
  }
});

test("validatePackManifest rejects a bad permissionProfile", () => {
  const bad = { ...missionControlPack.manifest, permissionProfile: "root" };
  const v = validatePackManifest(bad);
  assert.equal(v.ok, false);
  assert.equal(v.error, "manifest-needs-valid-permissionProfile");
});

test("validatePackManifest rejects a manifest missing components", () => {
  const { components: _drop, ...bad } = missionControlPack.manifest;
  const v = validatePackManifest(bad);
  assert.equal(v.ok, false);
  assert.equal(v.error, "manifest-needs-components-array");
});

// ── Seed composition (per starter) ──────────────────────────────────────────

for (const [name, pack] of STARTERS) {
  test(`${name}: seed() is a non-empty array of valid mount ops over built-ins`, () => {
    const ops = pack.seed();
    assert.ok(Array.isArray(ops) && ops.length > 0, "seed returns a non-empty array");

    const ids = new Set();
    for (const op of ops) {
      assert.equal(op.op, "mount", `every seed op is a mount (got "${op.op}")`);
      assert.equal(typeof op.id, "string");
      assert.ok(op.id, "mount has a non-empty id");
      assert.ok(BUILTINS.includes(op.component), `"${op.component}" is a built-in component`);
      assert.ok(!ids.has(op.id), `id "${op.id}" is unique within the pack`);
      ids.add(op.id);
    }

    // Every component the manifest declares is one of the built-ins, too.
    for (const c of pack.manifest.components) {
      assert.ok(BUILTINS.includes(c), `manifest component "${c}" is a built-in`);
    }
  });
}

// ── installPack seeds a fresh Workspace ───────────────────────────────────────

for (const [name, pack] of STARTERS) {
  test(`${name}: installPack seeds a fresh Workspace with layout + components`, () => {
    const ws = new Workspace();
    installPack(pack, { workspace: ws });

    // size == number of mounted components == number of seed mount ops.
    const mountCount = pack.seed().filter((o) => o.op === "mount").length;
    assert.equal(ws.size, mountCount, "one mounted component per seed mount op");
    assert.equal(typeof ws.doc.layout.columns, "number", "layout.columns is set");
    assert.equal(ws.doc.layout.columns, pack.manifest.layout.columns);
  });
}

// ── export / import round-trip ────────────────────────────────────────────────

for (const [name, pack] of STARTERS) {
  test(`${name}: exportPack → importPack round-trips`, () => {
    const exported = exportPack(pack);
    assert.equal(typeof exported.manifest, "object");
    assert.ok(Array.isArray(exported.ops) && exported.ops.length > 0);

    const reimported = importPack(exported);
    assert.equal(reimported.manifest.name, pack.manifest.name, "same manifest name");
    assert.equal(reimported.seed().length, pack.seed().length, "same number of seed ops");
  });
}

// ── agentic-site is visitor-profile ───────────────────────────────────────────

test("agentic-site runs under the visitor permission profile", () => {
  assert.equal(agenticSitePack.manifest.permissionProfile, "visitor");
});

// ── Visitor lockdown (end-to-end through the kernel) ──────────────────────────
// Boot a real Surface seeded with the agentic-site pack, connect a ws client, and
// assert: (a) the seeded hero arrives on connect; (b) a visitor prompt is blocked.

const send = (ws, obj) => ws.send(JSON.stringify({ v: 1, ...obj }));

// Wait for the next unconsumed message matching `pred` (cursor advances past each
// match). The inbox fills from BEFORE `open` resolves so the synchronous
// hello/capabilities/initial-patch are never missed. Mirrors test/integration.test.mjs.
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
  ws.on("message", (data) => {       // attached before `open` → captures synchronous hello + seeded patch
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

test("agentic-site seeds the canvas on connect and visitor mode blocks generation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-packs-"));
  const surface = createSurface({
    adapter: echoAdapter(),
    port: 0,
    host: "127.0.0.1",
    openBrowser: false,
    store: new FileStore({ dir }),
    pack: agenticSitePack,
  });
  const { port } = await surface.listen();
  try {
    const ws = await open(port);

    // (a) On connect the seeded composition arrives — including the pack's hero id.
    const heroId = agenticSitePack.seed().find((o) => o.component === "hero").id;
    const patch = await waitFor(ws, (m) => m.type === "patch" && m.ops.some((o) => o.id === heroId));
    assert.ok(patch.ops.some((o) => o.id === heroId), "the seeded hero is painted on connect");

    // (b) Visitor mode is curated-only: a prompt is rejected (the lockdown).
    send(ws, { type: "mode", mode: "visitor" });
    send(ws, { type: "prompt", text: "hack" });
    const err = await waitFor(ws, (m) => m.type === "error");
    assert.match(err.message, /visitor/i, "generation is blocked in visitor mode");

    ws.close();
  } finally {
    await surface.close();
    await rm(dir, { recursive: true, force: true });
  }
});
