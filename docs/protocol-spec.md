# Surface Protocol — specification

The Surface Protocol is the contract between the browser surface and the kernel, and
(through an adapter) between the kernel and an agent runtime. This page is the reference;
the executable source of truth for framing and version negotiation is the codec at
[`src/protocol/messages.mjs`](../src/protocol/messages.mjs), with the editor-facing types in
[`src/protocol/surface-protocol.d.ts`](../src/protocol/surface-protocol.d.ts). Keep them in
lockstep.

## Versioned envelope

Every wire message is wrapped in an envelope carrying an integer protocol version:

```ts
interface ProtocolEnvelope { v: number }
```

On **encode**, the codec stamps the current `PROTOCOL_VERSION` (currently `1`) onto the
message: `{ v: 1, type, …fields }`. On **decode**, it:

1. parses JSON (a parse failure → `{ ok: false, error: "invalid-json" }`),
2. requires a plain object with a non-empty string `type`,
3. **tolerates a missing `v`** — treating it as the current version, so a minimal client
   that omits the envelope can still talk — but
4. **rejects an incompatible `v`** via `negotiate()`, returning the negotiation result
   instead of corrupting state.

The codec never throws on decode; it returns a result object.

### Negotiation rules

`negotiate(remote)` compares a remote protocol version against the local one:

| Condition                                  | `compatible` | `outcome`            |
|--------------------------------------------|:------------:|----------------------|
| `remote` is not an integer ≥ 1             | `false`      | `incompatible`       |
| `remote === local`                         | `true`       | `exact`              |
| `remote` is a different integer            | `false`      | `incompatible`       |

In v1 the protocol uses **integer majors only**, so any differing integer is a breaking
mismatch. The `compatible-minor` outcome exists in the type (`VersionNegotiation`) but is
**reserved** for a future minor scheme. The major version is also negotiated once at the
`hello`/`capabilities` handshake (see [Capabilities](#capabilities)); the per-message `v`
is a cheap guard so an unexpected mismatch degrades gracefully.

### Codec API

```js
import { encode, decode, negotiate, validatePatch, validatePatchOp, isMode,
         PROTOCOL_VERSION, MODES, PATCH_OPS } from "@selfworking-ai/surface/protocol";
```

- `encode(msg) → string` — stamps `v` and serializes; throws `TypeError` only on a
  non-object input or a missing string `type` (an authoring error, not a wire condition).
- `decode(raw) → { ok, msg, version, negotiation } | { ok: false, error, … }` — parse +
  validate; never throws.
- `negotiate(remote) → VersionNegotiation`.
- `validatePatchOp(op)` / `validatePatch(ops)` — structural validation of the patch
  vocabulary (shared with the reconciler).
- `isMode(mode) → boolean`.
- Constants: `PROTOCOL_VERSION = 1`, `MODES = ["operator","team","visitor"]`,
  `PATCH_OPS = ["mount","update","remove","layout"]`.

## Client → server messages (`ClientMsg`)

Messages originate from the locked dock / surface. The dock is the one trusted input
channel.

| `type`        | Fields                                                            | Meaning |
|---------------|-------------------------------------------------------------------|---------|
| `prompt`      | `text: string`                                                    | A prompt typed into the dock. |
| `answer`      | `id`, `value: string`, `label?`, `cancelled?: boolean`            | Answer to an `ask` decision card; `value` is the chosen option's intent. |
| `decision`    | `id`, `decision: "allow" \| "deny"`, `message?`                   | Decision on a `permission` card. |
| `resume`      | `sessionId: string`                                               | The browser owns session identity (G12) and replays it on (re)connect. |
| `mode`        | `mode: Mode`                                                      | Lock the working mode for the connection. |
| `recall`      | `n: number`                                                       | Re-surface a past frame by turn number (read-only look-back). |
| `abort`       | —                                                                 | Abort the in-flight turn. |
| `event`       | `name: string`, `data?: unknown`                                 | Generic browser event channel (drawing-present, tile-marked, dwell/dismiss telemetry, screenshot composite replies). `name` namespaces it. |

The `event` channel keeps the core small while userspace features ride along.

## Server → client messages (`ServerMsg`)

| `type`         | Fields                                                            | Meaning |
|----------------|-------------------------------------------------------------------|---------|
| `hello`        | `protocolVersion: number`, `modes: Mode[]`, `defaultMode: Mode`   | Handshake: announce modes/defaults and the negotiated protocol version. |
| `capabilities` | `caps: Capabilities`                                              | What the connected runtime lit up (LSP-style declaration). |
| `patch`        | `ops: PatchOp[]`, `recalled?: number`                            | Retained-mode canvas patch (the primary paint channel). |
| `render`       | `html: string`, `recalled?: number`                             | v1 immediate-mode escape hatch — a full HTML fragment repaint. |
| `scene`        | `spec: object`, `recalled?: number`                              | v2 animated scene spec (played by an optional scene player). |
| `ask`          | `id`, `question: string`, `options: AskOption[]`, `context?`     | Surface a glass decision card; blocks the runtime until `answer`. |
| `permission`   | `id`, `tool: string`, `input: unknown`                          | Surface an Approve/Deny permission card; blocks until `decision`. |
| `resolved`     | `id`, `kind: "ask" \| "permission"`, `outcome?`                  | An ask/permission was resolved elsewhere (timeout, abort) — clear its card. |
| `status`       | `state: "working" \| "idle"`, `text?`                            | Quiet working indicator. Absent `text` = heartbeat. |
| `tool`         | `id`, `name: string`, `input?`                                   | Streaming activity-feed row (a tool the runtime invoked this turn). |
| `usage`        | `model?`, `contextUsed`, `contextWindow`, `pct`                  | Context-meter usage update. |
| `session`      | `id: string`                                                     | Session id captured from the runtime; the browser persists + replays it. |
| `frame`        | `n: number`                                                     | A turn's final frame was committed to the frames log (timeline grew). |
| `projection`   | `namespace: string`, `data: unknown`                            | Generic projection of a borrowed namespace (`org.graph`, `agent.inbox`, …). |
| `turn-end`     | `code?: number`, `stderr?: string`                              | Turn ended. `code`/`stderr` are surfaced so silent hangs aren't silent (G3). |
| `error`        | `message: string`                                               | Recoverable error to toast in the UI. |

### `AskOption`

```ts
interface AskOption {
  label: string;       // button text (or input placeholder when freeText)
  value: string;       // the instruction returned as the user's intent; may contain {user_input}
  freeText?: boolean;  // render a text input instead of a button
}
```

## The PatchOp vocabulary (retained-mode)

The canvas is **retained-mode**: the agent patches a persistent canvas rather than
repainting it. A tiny reconciler — pure on the server
([`reconciler.mjs`](../src/kernel/reconciler.mjs)) and DOM-based on the client, with
**identical op semantics** — diffs by component `id` and applies these ops.

```ts
type PatchOp = MountOp | UpdateOp | RemoveOp | LayoutOp;
```

| Op       | Semantics    | Shape | Notes |
|----------|--------------|-------|-------|
| `mount`  | **upsert**   | `{ op:"mount", id, component, props?, slot?, at? }` | Mount a component instance keyed by a stable, caller-chosen `id`. Re-mounting an existing `id` is treated as an update. `slot` selects a named layout region (omitted → default grid flow); `at` is an ordering hint (lower = earlier). `props` are validated against the component manifest. |
| `update` | **shallow-merge** | `{ op:"update", id, props }` | Merge new `props` into an existing mount. `props` is required and must be a non-array object. |
| `remove` | **delete**   | `{ op:"remove", id }` | Remove the mounted component (and its DOM node) by id. No-op if absent. |
| `layout` | **merge**    | `{ op:"layout", spec }` | Patch the layout spec. `spec` is required and must be a non-array object. |

The two reconcilers agreeing on these four semantics is the invariant that lets the server
keep an authoritative workspace document while the browser renders it.

### `LayoutSpec`

```ts
interface LayoutSpec {
  columns?: number;                                       // grid columns (default 4)
  slots?: Record<string, { span?: number; rows?: number }>;
  density?: "calm" | "compact";
  [k: string]: unknown;                                   // intentionally small in v1; grows with packs
}
```

### Validation (`validatePatchOp`)

Each op is structurally validated before it reaches the reconciler:

- `mount` requires a non-empty string `id` and `component`; `props`, if present, must be a
  non-array object.
- `update` requires a non-empty string `id` and a non-array object `props`.
- `remove` requires a non-empty string `id`.
- `layout` requires a non-array object `spec`.
- anything else → `unknown-op`.

`validatePatch(ops)` requires an array and returns the first failing op's index and error
(`op[i]: <error>`).

## Capabilities

The LSP-style declaration an adapter advertises so the kernel lights up the right
affordances:

```ts
interface Capabilities {
  protocolVersion: number;                                   // negotiated against the kernel
  presentation: "mcp" | "sentinel" | "presenter";           // how the runtime delivers paint/ask/patch
  resume: boolean;                                           // can resume a prior session
  turnBoundary: "result-event" | "process-exit" | "iterator-return";
  permissionPrompt: boolean;                                 // routes tool-permission prompts back through the surface
  namespaces: string[];                                      // standard + vendor; empty = core only
  orgTier: "A" | "B" | "C";                                  // graceful degradation (see below)
}
```

**Org tiers:** **A** native fabric (durable agents + registry + messaging + spawn) · **B**
session orchestration (subagents within a turn; employees emulated) · **C** single agent
(no fabric; org features stay dark).

## Namespaces (the extension planes)

Capability namespaces are opt-in, lit by what an adapter advertises. The registry +
validator live in [`src/protocol/namespaces.mjs`](../src/protocol/namespaces.mjs).

- **standard** — Surface ships generic renderers (M6). The names:
  `org.graph`, `agent.spawn`, `agent.message`, `agent.inbox`, `schedule`, `memory`. A
  namespace matches as an exact standard name *or* as a `standard.sub` prefix (e.g.
  `org.graph` matches under `org`).
- **vendor** — follows `vendor.feature`, rendered by the vendor's own pack. Recognized
  vendor prefixes: `claude`, `hermes`, `selfworking` (e.g. `claude.subagents`).

A `projection` payload is validated with `validateProjection({ namespace, data })`: it
needs a non-empty string `namespace`, a present `data` field, and a known namespace; the
result reports `generic: true` for standard namespaces (Surface renders them) and `false`
for vendor passthroughs (the vendor pack interprets them).

## Modes

```ts
type Mode = "operator" | "team" | "visitor";
```

- **operator** — full generation + tool access (trusted, single human).
- **team** — scoped generation + tools, attributable to a principal.
- **visitor** — generation **OFF**, tool access **NONE**, a curated pack only (untrusted).

The capability grant rule, enforced kernel-side:

```
component.capabilities ⊆ mode.grantable ⊆ principal.ceiling
```

See the [security model](security-model.md) for how modes, the locked dock, and the
identity/authority split combine into the trust boundary.
