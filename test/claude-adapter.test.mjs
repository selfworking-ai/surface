// Claude Code adapter — unit tests for the PURE stream-json → TurnEvent mapping
// and the adapter's capability declaration. We deliberately do NOT spawn a real
// `claude` (no binary in CI); `mapClaudeEvent` is factored out so the translation
// layer — the part that actually has logic — is testable in isolation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeCodeAdapter, mapClaudeEvent } from "../src/adapters/claude-code.mjs";

test("system/init maps to session_started carrying the session id", () => {
  const evt = mapClaudeEvent({ type: "system", subtype: "init", session_id: "sess-abc", model: "claude-opus-4-8" });
  assert.deepEqual(evt, { kind: "session_started", id: "sess-abc" });
});

test("system/init without a session_id maps to null", () => {
  assert.equal(mapClaudeEvent({ type: "system", subtype: "init" }), null);
});

test("a streaming content_block_start tool_use maps to a tool_call", () => {
  const evt = mapClaudeEvent({
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "tool_use", id: "tu_1", name: "mcp__surface__patch", input: {} } },
  });
  assert.deepEqual(evt, { kind: "tool_call", id: "tu_1", name: "mcp__surface__patch", args: {} });
});

test("a non-tool_use content_block_start maps to null", () => {
  const evt = mapClaudeEvent({
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "text", text: "" } },
  });
  assert.equal(evt, null);
});

test("an assistant message with a tool_use block maps to a tool_call", () => {
  const evt = mapClaudeEvent({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tu_2", name: "mcp__surface__ask", input: { question: "?" } }] },
  });
  assert.deepEqual(evt, { kind: "tool_call", id: "tu_2", name: "mcp__surface__ask", args: { question: "?" } });
});

test("an assistant message with only usage maps to usage with SUMMED input tokens", () => {
  const evt = mapClaudeEvent({
    type: "assistant",
    message: {
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "thinking" }],
      usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 42 },
    },
  });
  assert.deepEqual(evt, { kind: "usage", model: "claude-opus-4-8", inputTokens: 125, outputTokens: 42 });
});

test("the result event maps to usage (the turn totals)", () => {
  const evt = mapClaudeEvent({
    type: "result",
    model: "claude-opus-4-8",
    usage: { input_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 80 },
  });
  assert.deepEqual(evt, { kind: "usage", model: "claude-opus-4-8", inputTokens: 200, outputTokens: 80 });
});

test("usage tolerates missing token fields (defaults to 0)", () => {
  const evt = mapClaudeEvent({ type: "result", usage: { input_tokens: 10 } });
  assert.deepEqual(evt, { kind: "usage", model: undefined, inputTokens: 10, outputTokens: 0 });
});

test("an unrelated event maps to null", () => {
  assert.equal(mapClaudeEvent({ type: "stream_event", event: { type: "content_block_delta" } }), null);
  assert.equal(mapClaudeEvent({ type: "user", message: { content: [] } }), null);
  assert.equal(mapClaudeEvent(null), null);
  assert.equal(mapClaudeEvent("nope"), null);
});

test("capabilities declare Tier B + MCP presentation", () => {
  const a = claudeCodeAdapter();
  assert.equal(a.name, "claude-code");
  assert.equal(a.capabilities.orgTier, "B");
  assert.equal(a.capabilities.presentation, "mcp");
  assert.equal(a.capabilities.resume, true);
  assert.equal(a.capabilities.permissionPrompt, true);
  assert.equal(a.capabilities.turnBoundary, "result-event");
  assert.deepEqual(a.capabilities.namespaces, ["claude.subagents"]);
});
