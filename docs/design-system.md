# Design system

Surface's visual language is the visionOS glass system from Claude.ai/design,
implemented pixel-faithfully. It is also the **constraint that makes runtime
generation survivable**: four rings, each constraining the one above.

```
tokens (:root glass)  →  primitives (Web Components)  →  composed  →  packs
```

A component may style itself **only** with the `:root` tokens. Registration runs
the token-only validator and **rejects** hardcoded colors/radii (see below), so an
agent-authored component can never smuggle off-system styling onto the canvas.

## Ring 1 — tokens (`client/style.css :root`)

Never invent tokens; reuse these. They cascade everywhere — including *through*
shadow boundaries into each Web Component.

| Group | Tokens |
|---|---|
| glass | `--glass` `--glass-strong` `--glass-dock` `--hairline` `--hairline-soft` `--blur` (`blur(36px) saturate(1.8)`) |
| ink | `--ink` `--muted` `--faint` |
| accent + signal | `--accent` (`#cdfb45`) `--accent-ink` `--good` `--warn` `--bad` |
| geometry | `--r-tile` (26px) `--r-inner` (16px) `--r-dock` (30px) `--shadow` `--shadow-soft` |

Backdrop: warm/cool radial blobs over a deep base. Accent: lime. Quiet, card-less,
concentric radii, soft shadows.

## Ring 2 — primitives (`client/components/`)

Each primitive is a **Web Component** with its own shadow root (visual + style
isolation). The reconciler mounts it by name and assigns `.props`; the element
renders itself. Built-ins:

| Component | Tag | Props |
|---|---|---|
| metric | `<surface-metric>` | `label, value, delta?, tone?(good/warn/bad), size?(lg/tall)` |
| hero | `<surface-hero>` | `label, value, body?` (full-width) |
| list | `<surface-list>` | `label, items: string[] \| {text}[]` |
| status | `<surface-status>` | `label, value, tone?, status?` (toned pill via `color-mix`) |
| text | `<surface-text>` | `label?, text` |
| kv | `<surface-kv>` | `label, pairs: {k,v}[] \| object` |
| *(fallback)* | `<surface-fallback>` | any unknown component → name + props dump (never invisible) |

The agent composes these via `patch` ops (`mount`/`update`/`remove`/`layout`).
Most turns *arrange* registered primitives — cheap, deterministic, safe.

## Ring 3 — composed components

Larger components built from primitives + tokens, authored the same way and
subject to the same token-only rule. (Authoring guide: `authoring-components.md`.)

## Ring 4 — packs

Userspace apps: a set of components + layout + data wiring + a permission profile
(M5).

## The token-only rule (enforced)

`client/components/token-validator.mjs` (`validateTokens(css)`) rejects:

- **colors** — any `#hex`, `rgb()/rgba()/hsl()/hsla()` literal not inside `var()`
  (including a literal in a `var()` fallback — still off-system here).
- **radii** — a `border-radius` length in `px/rem/em`. Allowed: `0`, `50%` (circle),
  `≥900px` (the pill idiom), and `var(--r-*)`.

It runs at two points: a dev-time guard when a Web Component is defined, and — the
load-bearing one — inside `Registry.register()`, so registering a component whose
`styles` smuggle non-token values **throws**. Need a translucent tint? Derive it
from a signal token with `color-mix`, e.g. the status pill:
`background: color-mix(in srgb, var(--good) 16%, transparent)`.

## Shadow-DOM isolation + the data broker

Components are encapsulated (a component's CSS can't leak out or be overridden by
another), yet the `:root` custom properties pierce the shadow boundary, so the
glass system still applies. Components never reference each other directly — they
publish/subscribe through the **broker** (`src/kernel/broker.mjs`): a source pushes
to a topic, every subscribed component re-renders. That decoupling is what makes
the UI *living* and maps each tile to a microservice-style data contract.
