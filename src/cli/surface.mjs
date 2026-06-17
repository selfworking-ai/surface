#!/usr/bin/env node
// Surface CLI — the zero-config entry point. `npm i -g @selfworking-ai/surface`
// then `surface dev` boots a console with the built-in echo adapter; drop a
// `surface.config.js` to swap in a real runtime adapter + providers.
//
//   surface dev     boot the hub (loads ./surface.config.js if present, else echo)
//   surface init    scaffold ./surface.config.js + print next steps
//   surface --help   usage
//
// The executable bit is set by npm via package.json `bin` — we don't rely on it.

import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createSurface } from "../kernel/server.mjs";
import { echoAdapter } from "../adapters/echo.mjs";
import missionControl from "../../packs/mission-control/index.mjs";

const USAGE = `surface — display server + protocol for agent CLIs

Usage:
  surface dev      Start the console. Loads ./surface.config.js if present,
                   otherwise runs the built-in echo adapter (no runtime needed).
  surface init     Scaffold ./surface.config.js into the current directory.
  surface --help   Show this help.

Env:
  SURFACE_PORT / PORT   HTTP/WS port (default 5757)
  SURFACE_DIR           Persistence dir for the file store (default ./.surface)
  OPEN_BROWSER=0        Don't auto-open the browser on boot
`;

// The scaffold written by `surface init`. A config module default-exports either a
// SurfaceConfig object or a () => SurfaceConfig (sync or async) factory — `dev`
// accepts both. This template ships the echo adapter so it runs out of the box;
// the comments point at where a real runtime adapter slots in (M2+).
const CONFIG_TEMPLATE = `// surface.config.js — Surface kernel configuration.
// Default-export a SurfaceConfig object, or a (sync/async) factory returning one.
// Docs: https://github.com/selfworking-ai/surface#readme

import { echoAdapter } from "@selfworking-ai/surface/adapters/echo.mjs";
// import { claudeCodeAdapter } from "@selfworking-ai/surface/adapters/claude-code.mjs"; // M2
// import missionControl from "@selfworking-ai/surface/packs/mission-control/index.mjs"; // a starter pack

/** @type {import("@selfworking-ai/surface").SurfaceConfig} */
export default {
  // The runtime seam. Swap echoAdapter() for a real agent-CLI adapter when ready.
  adapter: echoAdapter(),

  // packs: [missionControl],    // starter pack(s) that seed the initial canvas (array)
  // port: 5757,                 // env SURFACE_PORT || PORT wins if set
  // mode: "operator",           // default working mode (operator | team | visitor)
  // store: undefined,           // default: FileStore({ dir: SURFACE_DIR || "./.surface" })
  // openBrowser: true,          // env OPEN_BROWSER=0 disables
};
`;

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

// Load ./surface.config.js from cwd. Returns a resolved SurfaceConfig, or null if
// no config file is present (caller falls back to the echo adapter).
async function loadConfig() {
  const cwd = process.cwd();
  for (const name of ["surface.config.js", "surface.config.mjs"]) {
    const p = join(cwd, name);
    if (!(await fileExists(p))) continue;
    const mod = await import(pathToFileURL(p).href);
    const exp = mod.default ?? mod.config ?? mod;
    const cfg = typeof exp === "function" ? await exp() : exp;
    if (!cfg || typeof cfg !== "object") {
      throw new Error(`${name} must default-export a config object or a factory returning one`);
    }
    return cfg;
  }
  return null;
}

async function cmdDev() {
  let cfg = await loadConfig();
  if (!cfg) {
    console.log("[surface] no surface.config.js found — using the built-in echo adapter.");
    console.log("[surface] run `surface init` to scaffold a config.");
    // Zero-config: wire the mission-control starter so a fresh boot shows a real
    // canvas, not an empty one. Only when there's NO config — a loaded config's
    // pack choice (even an empty one) is the user's and is left untouched.
    console.log("[surface] no config — booting the echo adapter with the mission-control starter pack.");
    cfg = { adapter: echoAdapter(), packs: [missionControl] };
  }
  if (!cfg.adapter) cfg.adapter = echoAdapter(); // tolerate a config that omits it
  const surface = createSurface(cfg);
  await surface.listen();
  // Graceful shutdown so the port frees + the final frame commit isn't truncated.
  const bye = () => { surface.close().then(() => process.exit(0)); };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}

async function cmdInit() {
  const cwd = process.cwd();
  const target = join(cwd, "surface.config.js");
  if (await fileExists(target)) {
    console.log("surface.config.js already exists — leaving it untouched.");
    return;
  }
  await writeFile(target, CONFIG_TEMPLATE, "utf8");
  console.log("Created surface.config.js");
  console.log("");
  console.log("Next steps:");
  console.log("  1. npm install @selfworking-ai/surface   # if not already a dependency");
  console.log("  2. npx surface dev                       # boot the console (or: surface dev)");
  console.log("  3. Swap echoAdapter() for a real runtime adapter when ready.");
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "dev": return cmdDev();
    case "init": return cmdInit();
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[surface] fatal:", err?.stack || err?.message || err);
  process.exitCode = 1;
});
