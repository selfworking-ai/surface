# mission-control

A personal mission console — the **operator** persona. One person's day at a
glance: a hero standing line, pulse metrics (Focus, Tasks Today, Streak), today's
priorities list, and a single system-health pill. Composed entirely from built-in
components (`hero` / `metric` / `list` / `status`) on a 4-column layout.

`permissionProfile: "operator"` — full trust; the operator drives the surface.

## Mount it

Seed it on boot via the kernel:

```js
import { createSurface } from "../../src/kernel/server.mjs";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.mjs";
import missionControl from "./index.mjs";

const surface = createSurface({ adapter: claudeCodeAdapter(), pack: missionControl });
await surface.listen();
```

Or install into an existing workspace:

```js
import { installPack } from "../../src/pack-sdk/index.mjs";
import missionControl from "./index.mjs";

installPack(missionControl, { workspace, registry });
```

The operating agent then updates tiles **in place** by their stable ids
(`mc-hero`, `mc-focus`, `mc-tasks`, `mc-streak`, `mc-priorities`, `mc-system`).
