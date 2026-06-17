# Authoring components

A component is a **Web Component** on the glass canvas. Most turns *compose*
already-registered components (cheap, deterministic, safe) — authoring a NEW one
is the rare, gated path. Components are userspace and agent-authorable, but the
token-only rule is enforced at registration so generation stays survivable.

## The pattern

Extend `SurfaceComponent` (shadow DOM + props + style-once/content-update), give it
a `static manifest`, `static styles` (token-only), and a `static template(props, esc)`,
then `defineComponent(tag, ctor)`:

```js
// client/components/gauge.js
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceGauge extends SurfaceComponent {
  static manifest = {
    name: "gauge", version: "1.0.0",
    props: { label: { type: "string" }, value: { type: "number" }, max: { type: "number" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `
    .bar { height: 6px; border-radius: 999px; background: var(--hairline-soft); overflow: hidden; }
    .fill { height: 100%; background: var(--accent); border-radius: 999px; }
  `;
  static template(p, esc) {
    const pct = Math.max(0, Math.min(100, (Number(p.value) / (Number(p.max) || 1)) * 100));
    return `<div class="label">${esc(p.label)}</div>
      <div class="bar"><div class="fill" style="width:${pct}%"></div></div>`;
  }
}

export const manifest = defineComponent("surface-gauge", SurfaceGauge);
export default SurfaceGauge;
```

Then add it to `client/components/index.js` (so the element is defined + the
resolver knows it) and register the manifest server-side if your host pre-loads a
catalog: `registry.register(manifest)`.

## Rules

- **Token-only styles.** Use only `:root` tokens — no hardcoded colors/radii.
  Registration (and a dev-time guard at `defineComponent`) **rejects** violations.
  Need a tint → `color-mix(in srgb, var(--token) N%, transparent)`.
- **`tokensOnly: true`** is required in every manifest (forward-compatible contract).
- **Escape all text.** `template(props, esc)` is handed an `esc()` — use it for any
  prop value interpolated into HTML.
- **Props in, render out.** The base sets `.props` on mount and each update; styles
  are injected once and only the content is rewritten, so a prop change never
  replays the mount animation (retained-mode, not repaint).
- **Reflect `size`** (`lg`/`tall`) — the base maps it to `:host([size])` grid sizing.
- **No cross-component refs.** Communicate via the broker (topics), never by
  reaching into another component.

## Compose ≠ generate

Reaching for a new component should be rare. First check the registry
(`registry.list()`) — if a registered primitive (`design-system.md`) fits, compose
it. Authoring is the cold path; the component-smith subagent (M7) searches before
it generates, validates before it registers, and only ever registers a **new
version** — it never mutates a live mount.

## Manifest reference

```ts
interface ComponentManifest {
  name: string; version: string;
  props: JSONSchema;            // validated at mount (shape today; full schema later)
  dataContract?: { topics: string[] };  // broker topics it publishes/subscribes
  capabilities: string[];       // e.g. ["render", "network:none"]
  tokensOnly: true;             // enforced at registration
  styles?: string;              // if present, token-validated at registration
}
```
