// Minimal host — the smallest thing that embeds Surface.
// Run: `node index.mjs` (from this dir) or `node examples/minimal-host/index.mjs` (repo root).

import { createSurface } from "@selfworking-ai/surface";
import { echoAdapter } from "@selfworking-ai/surface/adapters/echo.mjs";
import missionControl from "@selfworking-ai/surface/packs/mission-control/index.mjs";

// The echo adapter is in-process (no subprocess, no model): it paints your prompt back
// as retained-mode tiles, so you can see the kernel work without wiring a real runtime.
// The mission-control pack seeds the canvas so it's composed (not blank) before you type.
const surface = createSurface({ adapter: echoAdapter(), packs: [missionControl], port: 5757 });

// listen() binds 127.0.0.1, starts serving, and (unless OPEN_BROWSER=0) opens a browser.
const { url } = await surface.listen();
console.log(`Surface live at ${url} — type into the dock and watch the tiles patch in place.`);
