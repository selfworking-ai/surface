// Data broker (M3) — topic pub/sub fan-out. The "living UI" substrate: a source
// publishes to a topic; every subscribed component re-renders. Producer/consumer
// are decoupled (neither knows the other).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Broker } from "../src/kernel/broker.mjs";

test("publish fans out to every subscriber and returns the count", () => {
  const b = new Broker();
  const got = [];
  b.subscribe("metrics", (d) => got.push(["a", d]));
  b.subscribe("metrics", (d) => got.push(["b", d]));
  const n = b.publish("metrics", { v: 1 });
  assert.equal(n, 2);
  assert.deepEqual(got, [["a", { v: 1 }], ["b", { v: 1 }]]);
});

test("publish to a topic with no subscribers is a no-op (0)", () => {
  assert.equal(new Broker().publish("nobody", 1), 0);
});

test("unsubscribe detaches and is idempotent; topic pruned when empty", () => {
  const b = new Broker();
  const seen = [];
  const off = b.subscribe("t", (d) => seen.push(d));
  b.publish("t", "first");
  off();
  off();                       // idempotent — no throw
  b.publish("t", "second");    // detached → not delivered
  assert.deepEqual(seen, ["first"]);
  assert.deepEqual(b.topics(), []);   // empty topic pruned
});

test("a throwing subscriber is isolated — others still receive", () => {
  const b = new Broker();
  const ok = [];
  b.subscribe("t", () => { throw new Error("bad subscriber"); });
  b.subscribe("t", (d) => ok.push(d));
  assert.doesNotThrow(() => b.publish("t", 42));
  assert.deepEqual(ok, [42]);
});

test("subscribers can (un)subscribe during a publish without corrupting dispatch", () => {
  const b = new Broker();
  const order = [];
  const off2 = () => {};
  b.subscribe("t", () => { order.push(1); b.subscribe("t", () => order.push("late")); });
  b.subscribe("t", () => order.push(2));
  b.publish("t", null);        // snapshot semantics → "late" not called this round
  assert.deepEqual(order, [1, 2]);
});

test("topics() lists only topics with live subscribers", () => {
  const b = new Broker();
  b.subscribe("x", () => {});
  b.subscribe("y", () => {});
  assert.deepEqual(b.topics().sort(), ["x", "y"]);
});
