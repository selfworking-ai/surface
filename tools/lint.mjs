#!/usr/bin/env node
// Zero-dependency lint: run `node --check` (parse-only, no execution) on every
// .mjs/.js source file. It's the no-build project's syntax gate — catches the
// kind of break (a stray brace, a bad import keyword) that a missing test would
// otherwise let through. Referenced by `npm run lint`. Exits nonzero on any
// failure so CI fails loud.

import { readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Project root = one level up from this file's dir (tools/ → repo root).
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

// Roots to walk. Some may not exist yet (e.g. scripts/) — missing dirs are skipped.
const ROOTS = ["src", "client", "tools", "scripts", "test"];

// Never descend into these (build islands carry their own deps + bundles).
const SKIP_DIRS = new Set(["node_modules", ".git", ".surface", "scenes", "dist", "build", "coverage"]);

const CHECK_EXT = new Set([".mjs", ".js"]);

/** Recursively collect checkable files under `dir`. */
async function collect(dir, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; } // dir doesn't exist — skip silently
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await collect(join(dir, e.name), out);
    } else if (e.isFile() && CHECK_EXT.has(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
}

async function main() {
  const files = [];
  for (const r of ROOTS) {
    const abs = join(ROOT, r);
    try {
      const s = await stat(abs);
      if (s.isDirectory()) await collect(abs, files);
    } catch { /* missing root — skip */ }
  }

  let failed = 0;
  for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) {
      failed++;
      console.error(`FAIL ${relative(ROOT, f)}`);
      const detail = (r.stderr || r.stdout || "").trim();
      if (detail) console.error(detail.split("\n").map((l) => "  " + l).join("\n"));
    }
  }

  const checked = files.length;
  if (failed) {
    console.error(`\nlint: ${failed} of ${checked} file(s) failed node --check.`);
    process.exit(1);
  }
  console.log(`lint: ${checked} file(s) OK.`);
}

main().catch((err) => {
  console.error("lint: fatal:", err?.stack || err?.message || err);
  process.exit(1);
});
