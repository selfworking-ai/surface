// AuditSink implementations — the audit anchor. Surface holds the human principal
// at the human↔runtime edge, so it is the natural place to attribute mutating
// actions to a human. The kernel calls `record({ principal, action, ts, data })`
// on EVERY mutating action ("turn.start", "mode.lock", "ask.answer",
// "permission.allow", "permission.deny", "frame.commit") — fire-and-forget, so a
// sink's `record()` may be async but MUST NEVER throw (a throwing/ rejecting sink
// must not break or block a turn). See provider-sdk/ports.d.ts (AuditSink).
//
// Three shipped sinks, factory-per-impl like FileStore (`fooAuditSink(opts)`):
//   fileAuditSink({ dir })  append a JSON line per event to <dir>/audit.jsonl
//   consoleAuditSink()      one-line [audit] … to stderr (dev / ephemeral)
//   noopAuditSink()         discard (matches the kernel default; explicit export)
//
// All persist ONLY presentation-side attribution metadata — never cognition or
// org state (the runtime owns those).

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_DIR = "./.surface";

/**
 * File-backed AuditSink: appends one JSON line per event to `<dir>/audit.jsonl`.
 * Mirrors FileStore's `_ensure()` (lazy, idempotent mkdir) so it composes with
 * the same persistence dir (`SURFACE_DIR`). Append-only — the log is the record.
 * @param {{ dir?: string }} [opts]
 * @returns {import("../provider-sdk/ports").AuditSink}
 */
export function fileAuditSink({ dir } = {}) {
  return new FileAuditSink({ dir });
}

class FileAuditSink {
  constructor({ dir } = {}) {
    this.id = "file";
    this.dir = dir || DEFAULT_DIR;
    this._ensured = null;
  }

  _ensure() {
    if (!this._ensured) this._ensured = mkdir(this.dir, { recursive: true });
    return this._ensured;
  }

  _file() { return join(this.dir, "audit.jsonl"); }

  /** @param {{ principal:string, action:string, agent?:string, ts:number, data?:unknown }} e */
  async record(e) {
    // Never throw: a failed audit write must not break the turn. Best-effort.
    try {
      await this._ensure();
      await appendFile(this._file(), JSON.stringify(e) + "\n", "utf8");
    } catch (err) {
      // Surface the failure where an operator can see it, but swallow it.
      console.error("[audit] write failed:", err?.message ?? err);
    }
  }
}

/**
 * Read back a file audit log (parsed records, oldest → newest). For tests/tools
 * — the kernel never reads audit back. Missing log → []. Mirrors FileStore's
 * tolerant jsonl reader (skip malformed lines rather than throw).
 * @param {string} [dir]
 * @returns {Promise<Array<{ principal:string, action:string, agent?:string, ts:number, data?:unknown }>>}
 */
export async function readAudit(dir = DEFAULT_DIR) {
  try {
    const txt = await readFile(join(dir, "audit.jsonl"), "utf8");
    return txt.split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Console AuditSink: logs a compact one-liner per event to stderr. For dev and
 * ephemeral runs where a durable log isn't wanted but you still want to see who
 * did what. Format: `[audit] <ts-iso> <principal> <action>`.
 * @returns {import("../provider-sdk/ports").AuditSink}
 */
export function consoleAuditSink() {
  return {
    id: "console",
    async record(e) {
      try {
        const ts = Number.isFinite(e?.ts) ? new Date(e.ts).toISOString() : String(e?.ts);
        console.error(`[audit] ${ts} ${e?.principal ?? "anonymous"} ${e?.action ?? "?"}`);
      } catch { /* never throw */ }
    },
  };
}

/**
 * No-op AuditSink: discards every event. Identical in behavior to the kernel's
 * built-in default; exported so a host can wire "explicitly no audit" and so the
 * default is nameable/testable. `record()` resolves immediately, never throws.
 * @returns {import("../provider-sdk/ports").AuditSink}
 */
export function noopAuditSink() {
  return { id: "noop", async record() { /* discard */ } };
}

export default fileAuditSink;
