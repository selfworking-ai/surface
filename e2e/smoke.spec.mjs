// Surface — Playwright smoke. Pins the UI guarantees the unit/protocol suite
// cannot reach (the live client bugs SX-2 / G5 only ever showed in a real
// browser). Each test FAILS LOUDLY if its behavior regresses.
//
// DOM facts these assertions are built against (verified by reading the source):
//   - client/index.html: the canvas is #canvas; the optional scene player is
//     #player-root (starts [hidden]); the mode gate is #gate with
//     button[data-mode="operator"|"team"|"visitor"]; the dock is textarea#prompt
//     (placeholder "Speak to Surface…"), Enter submits.
//   - client/kernel.js: on connect the server replays the workspace as a `patch`
//     BEFORE any mode lock, so the mission-control pack's 6 tiles render behind
//     the gate. Mounted components are custom elements carrying data-id; their
//     values live in shadowRoot (base.js renders into el.shadowRoot .content).
//   - packs/mission-control/index.mjs: seeds ids mc-hero, mc-focus, mc-tasks,
//     mc-streak, mc-priorities, mc-system (6 tiles).
//   - src/adapters/echo.mjs: turn 1 MOUNTS echo-hero/echo-turns/echo-mode/
//     echo-tier; turn 2+ only UPDATEs echo-hero + echo-turns (echo-turns is a
//     <surface-metric> whose .value is String(turns)) — the retained-mode
//     update-in-place contract: same ids, no re-mount, the count is unchanged.

import { test, expect } from "@playwright/test";

const MC_TILES = ["mc-hero", "mc-focus", "mc-tasks", "mc-streak", "mc-priorities", "mc-system"];

// A page-level error collector. Attached at the TOP of every test before any
// navigation — this is the ONLY thing that catches a G5 TDZ throw (one console
// error and the page renders static chrome but no rows/cards; `node --check`
// parses it fine). Returns the live arrays so a test can assert empty at the end.
function collectErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => { pageErrors.push(String(err)); });
  return { consoleErrors, pageErrors };
}

// Count the live, mounted canvas tiles (custom-element hosts carry data-id).
// Snapshot/escape-hatch nodes are excluded by scoping to #canvas > [data-id].
function tileCount(page) {
  return page.locator("#canvas > [data-id]").count();
}

// Read a mounted metric's rendered value out of its shadow root — light-DOM
// queries find NOTHING (the value lives in el.shadowRoot .value). A green
// light-DOM assertion here would be a false negative (gotchas.md, SX-2).
function metricValue(page, id) {
  return page.evaluate((tileId) => {
    const host = document.querySelector(`#canvas > [data-id="${tileId}"]`);
    return host?.shadowRoot?.querySelector(".value")?.textContent?.trim() ?? null;
  }, id);
}

test.describe("Surface smoke", () => {
  test("boot is composed, not blank — and zero console errors", async ({ page }) => {
    const errs = collectErrors(page);
    await page.goto("/");

    // The mission-control pack seeds the canvas on connect, BEHIND the gate. All
    // 6 tiles must be present even before a mode is chosen (the canvas is never
    // blank on boot — the "Speak to begin." placeholder has been replaced).
    for (const id of MC_TILES) {
      await expect(page.locator(`#canvas > [data-id="${id}"]`)).toBeVisible();
    }
    await expect.poll(() => tileCount(page)).toBe(MC_TILES.length);

    // The gate is up (a mode hasn't been picked) — proves the tiles render
    // independent of the trust posture.
    await expect(page.locator("#gate")).toBeVisible();

    // No TDZ / no thrown errors during boot (G5 — browser-only catch).
    expect(errs.consoleErrors, "console errors on boot").toEqual([]);
    expect(errs.pageErrors, "page errors on boot").toEqual([]);
  });

  test("scene path never blanks the canvas (P0 #1)", async ({ page }) => {
    const errs = collectErrors(page);
    await page.goto("/");
    // Wait for the composed canvas so we're asserting against a booted page.
    await expect(page.locator(`#canvas > [data-id="${MC_TILES[0]}"]`)).toBeVisible();

    const state = await page.evaluate(() => {
      const player = document.getElementById("player-root");
      const canvas = document.getElementById("canvas");
      return {
        scenesLoaded: typeof window.SurfaceScenes !== "undefined",
        playerHidden: player?.hidden === true,
        // showHtmlView() clears the inline display override; the .grid class sets
        // display:grid. The guarantee: the canvas is shown, the player is not.
        canvasInlineDisplay: canvas ? getComputedStyle(canvas).display : null,
        canvasVisible: canvas ? canvas.offsetParent !== null : false,
      };
    });

    // No scene renderer is shipped → SurfaceScenes is undefined and the player
    // box stays hidden; the retained grid keeps painting (a scene op is a no-op,
    // it must NEVER hide the canvas — playScene() guards before showSceneView()).
    expect(state.scenesLoaded, "window.SurfaceScenes should be undefined (scene pulled)").toBe(false);
    expect(state.playerHidden, "#player-root should be hidden").toBe(true);
    expect(state.canvasVisible, "#canvas should be visible").toBe(true);
    expect(state.canvasInlineDisplay, "#canvas should be display:grid").toBe("grid");

    expect(errs.consoleErrors).toEqual([]);
    expect(errs.pageErrors).toEqual([]);
  });

  test("operator turn paints, then UPDATES in place (retained mode)", async ({ page }) => {
    const errs = collectErrors(page);
    await page.goto("/");
    await expect(page.locator(`#canvas > [data-id="${MC_TILES[0]}"]`)).toBeVisible();

    // Pick Operator → the dock enables.
    await page.locator('#gate button[data-mode="operator"]').click();
    const prompt = page.locator('[placeholder="Speak to Surface…"]');
    await expect(prompt).toBeEnabled();

    // Turn 1: echo mounts its 4 tiles on top of the 6 pack tiles → 10 total.
    await prompt.fill("hello surface");
    await prompt.press("Enter");
    await expect(page.locator('#canvas > [data-id="echo-hero"]')).toBeVisible();
    await expect.poll(() => tileCount(page), { message: "6 pack + 4 echo tiles after turn 1" })
      .toBe(MC_TILES.length + 4);
    // The Turns metric reads "1" after the first turn.
    await expect.poll(() => metricValue(page, "echo-turns")).toBe("1");

    // Turn 2: echo only UPDATEs echo-hero + echo-turns. The retained-mode
    // contract — same ids, NO re-mount: the tile count is unchanged and the
    // metric value increments in place. (This is exactly where the SX-2
    // live/past regression and a re-mount-every-turn regression would show.)
    await prompt.fill("again");
    await prompt.press("Enter");
    await expect.poll(() => metricValue(page, "echo-turns"), { message: "echo-turns increments in place" })
      .toBe("2");
    await expect.poll(() => tileCount(page), { message: "count unchanged → update-in-place, not re-mount" })
      .toBe(MC_TILES.length + 4);

    expect(errs.consoleErrors).toEqual([]);
    expect(errs.pageErrors).toEqual([]);
  });

  test("two tabs see the same canvas (broadcast)", async ({ page, context }) => {
    const errs = collectErrors(page);
    await page.goto("/");
    await expect(page.locator(`#canvas > [data-id="${MC_TILES[0]}"]`)).toBeVisible();

    // Lock Operator in tab 1 — this persists the mode to localStorage, which the
    // 2nd tab (same context → shared localStorage) reads on connect, so it
    // auto-locks the same mode (no gate) and gets the workspace replay.
    await page.locator('#gate button[data-mode="operator"]').click();
    const prompt = page.locator('[placeholder="Speak to Surface…"]');
    await expect(prompt).toBeEnabled();

    // Open a 2nd tab in the SAME context.
    const page2 = await context.newPage();
    const errs2 = collectErrors(page2);
    await page2.goto("/");

    // Tab 2 renders the composed canvas (the pack tiles, replayed on its own
    // connect). This proves a fresh client rebuilds the retained canvas.
    for (const id of MC_TILES) {
      await expect(page2.locator(`#canvas > [data-id="${id}"]`)).toBeVisible();
    }

    // Now drive a turn from tab 1 and assert tab 2 RECEIVES the broadcast patch:
    // echo-hero appears in BOTH tabs from the single turn. (The kernel broadcasts
    // every applied patch to all connected clients — server.mjs broadcast().)
    await prompt.fill("broadcast me");
    await prompt.press("Enter");
    await expect(page.locator('#canvas > [data-id="echo-hero"]')).toBeVisible();
    await expect(page2.locator('#canvas > [data-id="echo-hero"]')).toBeVisible();

    expect(errs.consoleErrors).toEqual([]);
    expect(errs.pageErrors).toEqual([]);
    expect(errs2.consoleErrors).toEqual([]);
    expect(errs2.pageErrors).toEqual([]);

    await page2.close();
  });

  // NOTE: reconnect-mid-turn is intentionally NOT in the smoke. The echo turn is
  // synchronous (it yields its whole patch and turn_done in one tick), so there
  // is no deterministic window to drop and re-open the socket "mid-turn" without
  // a fixed sleep — and a timing-based assertion would be exactly the flaky test
  // this island exists to prevent. Reconnect + workspace-replay is covered
  // structurally by the "two tabs" test (a fresh client rebuilds the canvas from
  // the server's replayed patch) and by the protocol suite (test/integration).
});
