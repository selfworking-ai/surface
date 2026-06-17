// Pure validators + shapers for the Surface MCP console (src/adapters/mcp/validators.mjs).
// surface-console.mjs attaches stdin/SIGTERM at import and exports nothing, so the
// validation/shaping rules can only be unit-tested through this extracted pure half.
// We assert the EXACT throw messages (the *Impl functions must behave identically)
// and the G3 liveness invariant: anything-not-explicit-allow DENIES.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePatchArgs, validateRenderArgs, normalizeAskArgs, shapeAskResult,
  denyResponse, shapePermissionResponse, parseScreenshotResult,
} from "../src/adapters/mcp/validators.mjs";

// ── validatePatchArgs ───────────────────────────────────────────────────────────

test("validatePatchArgs returns {ops} for a non-empty array", () => {
  const ops = [{ op: "mount", id: "a", component: "metric" }];
  assert.deepEqual(validatePatchArgs({ ops }), { ops });
});

test("validatePatchArgs throws on non-array / empty / missing ops", () => {
  const msg = "patch requires a non-empty `ops` array";
  assert.throws(() => validatePatchArgs({ ops: [] }), { message: msg });
  assert.throws(() => validatePatchArgs({ ops: "nope" }), { message: msg });
  assert.throws(() => validatePatchArgs({}), { message: msg });
  assert.throws(() => validatePatchArgs(undefined), { message: msg });
  assert.throws(() => validatePatchArgs(null), { message: msg });
});

// ── validateRenderArgs ──────────────────────────────────────────────────────────

test("validateRenderArgs returns {html} for a non-empty string", () => {
  assert.deepEqual(validateRenderArgs({ html: "<div/>" }), { html: "<div/>" });
});

test("validateRenderArgs throws on non-string / empty / whitespace-only html", () => {
  const msg = "render requires non-empty `html`";
  assert.throws(() => validateRenderArgs({ html: "" }), { message: msg });
  assert.throws(() => validateRenderArgs({ html: "   " }), { message: msg }, "whitespace-only rejected");
  assert.throws(() => validateRenderArgs({ html: 42 }), { message: msg });
  assert.throws(() => validateRenderArgs({}), { message: msg });
  assert.throws(() => validateRenderArgs(undefined), { message: msg });
});

// ── normalizeAskArgs (errors thrown IN ORDER) ───────────────────────────────────

test("normalizeAskArgs returns a normalized {question, context, options}", () => {
  const out = normalizeAskArgs({
    question: "Pick one",
    context: "because",
    options: [{ label: "Yes", value: "y" }, { label: "No", value: "n", freeText: true }],
  });
  assert.equal(out.question, "Pick one");
  assert.equal(out.context, "because");
  assert.deepEqual(out.options, [
    { label: "Yes", value: "y", freeText: false },
    { label: "No", value: "n", freeText: true },
  ]);
});

test("normalizeAskArgs: context is a string passthrough else undefined", () => {
  assert.equal(normalizeAskArgs({ question: "q", options: [{ label: "a", value: "b" }] }).context, undefined);
  assert.equal(normalizeAskArgs({ question: "q", context: 42, options: [{ label: "a", value: "b" }] }).context, undefined);
  assert.equal(normalizeAskArgs({ question: "q", context: "x", options: [{ label: "a", value: "b" }] }).context, "x");
});

test("normalizeAskArgs: freeText is STRICT === true (truthy non-true → false)", () => {
  const out = normalizeAskArgs({ question: "q", options: [{ label: "a", value: "b", freeText: "yes" }] });
  assert.equal(out.options[0].freeText, false, "freeText:'yes' (truthy) coerces to false — only === true counts");
});

test("normalizeAskArgs throws on a missing / non-string question (first)", () => {
  const msg = "ask requires `question` (string)";
  assert.throws(() => normalizeAskArgs({ options: [{ label: "a", value: "b" }] }), { message: msg });
  assert.throws(() => normalizeAskArgs({ question: "", options: [{ label: "a", value: "b" }] }), { message: msg });
  assert.throws(() => normalizeAskArgs({ question: 42, options: [{ label: "a", value: "b" }] }), { message: msg });
  assert.throws(() => normalizeAskArgs(undefined), { message: msg });
});

test("normalizeAskArgs throws on a non-array / empty options array", () => {
  const msg = "ask requires a non-empty `options` array";
  assert.throws(() => normalizeAskArgs({ question: "q" }), { message: msg });
  assert.throws(() => normalizeAskArgs({ question: "q", options: [] }), { message: msg });
  assert.throws(() => normalizeAskArgs({ question: "q", options: "nope" }), { message: msg });
});

test("normalizeAskArgs throws on more than 6 options", () => {
  const opts = Array.from({ length: 7 }, (_, i) => ({ label: `l${i}`, value: `v${i}` }));
  assert.throws(() => normalizeAskArgs({ question: "q", options: opts }), { message: "ask supports at most 6 options" });
});

test("normalizeAskArgs accepts exactly 6 options (boundary)", () => {
  const opts = Array.from({ length: 6 }, (_, i) => ({ label: `l${i}`, value: `v${i}` }));
  assert.equal(normalizeAskArgs({ question: "q", options: opts }).options.length, 6);
});

test("normalizeAskArgs throws per-option with the offending index", () => {
  assert.throws(
    () => normalizeAskArgs({ question: "q", options: ["nope"] }),
    { message: "option 0 must be {label, value, freeText?}" },
  );
  assert.throws(
    () => normalizeAskArgs({ question: "q", options: [null] }),
    { message: "option 0 must be {label, value, freeText?}" },
  );
  assert.throws(
    () => normalizeAskArgs({ question: "q", options: [{ value: "b" }] }),
    { message: "option 0 needs a string `label`" },
  );
  assert.throws(
    () => normalizeAskArgs({ question: "q", options: [{ label: "a" }] }),
    { message: "option 0 needs a string `value`" },
  );
  // the index reflects the FIRST bad option (here the 2nd entry → index 1)
  assert.throws(
    () => normalizeAskArgs({ question: "q", options: [{ label: "a", value: "b" }, { label: "c" }] }),
    { message: "option 1 needs a string `value`" },
  );
});

// ── shapeAskResult ──────────────────────────────────────────────────────────────

test("shapeAskResult: cancelled with a string reason", () => {
  assert.equal(
    shapeAskResult({ cancelled: true, reason: "changed mind" }),
    JSON.stringify({ cancelled: true, reason: "changed mind" }),
  );
});

test("shapeAskResult: cancelled with a non-string reason falls back", () => {
  assert.equal(
    shapeAskResult({ cancelled: true, reason: 42 }),
    JSON.stringify({ cancelled: true, reason: "user did not pick" }),
  );
  assert.equal(
    shapeAskResult({ cancelled: 1 }),
    JSON.stringify({ cancelled: true, reason: "user did not pick" }),
    "any truthy cancelled triggers the cancelled shape",
  );
});

test("shapeAskResult: a picked answer → {label, value}", () => {
  assert.equal(
    shapeAskResult({ label: "Yes", value: "y" }),
    JSON.stringify({ label: "Yes", value: "y" }),
  );
});

test("shapeAskResult: non-string label/value coerce to empty strings", () => {
  assert.equal(shapeAskResult({ label: 1, value: 2 }), JSON.stringify({ label: "", value: "" }));
  assert.equal(shapeAskResult({}), JSON.stringify({ label: "", value: "" }));
});

test("shapeAskResult(undefined) → {label:'', value:''}", () => {
  assert.equal(shapeAskResult(undefined), JSON.stringify({ label: "", value: "" }));
});

// ── denyResponse ────────────────────────────────────────────────────────────────

test("denyResponse builds {behavior:'deny', message} verbatim", () => {
  assert.equal(denyResponse("nope"), JSON.stringify({ behavior: "deny", message: "nope" }));
});

// ── shapePermissionResponse (G3: anything-not-explicit-allow DENIES) ─────────────

test("shapePermissionResponse: allow passes updatedInput through", () => {
  assert.equal(
    shapePermissionResponse({ behavior: "allow", updatedInput: { x: 1 } }, { x: 0 }),
    JSON.stringify({ behavior: "allow", updatedInput: { x: 1 } }),
  );
});

test("shapePermissionResponse: allow with no updatedInput falls back to the original input", () => {
  assert.equal(
    shapePermissionResponse({ behavior: "allow" }, { orig: true }),
    JSON.stringify({ behavior: "allow", updatedInput: { orig: true } }),
  );
});

test("G3 liveness: anything-not-explicit-allow DENIES", () => {
  // undefined / missing / empty / explicit deny / unknown behavior — all deny.
  assert.equal(shapePermissionResponse(undefined, { x: 0 }), denyResponse("denied"));
  assert.equal(shapePermissionResponse({}, { x: 0 }), denyResponse("denied"));
  assert.equal(shapePermissionResponse({ behavior: "weird" }, { x: 0 }), denyResponse("denied"));
  assert.equal(
    shapePermissionResponse({ behavior: "deny", message: "x" }, { x: 0 }),
    denyResponse("x"),
    "an explicit deny carries its message through",
  );
});

test("G3 liveness: the two surface-console deny strings route through denyResponse", () => {
  // surface-console.mjs hands these messages to denyResponse when the side channel
  // has no tool_name / errors out — pin the exact serialized shape.
  assert.equal(
    denyResponse("permission_prompt called without tool_name"),
    JSON.stringify({ behavior: "deny", message: "permission_prompt called without tool_name" }),
  );
  const errMsg = "permission side channel error: boom";
  assert.equal(
    denyResponse(errMsg),
    JSON.stringify({ behavior: "deny", message: errMsg }),
  );
});

// ── parseScreenshotResult ───────────────────────────────────────────────────────

test("parseScreenshotResult: unavailable → message string with the reason", () => {
  assert.equal(parseScreenshotResult(undefined), "No screenshot available (nothing to capture).");
  assert.equal(parseScreenshotResult({ ok: false }), "No screenshot available (nothing to capture).");
  assert.equal(parseScreenshotResult({ ok: true }), "No screenshot available (nothing to capture).", "ok but no dataUrl");
  assert.equal(
    parseScreenshotResult({ ok: false, reason: "no canvas yet" }),
    "No screenshot available (no canvas yet).",
  );
});

test("parseScreenshotResult: malformed data-url → message string", () => {
  assert.equal(
    parseScreenshotResult({ ok: true, dataUrl: "not-a-data-url" }),
    "Screenshot returned malformed image data.",
  );
  assert.equal(
    parseScreenshotResult({ ok: true, dataUrl: "data:text/plain;base64,QUJD" }),
    "Screenshot returned malformed image data.",
    "non-image mime rejected by the data:image/... regex",
  );
});

test("parseScreenshotResult: good PNG → [text, image] content with mime + data split out", () => {
  const out = parseScreenshotResult({ ok: true, dataUrl: "data:image/png;base64,AAAA" });
  assert.ok(typeof out === "object" && Array.isArray(out.content));
  assert.equal(out.content.length, 2);
  assert.equal(out.content[0].type, "text");
  assert.equal(out.content[1].type, "image");
  assert.equal(out.content[1].mimeType, "image/png");
  assert.equal(out.content[1].data, "AAAA");
  assert.match(out.content[0].text, /The user has drawn on the screen\./);
});

test("parseScreenshotResult: annotated overlaps phrase lists the components", () => {
  const out = parseScreenshotResult({ ok: true, dataUrl: "data:image/jpeg;base64,ZZZZ", annotated: ["a", "b"] });
  assert.equal(out.content[1].mimeType, "image/jpeg", "mime is read from the data-url, not assumed png");
  assert.match(out.content[0].text, /The user's drawing overlaps: a; b\./);
});

test("parseScreenshotResult: empty annotated array uses the generic drawn phrase", () => {
  const out = parseScreenshotResult({ ok: true, dataUrl: "data:image/png;base64,AAAA", annotated: [] });
  assert.match(out.content[0].text, /The user has drawn on the screen\./);
});
