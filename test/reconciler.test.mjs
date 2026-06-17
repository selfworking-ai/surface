// Reconciler diff/apply — the retained-mode core invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, emptyDoc, docToOps } from "../src/kernel/reconciler.mjs";

test("emptyDoc is empty with a default 4-col layout", () => {
  const d = emptyDoc();
  assert.deepEqual(d.components, {});
  assert.equal(d.layout.columns, 4);
});

test("mount adds a component and reports it applied", () => {
  const { doc, applied, rejected } = reconcile(emptyDoc(), [
    { op: "mount", id: "a", component: "metric", props: { value: "1" } },
  ]);
  assert.equal(doc.components.a.component, "metric");
  assert.equal(doc.components.a.props.value, "1");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].op, "mount");
  assert.equal(rejected.length, 0);
});

test("mount on an existing id is an UPSERT (props replace, not merge)", () => {
  let { doc } = reconcile(emptyDoc(), [{ op: "mount", id: "a", component: "metric", props: { value: "1", label: "L" } }]);
  ({ doc } = reconcile(doc, [{ op: "mount", id: "a", component: "metric", props: { value: "2" } }]));
  assert.equal(doc.components.a.props.value, "2");
  assert.equal(doc.components.a.props.label, undefined, "upsert replaces props wholesale");
});

test("update shallow-merges props into an existing node", () => {
  let { doc } = reconcile(emptyDoc(), [{ op: "mount", id: "a", component: "metric", props: { value: "1", label: "L" } }]);
  let r;
  ({ doc, ...r } = reconcile(doc, [{ op: "update", id: "a", props: { value: "9" } }]));
  assert.equal(doc.components.a.props.value, "9");
  assert.equal(doc.components.a.props.label, "L", "update keeps untouched props");
  assert.equal(r.applied[0].op, "update");
});

test("update on an unknown id is rejected and leaves the doc unchanged", () => {
  const start = emptyDoc();
  const { doc, applied, rejected } = reconcile(start, [{ op: "update", id: "ghost", props: { x: 1 } }]);
  assert.equal(applied.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].error, /update-unknown-id/);
  assert.deepEqual(doc.components, {});
});

test("remove deletes; remove of an unknown id is rejected", () => {
  let { doc } = reconcile(emptyDoc(), [{ op: "mount", id: "a", component: "metric" }]);
  let r;
  ({ doc, ...r } = reconcile(doc, [{ op: "remove", id: "a" }, { op: "remove", id: "a" }]));
  assert.equal(doc.components.a, undefined);
  assert.equal(r.applied.length, 1);
  assert.equal(r.rejected.length, 1);
});

test("layout merges into the existing layout and reports the merged spec", () => {
  const { doc, applied } = reconcile(emptyDoc(), [{ op: "layout", spec: { density: "compact" } }]);
  assert.equal(doc.layout.columns, 4, "untouched layout keys persist");
  assert.equal(doc.layout.density, "compact");
  assert.equal(applied[0].spec.columns, 4, "applied carries the full merged layout");
});

test("invalid ops are rejected, valid ones still apply", () => {
  const { doc, applied, rejected } = reconcile(emptyDoc(), [
    { op: "mount", id: "", component: "metric" },     // bad id
    { op: "frobnicate" },                              // unknown op
    { op: "mount", id: "ok", component: "metric" },    // good
  ]);
  assert.equal(applied.length, 1);
  assert.equal(rejected.length, 2);
  assert.ok(doc.components.ok);
});

test("reconcile is pure — it does not mutate the input doc", () => {
  const start = emptyDoc();
  const frozen = JSON.stringify(start);
  reconcile(start, [{ op: "mount", id: "a", component: "metric", props: { v: 1 } }]);
  assert.equal(JSON.stringify(start), frozen, "input doc untouched");
});

test("docToOps round-trips a composition, ordered by `at` then insertion", () => {
  let { doc } = reconcile(emptyDoc(), [
    { op: "mount", id: "z", component: "metric", at: 2 },
    { op: "mount", id: "a", component: "metric", at: 1 },
    { op: "mount", id: "m", component: "metric" },     // no `at` → after the ordered ones
    { op: "layout", spec: { columns: 3 } },
  ]);
  const ops = docToOps(doc);
  assert.equal(ops[0].op, "layout");
  assert.equal(ops[0].spec.columns, 3);
  const mountIds = ops.filter((o) => o.op === "mount").map((o) => o.id);
  assert.deepEqual(mountIds, ["a", "z", "m"]);
});
