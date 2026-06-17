# org-console

An org console for a **Tier-A (native fabric)** runtime — the persona for an agent
*organization*, not a single agent. It frames a surface whose substance is filled
by the runtime itself: a framing hero, plus a live **org chart** and **agent inbox**
that arrive as projections. On a 4-column layout, `permissionProfile: "operator"`.

## What it is

Unlike the other packs, org-console barely composes anything. It seeds **one** tile
— a framing `hero` (`oc-hero`) — and then gets out of the way. The org chart and the
inbox are **live projections** from the attached runtime:

- the runtime emits `{kind:"projection", namespace:"org.graph", data:{nodes}}` and
  `{kind:"projection", namespace:"agent.inbox", data:{agent,messages}}`,
- the kernel relays those **unchanged**,
- the client mounts them through generic renderers keyed by namespace
  (`proj:org.graph` → `org-graph`, `proj:agent.inbox` → `inbox`).

So this pack is the proof that **org mode is runtime-agnostic**: swap the runtime,
the same kernel and the same renderers light up — no bespoke UI per fabric.

## It pairs with a Tier-A runtime

org-console is inert on its own — it expects a runtime that advertises **Tier A**
and the `standard` org namespaces (`org.graph`, `agent.inbox`, …) and streams those
projections. The shipped `orgmock` adapter (`src/adapters/orgmock.mjs`) is exactly
that: an in-process Tier-A runtime that emits a small, stable org graph + inbox and
routes a `talk to <id>` prompt to the matching node. A real native fabric (e.g. a
self-organizing agent CLI) would emit the same shapes from live org state.

The org chart's nodes are **tappable** — a tap (or Enter) is the "talk to this node"
gesture: it sends `talk to <node id>` as the next turn (via the `surface:prompt`
event), and the runtime routes the message and reflects it back in the inbox.

## Mount it

```js
import { createSurface } from "../../src/kernel/server.mjs";
import { orgmockAdapter } from "../../src/adapters/orgmock.mjs";
import orgConsole from "./index.mjs";

const surface = createSurface({ adapter: orgmockAdapter(), pack: orgConsole });
await surface.listen();
```

Or install into an existing workspace:

```js
import { installPack } from "../../src/pack-sdk/index.mjs";
import orgConsole from "./index.mjs";

installPack(orgConsole, { workspace, registry });
```
