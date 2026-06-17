# Org mode

Surface began as a console for a *single* agent. Org mode is what happens when the
runtime behind it is not one agent but an **organization** of them — a router over
coordinators over workers, a native fabric. The console doesn't change. The runtime
emits a few extra **projections**, generic renderers paint them, and the same dock +
retained-mode canvas now drives an org. No bespoke UI, no kernel fork.

The load-bearing idea: **Surface stores a *projection* of org state, never the source
of truth.** The runtime owns the org — who reports to whom, who is busy, what's in an
agent's inbox. Surface receives read-only snapshots of that state on each turn and
draws them. Tap a node and Surface sends an *intent* ("talk to this node") back; the
runtime decides what that means. The console is a window onto the org, not its
database.

## The `standard` org namespaces

Borrowed-fabric runtimes advertise the org capabilities they support as a list of
**namespaces** in their `capabilities` (see `docs/multi-runtime.md` for the tiers).
The `standard` org namespaces are:

| Namespace | Meaning |
|---|---|
| `org.graph` | the org's shape — nodes + reporting edges + per-node status |
| `agent.inbox` | the messages waiting for one agent |
| `agent.spawn` | the runtime can create agents |
| `agent.message` | the runtime can route a message between agents |
| `schedule` | the runtime can schedule future work |

A runtime that advertises these (and is **Tier A** — a native fabric) lights up org
mode. The reference Tier-A runtime is `src/adapters/orgmock.mjs`; it advertises
`["org.graph", "agent.spawn", "agent.message", "agent.inbox", "schedule"]` and streams
the first two as projections each turn.

## Generic renderers — namespace → component

A runtime paints the canvas with `patch` ops that mount **registered** components by
name (the M3 token-only rule keeps that survivable). Org projections work the same
way, but the mapping is automatic: the runtime does **not** name a component — it
emits a `projection` keyed by namespace, the kernel relays it **unchanged**, and the
*client* picks the renderer:

```js
// client/kernel.js
const NS_RENDERER = { "org.graph": "org-graph", "agent.inbox": "inbox" };
```

A `{type:"projection", namespace, data}` from the server is mounted (and upserted on
later turns) as `mount { id:"proj:<namespace>", component:<NS_RENDERER[ns]>, props:data }`.
So a brand-new Tier-A runtime that emits `org.graph` gets an org chart for free —
the renderer is generic over the *shape*, not the runtime. A namespace with no entry
in `NS_RENDERER` is a vendor passthrough the core ignores (a pack may render it).

The two shipped generic renderers (`client/components/`):

| Namespace | Component | Tag |
|---|---|---|
| `org.graph` | `org-graph` | `<surface-org-graph>` |
| `agent.inbox` | `inbox` | `<surface-inbox>` |

Both are ordinary design-system components: shadow DOM, token-only styles, escaped
text — subject to the same registration trust gate as every primitive.

## The projection shapes

The renderers are generic over these shapes. A real native fabric emits the same
shapes from live org state; orgmock emits a small stable fixture.

**`org.graph`** — the org's shape:

```jsonc
{
  "nodes": [
    { "id": "router",  "role": "Router",              "reportsTo": null,     "status": "active" },
    { "id": "sales",   "role": "Sales Coordinator",   "reportsTo": "router", "status": "active" },
    { "id": "support", "role": "Support Coordinator", "reportsTo": "router", "status": "idle"   }
  ]
}
```

`reportsTo` is a node id or `null`; the node(s) with `null` are the root(s). The
`org-graph` renderer tiers each node under its parent (indentation + a "↳ reports to"
hint — no SVG, no edges), shows `role` + `id`, and tones a status dot (`active` →
good, `idle` → muted, anything else → warn).

**`agent.inbox`** — one agent's waiting messages:

```jsonc
{ "agent": "router", "messages": [ { "from": "sales", "text": "Pipeline at 12 deals" } ] }
```

The `inbox` renderer titles the tile `Inbox · <agent>` and lists each message with an
accented `from` (a message from `you` is toned muted) above its `text`.

## The talk-to-any-node gesture

Every node in the org chart is **tappable** (it renders as a focusable button, so a
tap *or* Enter activates it). Activation is the "talk to this node" gesture — the
renderer dispatches a **composed** `CustomEvent` that crosses its shadow boundary and
bubbles to the document:

```js
this.dispatchEvent(new CustomEvent("surface:prompt", {
  detail: { text: "talk to " + node.id },
  bubbles: true, composed: true,
}));
```

`client/kernel.js` listens for `surface:prompt` and turns it into a normal
`{type:"prompt", text}` turn (subject to the mode gate — visitor mode can't speak).
The runtime sees `talk to <id>` and does what its fabric does with it. orgmock routes
the message to that node and reflects it back: it prepends a `{from:"you", …}` line to
the inbox and retargets `agent.inbox.agent` to the addressed node — so the next
inbox projection shows the conversation moved there.

This is the whole interaction model for org mode: **read the org by glancing at the
chart + inbox; act on it by talking to a node.** No new dock, no new protocol verb —
the existing prompt channel carries the intent.

## The org-console pack

`packs/org-console/` is the userspace app for a Tier-A runtime. Unlike the other
packs it barely composes anything: it seeds a single framing `hero` (`oc-hero`) on a
4-column `operator` layout and gets out of the way. The org chart and inbox arrive as
**live projections** (keyed `proj:org.graph` / `proj:agent.inbox`), so the pack only
frames a surface whose substance the runtime fills. Pair it with a Tier-A runtime —
`orgmock` in dev, a real native fabric in production. See `packs/org-console/README.md`.

## Why a projection, not a model

Surface deliberately does **not** own org state. If it cached the org graph, it would
drift from the runtime that's actually spawning and routing agents, and two consoles
on the same runtime could disagree. Instead each turn carries a fresh read-only
projection; the runtime is the single source of truth. This is the same discipline as
the rest of Surface (the runtime borrows all agent logic, memory, and orchestration —
see `docs/architecture.md`), applied to org shape: **the console reflects, it does not
record.**
