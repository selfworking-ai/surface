// Binary resolution — gotcha G1. Agent CLIs (e.g. `claude`) are frequently shell
// ALIASES or shell functions, so `spawn("claude", …)` from Node is ENOENT: Node
// does not read your interactive shell rc. We resolve a real on-disk executable at
// boot and use that path everywhere after. Order: explicit env override → the
// platform locator (`which`/`where`) → a list of well-known install paths → fall
// back to the bare name (let spawn fail loudly with a clear ENOENT if nothing hit).
//
// Subprocess-adapter-only: the M1 echo adapter has no subprocess and never calls
// this. Synchronous on purpose (spawnSync/statSync) — it runs once at adapter init,
// before any turn, so blocking is fine and keeps callers simple.

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

/** True if `p` points at an existing regular file (our proxy for "executable"). */
function isExecutableFile(p) {
  if (!p) return false;
  try { return statSync(p).isFile(); }
  catch { return false; }
}

/**
 * Resolve an agent CLI binary to a concrete path.
 * @param {string} name the command name, e.g. "claude"
 * @param {{ envVar?: string, knownPaths?: string[] }} [opts]
 *   envVar     — name of an env var that, if set, overrides everything (e.g. "CLAUDE_BIN").
 *   knownPaths — absolute fallback paths to probe, in order.
 * @returns {string} an absolute path when found, else the bare `name`.
 */
export function resolveBin(name, { envVar, knownPaths = [] } = {}) {
  // 1) Explicit override wins outright — operators set this to escape resolution.
  if (envVar && process.env[envVar]) return process.env[envVar];

  // 2) Platform locator. `which` (POSIX) / `where` (Windows) consult PATH, which
  //    reflects the environment Node was launched in — usually enough.
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(locator, [name], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) {
      const found = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean)[0];
      if (found && isExecutableFile(found)) return found;
    }
  } catch { /* locator missing (minimal container) — fall through */ }

  // 3) Known install locations (filtered to ones that actually exist).
  for (const p of knownPaths) {
    if (isExecutableFile(p)) return p;
  }

  // 4) Give up gracefully: return the bare name so spawn surfaces a real ENOENT
  //    the caller can report, rather than us inventing a wrong path.
  return name;
}

export default resolveBin;
