# business-os

A business operating console — the **team** persona. The state of a business a
small team can run at a glance: headline metrics (Revenue, Customers, Runway —
toned so risk shows itself), a key-facts `kv`, the week's commitments, and a
pipeline status pill. Composed from built-in components (`metric` / `kv` / `list`
/ `status`) on a 4-column layout.

`permissionProfile: "team"` — actions attribute to the team principal; the
operating agent stays conservative.

## Mount it

Seed it on boot via the kernel:

```js
import { createSurface } from "../../src/kernel/server.mjs";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.mjs";
import businessOs from "./index.mjs";

const surface = createSurface({ adapter: claudeCodeAdapter(), pack: businessOs });
await surface.listen();
```

Or install into an existing workspace:

```js
import { installPack } from "../../src/pack-sdk/index.mjs";
import businessOs from "./index.mjs";

installPack(businessOs, { workspace, registry });
```

The operating agent updates the numbers **in place** by their stable ids
(`biz-revenue`, `biz-customers`, `biz-runway`, `biz-facts`, `biz-week`,
`biz-pipeline`).
