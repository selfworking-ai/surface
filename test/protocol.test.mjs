// Surface Protocol codec — framing, version negotiation, patch validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION, MODES, encode, decode, negotiate,
  validatePatch, validatePatchOp, isMode,
} from "../src/protocol/messages.mjs";

test("encode stamps the protocol version and preserves type", () => {
  const wire = encode({ type: "status", state: "idle" });
  const obj = JSON.parse(wire);
  assert.equal(obj.v, PROTOCOL_VERSION);
  assert.equal(obj.type, "status");
  assert.equal(obj.state, "idle");
});

test("encode rejects non-objects and typeless messages", () => {
  assert.throws(() => encode(null));
  assert.throws(() => encode("nope"));
  assert.throws(() => encode([1, 2]));
  assert.throws(() => encode({ noType: true }));
});

test("decode parses, validates, and strips the envelope field", () => {
  const wire = encode({ type: "prompt", text: "hi" });
  const r = decode(wire);
  assert.equal(r.ok, true);
  assert.equal(r.msg.type, "prompt");
  assert.equal(r.msg.text, "hi");
  assert.equal(r.msg.v, undefined, "envelope field stripped for the consumer");
  assert.equal(r.version, PROTOCOL_VERSION);
});

test("decode tolerates a missing v (treats it as current)", () => {
  const r = decode(JSON.stringify({ type: "prompt", text: "x" }));
  assert.equal(r.ok, true);
  assert.equal(r.version, PROTOCOL_VERSION);
});

test("decode rejects bad json, non-objects, and missing type", () => {
  assert.equal(decode("{not json").ok, false);
  assert.equal(decode("42").ok, false);
  assert.equal(decode(JSON.stringify({ noType: 1 })).ok, false);
});

test("decode rejects an incompatible protocol version", () => {
  const r = decode(JSON.stringify({ v: PROTOCOL_VERSION + 1, type: "prompt" }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "incompatible-version");
  assert.equal(r.negotiation.compatible, false);
});

test("negotiate: exact match compatible; differing/invalid incompatible", () => {
  assert.equal(negotiate(PROTOCOL_VERSION).outcome, "exact");
  assert.equal(negotiate(PROTOCOL_VERSION).compatible, true);
  assert.equal(negotiate(PROTOCOL_VERSION + 1).compatible, false);
  assert.equal(negotiate(0).compatible, false);
  assert.equal(negotiate(NaN).compatible, false);
  assert.equal(negotiate("x").compatible, false);
});

test("validatePatchOp accepts the four ops with correct shapes", () => {
  assert.equal(validatePatchOp({ op: "mount", id: "a", component: "metric" }).ok, true);
  assert.equal(validatePatchOp({ op: "update", id: "a", props: {} }).ok, true);
  assert.equal(validatePatchOp({ op: "remove", id: "a" }).ok, true);
  assert.equal(validatePatchOp({ op: "layout", spec: {} }).ok, true);
});

test("validatePatchOp rejects malformed ops", () => {
  assert.equal(validatePatchOp({ op: "mount", id: "a" }).ok, false);          // no component
  assert.equal(validatePatchOp({ op: "mount", component: "x" }).ok, false);   // no id
  assert.equal(validatePatchOp({ op: "update", id: "a" }).ok, false);         // no props
  assert.equal(validatePatchOp({ op: "update", id: "a", props: [] }).ok, false);
  assert.equal(validatePatchOp({ op: "layout" }).ok, false);                  // no spec
  assert.equal(validatePatchOp({ op: "wat" }).ok, false);
  assert.equal(validatePatchOp(null).ok, false);
});

test("validatePatch validates a batch and reports the offending index", () => {
  assert.equal(validatePatch([{ op: "mount", id: "a", component: "m" }]).ok, true);
  const r = validatePatch([{ op: "mount", id: "a", component: "m" }, { op: "remove" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /op\[1\]/);
  assert.equal(validatePatch("nope").ok, false);
});

test("MODES + isMode", () => {
  assert.deepEqual([...MODES], ["operator", "team", "visitor"]);
  assert.equal(isMode("operator"), true);
  assert.equal(isMode("root"), false);
});
