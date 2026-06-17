// SignalSink implementations — the self-improvement signal anchor. "The signal is
// the hard part — design it first or it's theater." So Surface records ONLY real,
// observed signals (never vibes) and lets the gardener/smith propose + validate;
// the actual generation of revised component code stays the console agent's gated
// job. The kernel calls `record({ kind, component, ts, data })` on every observed
// signal — fire-and-forget, so a sink's `record()` may be async but MUST NEVER
// throw (a throwing/rejecting sink must not break or block a turn).
//
// The signals (all genuine observations, see gardener.mjs for the weights):
//   render-error      a patch op was rejected / a component failed to render
//   unknown-component the agent mounted a name the client had to fall back on
//   markup            a user drew freehand over a component (confusion / interest)
//   dismiss           the component was removed quickly (low utility)
//   dwell             the component stayed on screen a while (healthy — credit)
//
// Three shipped sinks, factory-per-impl like FileStore / the AuditSink trio
// (`fooSignalSink(opts)`):
//   fileSignalSink({ dir })  append a JSON line per signal to <dir>/signals.jsonl
//   consoleSignalSink()      one-line [signal] … to stderr (dev / ephemeral)
//   noopSignalSink()         discard (matches the kernel default; explicit export)

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_DIR = "./.surface";

/**
 * File-backed SignalSink: appends one JSON line per signal to `<dir>/signals.jsonl`.
 * Mirrors FileStore's `_ensure()` (lazy, idempotent mkdir) so it composes with the
 * same persistence dir (`SURFACE_DIR`). Append-only — the log is the record, and
 * the gardener reads it back via {@link readSignals}.
 * @param {{ dir?: string }} [opts]
 * @returns {import("../provider-sdk/ports").SignalSink}
 */
export function fileSignalSink({ dir } = {}) {
  return new FileSignalSink({ dir });
}

class FileSignalSink {
  constructor({ dir } = {}) {
    this.id = "file";
    this.dir = dir || DEFAULT_DIR;
    this._ensured = null;
  }

  _ensure() {
    if (!this._ensured) this._ensured = mkdir(this.dir, { recursive: true });
    return this._ensured;
  }

  _file() { return join(this.dir, "signals.jsonl"); }

  /** @param {{ kind:string, component?:string|null, ts:number, data?:unknown }} s */
  async record(s) {
    // Never throw: a failed signal write must not break the turn. Best-effort.
    try {
      await this._ensure();
      await appendFile(this._file(), JSON.stringify(s) + "\n", "utf8");
    } catch (err) {
      // Surface the failure where an operator can see it, but swallow it.
      console.error("[signal] write failed:", err?.message ?? err);
    }
  }
}

/**
 * Read back a file signal log (parsed records, oldest → newest) — the input the
 * gardener's `reviewSignals` aggregates over (and what tests assert on). Missing
 * log → []. Mirrors FileStore's tolerant jsonl reader (skip malformed lines).
 * @param {string} [dir]
 * @returns {Promise<Array<{ kind:string, component?:string|null, ts:number, data?:unknown }>>}
 */
export async function readSignals(dir = DEFAULT_DIR) {
  try {
    const txt = await readFile(join(dir, "signals.jsonl"), "utf8");
    return txt.split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Console SignalSink: logs a compact one-liner per signal to stderr. For dev and
 * ephemeral runs where a durable log isn't wanted but you still want to watch the
 * signals flow. Format: `[signal] <ts-iso> <kind> <component>`.
 * @returns {import("../provider-sdk/ports").SignalSink}
 */
export function consoleSignalSink() {
  return {
    id: "console",
    async record(s) {
      try {
        const ts = Number.isFinite(s?.ts) ? new Date(s.ts).toISOString() : String(s?.ts);
        console.error(`[signal] ${ts} ${s?.kind ?? "?"} ${s?.component ?? "(none)"}`);
      } catch { /* never throw */ }
    },
  };
}

/**
 * No-op SignalSink: discards every signal. Identical in behavior to the kernel's
 * built-in default; exported so a host can wire "explicitly no signals" and so the
 * default is nameable/testable. `record()` resolves immediately, never throws.
 * @returns {import("../provider-sdk/ports").SignalSink}
 */
export function noopSignalSink() {
  return { id: "noop", async record() { /* discard */ } };
}

export default fileSignalSink;
