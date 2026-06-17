// Line-buffered NDJSON reader — gotcha G4. A child process's `stdout.on("data")`
// (or any byte stream) does NOT hand you one line per chunk: a single JSON object
// can arrive split across two chunks, and one chunk can carry several lines plus a
// dangling partial. Naive `JSON.parse(chunk)` silently drops messages. The fix is
// a rolling string buffer: append each chunk, slice on every "\n", carry the
// remainder forward. This module is the shared, dependency-free implementation so
// every subprocess adapter parses identically (the M2 Claude adapter, etc.).

/**
 * Split a buffer on newlines into complete lines + a trailing remainder.
 * Pure and allocation-light; the caller keeps `rest` and prepends it next chunk.
 * Handles CRLF by trimming a trailing "\r" off each line.
 * @param {string} buffer the accumulated, not-yet-consumed text
 * @returns {{lines: string[], rest: string}} complete lines, and the dangling tail
 */
export function splitLines(buffer) {
  const lines = [];
  let start = 0;
  let nl;
  // Slice on each "\n"; everything after the final newline is the remainder.
  while ((nl = buffer.indexOf("\n", start)) !== -1) {
    let line = buffer.slice(start, nl);
    if (line.endsWith("\r")) line = line.slice(0, -1); // tolerate CRLF streams
    lines.push(line);
    start = nl + 1;
  }
  return { lines, rest: buffer.slice(start) };
}

/**
 * Async-iterate parsed JSON objects from a readable byte/text stream.
 * Buffers across chunks (G4); skips blank lines and lines that don't parse as
 * JSON (partial frames, banner noise) rather than throwing — a malformed line
 * must never abort the whole turn. Flushes any final unterminated line on stream
 * end (some processes don't newline-terminate their last record).
 *
 * @param {AsyncIterable<Buffer|string>|NodeJS.ReadableStream} readable
 * @returns {AsyncGenerator<any>} parsed JSON values, in arrival order
 *
 * @example
 *   for await (const evt of readNdjson(child.stdout)) handle(evt);
 */
export async function* readNdjson(readable) {
  let buf = "";
  for await (const chunk of readable) {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const { lines, rest } = splitLines(buf);
    buf = rest;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;                 // blank line — skip
      let obj;
      try { obj = JSON.parse(trimmed); } catch { continue; } // partial / noise — skip
      yield obj;
    }
  }
  // Stream ended — flush a final, newline-less record if it parses.
  const tail = buf.trim();
  if (tail) {
    try { yield JSON.parse(tail); } catch { /* incomplete trailing line — drop */ }
  }
}
