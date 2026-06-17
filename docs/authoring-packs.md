# Authoring packs

A **pack** is a userspace app: a set of registered components + a layout + an
optional permission profile + an optional agent system-prompt fragment. It is the
fourth design-system ring — `tokens → primitives → composed → packs` — and the
unit a host *installs* to give a Surface a starting shape.

A pack **composes**; it does not **generate**. Its `seed()` returns `mount` ops
that arrange already-registered built-in components (cheap, deterministic, safe).
Authoring a *new* component is the rare, gated path (see
`authoring-components.md`); a pack only references components by name.

## §0 — The three personas

The starter packs in `packs/` are the three use cases Surface is built for, one
per permission profile:

| Pack | Profile | Persona |
|---|---|---|
| `mission-control` | `operator` | A single operator's personal mission console — focus, today's load, streak, priorities, system health. Full trust. |
| `business-os` | `team` | A business a small team runs — revenue / customers / runway (toned), key facts, this week, pipeline. Actions attribute to the team principal; conservative. |
| `agentic-site` | `visitor` | A **public, curated, locked-down** surface — the canvas a visitor sees. Generation OFF, tools NONE (kernel-enforced). |

The profile is not decoration — it is the trust posture the surface runs under
(`operator` | `team` | `visitor`). The grant rule is
`component.caps ⊆ mode.grantable ⊆ principal.ceiling`.

## The PackManifest

```js
{
  name: "mission-control",          // unique pack id
  version: "1.0.0",                  // semver string
  components: ["hero", "metric", "list", "status"], // built-ins this pack mounts (must be registered)
  layout: { columns: 4 },            // initial layout spec, seeded on install
  permissionProfile: "operator",     // "operator" | "team" | "visitor" — the trust posture
  dataWiring: { /* optional */ },    // broker topic → source bindings (optional)
  agentInstructions: "…",            // optional system-prompt fragment for the operating agent
}
```

`validatePackManifest(m)` checks shape (object, non-empty `name` + `version`, a
`components` array, a `layout` object, and a **valid** `permissionProfile`). A
malformed manifest fails at author/install time, not at mount time — a pack is a
unit of installable trust.

## The pack module — `definePack`

A pack file lives at `packs/<name>/index.mjs` and pairs a manifest with a `seed`:

```js
// packs/mission-control/index.mjs
import { definePack } from "../../src/pack-sdk/index.mjs";

const manifest = {
  name: "mission-control", version: "1.0.0",
  components: ["hero", "metric", "list", "status"],
  layout: { columns: 4 }, permissionProfile: "operator",
  agentInstructions: "Personal mission-control surface — keep tiles glanceable, update in place.",
};

export const pack = definePack(manifest, () => [
  { op: "mount", id: "mc-hero",   component: "hero",   props: { label: "Mission Control", value: "On track" } },
  { op: "mount", id: "mc-focus",  component: "metric", props: { label: "Focus", value: "Deep work", tone: "good" } },
  { op: "mount", id: "mc-tasks",  component: "metric", props: { label: "Tasks Today", value: "4" } },
  // …
]);

export default pack;
```

`definePack(manifest, seed)` validates the manifest (throws on a bad one) and
returns a `PackModule` `{ manifest, seed }`. The convention is to **both**
default-export the pack and provide a named `pack` export.

### Compose only from registered components

`seed()` returns `mount` ops whose `component` is a **registered built-in**:

| Component | Props |
|---|---|
| `metric` | `label, value, delta?, tone?(good/warn/bad), size?(lg/tall)` |
| `hero` | `label, value, body?` (full-width) |
| `list` | `label, items: string[] \| {text}[]` |
| `status` | `label, value, tone?, status?` |
| `text` | `label?, text` |
| `kv` | `label, pairs: {k,v}[] \| object` |

Never invent a component name or a prop — an unknown component falls back to a
debug dump, and off-system styling can't reach the canvas anyway (the token-only
rule is enforced at component registration). Keep a pack **glanceable**: ~5–8
tiles, no walls of text.

### Use stable ids

Give every `mount` a stable id (`mc-hero`, `biz-revenue`, `site-status`). The
operating agent then **updates tiles in place** (`{op:"update", id, props}`) each
turn rather than re-mounting them — that is what makes the canvas retained-mode
instead of a repaint.

## Installing a pack — `installPack`

`installPack(pack, { workspace, registry })` registers any component manifests the
pack ships (built-in-only packs ship none), then seeds the workspace: the layout
op first, then the pack's `seed()` ops. It returns the applied ops so the kernel
can broadcast them. Re-installing replaces the pack's nodes by id (the
reconciler's upsert semantics).

```js
import { installPack } from "../src/pack-sdk/index.mjs";
import missionControl from "../packs/mission-control/index.mjs";

const ops = installPack(missionControl, { workspace, registry });
```

The common path is to let the **kernel** seed on boot — pass the pack to
`createSurface`:

```js
import { createSurface } from "../src/kernel/server.mjs";
import { claudeCodeAdapter } from "../src/adapters/claude-code.mjs";
import businessOs from "../packs/business-os/index.mjs";

const surface = createSurface({ adapter: claudeCodeAdapter(), pack: businessOs });
await surface.listen();
```

On boot the kernel installs the pack into the session's workspace; on connect each
client receives a `patch` carrying the seeded composition. A returning session's
saved workspace snapshot replaces the seed via `workspace.load()` — the pack is
the *starting* composition, not a per-turn reset.

## Export / import — packs travel as data

```js
import { exportPack, importPack } from "../src/pack-sdk/index.mjs";

const json = exportPack(pack);   // { manifest, ops } — seed() materialized to a static op list
const back = importPack(json);   // a PackModule whose seed() replays those ops
```

`exportPack` materializes the seed function into a static op list so the pack is
portable JSON. `importPack` re-validates both the manifest and the ops (so an
imported pack can't smuggle malformed ops past the reconciler) and returns a pack
module whose `seed()` replays a fresh copy of the ops. The round-trip preserves
the manifest name and the seed op count.

## Visitor mode — the public-safe surface

`permissionProfile: "visitor"` is the locked-down, public-facing posture, and the
lockdown is **kernel-enforced**, not pack-enforced:

- **Generation OFF.** A `{type:"prompt"}` from a visitor connection is rejected
  with `{type:"error", message:"generation is disabled in visitor mode"}`
  (`src/kernel/server.mjs`). No turn runs.
- **Tools NONE.** A visitor's principal grants no tool capabilities.

So a visitor pack **is** the curated surface a visitor sees — a welcoming hero
plus a few read-only info tiles. A visitor cannot drive the agent to change it,
which is exactly why the locked dock + loopback bind + origin allowlist make
visitor-facing mode safe to expose.

### Interactive-visitor refinement (future)

A richer *interactive visitor* — letting a visitor prompt, but constraining the
agent to **compose-only** turns against a tight allowlist of registered
components (no generation, no tools, no out-of-allowlist mounts) — is a documented
future refinement. The composition vocabulary already makes this tractable (a
visitor turn would be reducible to `mount`/`update`/`remove`/`layout` over an
approved set); it is intentionally **not** part of the locked-down `agentic-site`
starter, which stays read-only.

## The operator-gated install flow

Packs are userspace and agent-authorable, but **enabling** a pack on a live
Surface is an operator action, not an agent one. The intended flow:

1. An elevated **operator** enables a vetted pack through the dock (the kernel's
   one trusted input channel).
2. The kernel installs it (`installPack`) and seeds the workspace.
3. The operating **agent configures** the resulting surface — arranging and
   updating registered components, wiring data, answering through `ask`.

The agent **configures, never authors the kernel**: it composes within the pack's
permission profile and the registered component vocabulary. Authoring a brand-new
*component* (registering a new entry, subject to the token-only rule) is the rare,
gated path — distinct from composing a pack from components that already exist.
