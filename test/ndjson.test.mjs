// Unit coverage for the line-buffered NDJSON reader (gotcha G4 — the foundational
// subprocess parser every stdout adapter shares). A child's stdout does NOT hand
// you one line per chunk: a JSON object can arrive split across two chunks, and one
// chunk can carry several lines plus a dangling partial. These tests pin the rolling
// buffer's contract directly (no server, no subprocess): split semantics, cross-chunk
// reassembly, CRLF tolerance, noise/blank-line skipping, final-record flush, and the
// silent drop of an unparseable trailing tail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLines, readNdjson } from "../src/adapter-sdk/ndjson.mjs";

// Feed readNdjson from an explicit list of chunks (string|Buffer), in order.
async function* chunks(...cs) {
  for (const c of cs) yield c;
}
async function collect(readable) {
  const out = [];
  for await (const v of readNdjson(readable)) out.push(v);
  return out;
}

// ── splitLines (pure) ──────────────────────────────────────────────────────────

test("splitLines: N complete lines + a dangling partial → N lines + rest", () => {
  const { lines, rest } = splitLines("a\nbb\nccc\npart");
  assert.deepEqual(lines, ["a", "bb", "ccc"]);
  assert.equal(rest, "part", "everything after the final newline is the carried remainder");
});

test("splitLines: a buffer ending in a newline leaves an empty remainder", () => {
  const { lines, rest } = splitLines("one\ntwo\n");
  assert.deepEqual(lines, ["one", "two"]);
  assert.equal(rest, "", "no dangling partial when the buffer is newline-terminated");
});

test("splitLines: CRLF lines get the trailing \\r trimmed", () => {
  const { lines, rest } = splitLines("a\r\nb\r\nc\r");
  assert.deepEqual(lines, ["a", "b"], "each completed CRLF line drops its \\r");
  assert.equal(rest, "c\r", "the dangling partial is returned verbatim (not yet a line)");
});

test("splitLines: empty buffer → no lines, empty rest", () => {
  assert.deepEqual(splitLines(""), { lines: [], rest: "" });
});

// ── readNdjson (cross-chunk, async) ──────────────────────────────────────────────

test("readNdjson: an object SPLIT across two chunks parses once, whole", async () => {
  const got = await collect(chunks('{"a":1,', '"b":2}\n'));
  assert.deepEqual(got, [{ a: 1, b: 2 }], "the rolling buffer reassembles across the chunk boundary");
});

test("readNdjson: one chunk with several lines + a partial yields each whole object, carries the partial", async () => {
  // Two complete records and a dangling partial in the first chunk; the partial
  // completes in the second. Order must be preserved.
  const got = await collect(chunks('{"n":1}\n{"n":2}\n{"n":', '3}\n'));
  assert.deepEqual(got, [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test("readNdjson: blank lines and non-JSON noise lines are SKIPPED, not thrown", async () => {
  // Banner noise + blank lines interleaved with real records — a malformed line must
  // never abort the turn; it is silently skipped.
  const got = await collect(chunks(
    "starting up...\n",
    "\n",
    '{"ok":true}\n',
    "   \n",
    "not json at all\n",
    '{"done":1}\n',
  ));
  assert.deepEqual(got, [{ ok: true }, { done: 1 }], "only parseable JSON lines survive, in order");
});

test("readNdjson: the FINAL newline-less record is flushed on stream end", async () => {
  // Some processes don't newline-terminate their last record; it must still arrive.
  const got = await collect(chunks('{"first":1}\n', '{"last":2}'));
  assert.deepEqual(got, [{ first: 1 }, { last: 2 }]);
});

test("readNdjson: a trailing incomplete (unparseable) tail is dropped silently", async () => {
  // A truncated final fragment (process killed mid-write) is dropped, not thrown,
  // and must not corrupt the records that did complete.
  const got = await collect(chunks('{"good":1}\n', '{"trunc":'));
  assert.deepEqual(got, [{ good: 1 }], "the good record survives; the truncated tail vanishes");
});

test("readNdjson: Buffer chunks are decoded as utf8 just like strings", async () => {
  const got = await collect(chunks(Buffer.from('{"x":'), Buffer.from('"héllo"}\n')));
  assert.deepEqual(got, [{ x: "héllo" }], "Buffer chunks reassemble + decode identically to strings");
});

test("readNdjson: an empty stream yields nothing", async () => {
  assert.deepEqual(await collect(chunks()), []);
});
