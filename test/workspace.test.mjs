// Workspace document — apply / snapshot / restore / persist invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../src/kernel/workspace.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

test("applyOps mutates the document and returns the applied ops", () => {
  const ws = new Workspace();
  const r = ws.applyOps([{ op: "mount", id: "a", component: "metric", props: { value: "1" } }]);
  assert.equal(r.applied.length, 1);
  assert.equal(ws.size, 1);
  assert.equal(ws.doc.components.a.props.value, "1");
});

test("snapshot → restore round-trips components and layout", () => {
  const ws = new Workspace();
  ws.applyOps([
    { op: "layout", spec: { columns: 3 } },
    { op: "mount", id: "a", component: "metric", props: { value: "1" } },
    { op: "mount", id: "b", component: "list", props: { items: ["x"] } },
  ]);
  const snap = ws.snapshot();
  assert.equal(snap.components.length, 2);
  assert.equal(snap.layout.columns, 3);

  const fresh = new Workspace().restore(snap);
  assert.equal(fresh.size, 2);
  assert.equal(fresh.doc.components.b.props.items[0], "x");
  assert.equal(fresh.doc.layout.columns, 3);
});

test("toOps replays the composition as a layout + mount ops", () => {
  const ws = new Workspace();
  ws.applyOps([{ op: "mount", id: "a", component: "metric" }, { op: "mount", id: "b", component: "metric" }]);
  const ops = ws.toOps();
  assert.equal(ops[0].op, "layout");
  assert.deepEqual(ops.filter((o) => o.op === "mount").map((o) => o.id), ["a", "b"]);
});

test("persist + load round-trip through a StorageProvider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-ws-"));
  try {
    const store = new FileStore({ dir });
    const ws = new Workspace({ session: "sess1", store });
    ws.applyOps([{ op: "mount", id: "a", component: "hero", props: { value: "hello" } }]);
    await ws.persist();

    const reloaded = new Workspace({ session: "sess1", store });
    await reloaded.load();
    assert.equal(reloaded.size, 1);
    assert.equal(reloaded.doc.components.a.props.value, "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("load is a no-op for an unknown session (stays empty)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-ws-"));
  try {
    const ws = new Workspace({ session: "never-saved", store: new FileStore({ dir }) });
    await ws.load();
    assert.equal(ws.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
