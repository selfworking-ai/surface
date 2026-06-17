# agentic-site

A **public, curated, locked-down** surface — the **visitor** persona. This is the
canvas a visitor sees: a welcoming hero, two info `text` tiles, one public metric,
and a status pill. Composed from built-in components (`hero` / `text` / `metric` /
`status`) on a 4-column layout.

`permissionProfile: "visitor"` — the safe-for-the-public posture.

## Visitor-mode lockdown (kernel-enforced)

Visitor mode is **generation OFF + tools NONE**: a `{type:"prompt"}` from a
visitor connection is rejected by the kernel with an error
(`src/kernel/server.mjs`). So this pack **is** the curated surface a visitor sees
— they cannot drive the agent to change it. A richer *interactive visitor*
(compose-only prompting against a tight allowlist of registered components) is a
documented future refinement (see `docs/authoring-packs.md`), not part of this
locked-down starter.

## Mount it

Seed it on boot via the kernel:

```js
import { createSurface } from "../../src/kernel/server.mjs";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.mjs";
import agenticSite from "./index.mjs";

const surface = createSurface({ adapter: claudeCodeAdapter(), pack: agenticSite });
await surface.listen();
```

Or install into an existing workspace:

```js
import { installPack } from "../../src/pack-sdk/index.mjs";
import agenticSite from "./index.mjs";

installPack(agenticSite, { workspace, registry });
```

Stable ids: `site-hero`, `site-about`, `site-how`, `site-uptime`, `site-status`.
