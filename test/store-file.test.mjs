// FileStore — the default StorageProvider (frames log + workspace + kv on disk).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, fileStore, isValidSessionId } from "../src/providers/store-file.mjs";

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "surface-store-"));
  try { await fn(new FileStore({ dir })); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("appendFrame + listFrames round-trip in order", async () => {
  await withStore(async (store) => {
    await store.appendFrame("s1", { n: 1, ts: "t1", prompt: "a", snapshot: { components: [], layout: {} } });
    await store.appendFrame("s1", { n: 2, ts: "t2", prompt: "b", html: "<i>x</i>" });
    const frames = await store.listFrames("s1");
    assert.equal(frames.length, 2);
    assert.equal(frames[0].n, 1);
    assert.equal(frames[1].prompt, "b");
    assert.equal(frames[1].html, "<i>x</i>");
  });
});

test("listFrames returns [] for an unknown session", async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.listFrames("nope"), []);
  });
});

test("saveWorkspace + loadWorkspace round-trip; unknown → null", async () => {
  await withStore(async (store) => {
    const snap = { components: [{ id: "a", component: "metric", props: { value: "1" } }], layout: { columns: 4 } };
    await store.saveWorkspace("s1", snap);
    assert.deepEqual(await store.loadWorkspace("s1"), snap);
    assert.equal(await store.loadWorkspace("ghost"), null);
  });
});

test("kv get/put round-trip; get of a missing key is undefined", async () => {
  await withStore(async (store) => {
    assert.equal(await store.get("missing"), undefined);
    await store.put("pref:layout", { density: "compact" });
    assert.deepEqual(await store.get("pref:layout"), { density: "compact" });
  });
});

test("appendFrame rejects an invalid session id (path-safety)", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.appendFrame("../escape", { n: 1, ts: "t", prompt: "p" }));
    await assert.rejects(() => store.appendFrame("", { n: 1, ts: "t", prompt: "p" }));
  });
});

test("isValidSessionId guards the same set the store enforces", () => {
  assert.equal(isValidSessionId("abc-123_DEF"), true);
  assert.equal(isValidSessionId("../x"), false);
  assert.equal(isValidSessionId(""), false);
  assert.equal(isValidSessionId("a/b"), false);
});

test("fileStore() factory returns a FileStore", () => {
  assert.ok(fileStore({ dir: "/tmp/x" }) instanceof FileStore);
});
