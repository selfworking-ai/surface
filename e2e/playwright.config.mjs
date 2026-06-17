// Surface — committed Playwright smoke island.
//
// WHY THIS EXISTS: every UI guarantee in Surface (the canvas composes on boot,
// scene() never blanks the canvas, retained-mode update-in-place, the cross-tab
// broadcast) was verified by hand and lost between sessions. The unit/protocol
// suite under test/ is necessary but NOT sufficient — the live client bugs
// (SX-2 live/past flag, G5 TDZ) only ever showed up in a real browser. This
// suite pins those guarantees so the next scene/reconnect/reconciler regression
// can't ship silently.
//
// It is a DEVDEP-ONLY island (CLAUDE.md "build islands"): `@playwright/test` is
// a devDependency; the published package ships no node_modules (the `files`
// allowlist excludes it), so this never touches the runtime's single-dep promise.
//
// Run it with `npm run e2e` (the script + the `npx playwright install chromium`
// step are wired by package.json — see this file's webServer block for what it
// boots).

import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// A fixed port for the smoke server. The protocol/unit suite uses ephemeral
// `port: 0` (SX-6) because `node --test` runs files in parallel; this single
// Playwright webServer is the lone process on its port, so a fixed one is safe
// and keeps `baseURL` static.
const PORT = 5917;
const BASE_URL = `http://localhost:${PORT}`;

// Resolve `surface dev` relative to THIS config (the webServer cwd is this dir),
// not the shell's cwd, so `npm run e2e` works from anywhere.
const here = dirname(fileURLToPath(import.meta.url));
const SURFACE_CLI = join(here, "..", "src", "cli", "surface.mjs");

// A throwaway, absolute persistence dir so the smoke never reads or writes the
// repo's ./.surface frames/workspace. A fresh dir guarantees a clean boot: the
// echo adapter + the mission-control starter pack, no replayed prior session.
const SURFACE_DIR = join(tmpdir(), `surface-e2e-${process.pid}`);

export default defineConfig({
  testDir: here,
  // CI gets one retry to absorb a cold-boot hiccup; locally, fail fast so a real
  // regression isn't masked. No retry hides a flaky assertion — there are none
  // here (every wait is gated on a predicate via expect.poll / toPass).
  retries: process.env.CI ? 1 : 0,
  // One worker: a single fixed-port webServer backs the whole file, and the
  // cross-tab test shares one browser context.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Boot a real Surface the way an operator would: zero-config `surface dev`
  // (echo adapter + mission-control starter pack), browser auto-open suppressed,
  // a throwaway store dir, the fixed port. `reuseExistingServer: false` so the
  // suite always tests a clean boot, never a stale dev server someone left up.
  webServer: {
    command: `node ${JSON.stringify(SURFACE_CLI)} dev`,
    cwd: here,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      OPEN_BROWSER: "0",
      PORT: String(PORT),
      SURFACE_DIR,
    },
  },
});
