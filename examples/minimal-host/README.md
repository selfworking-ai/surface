# Minimal host

The smallest thing that embeds Surface — `createSurface(...)` + an adapter, in ~10 lines
([`index.mjs`](index.mjs)).

## Run it

From this directory (installs Surface from the repo root via a `file:` dependency):

```sh
npm install
npm start
```

Or, without installing, straight from the repo root (Surface resolves from `src/`):

```sh
node examples/minimal-host/index.mjs
```

Either way, set `OPEN_BROWSER=0` to skip auto-opening the browser, or `PORT` to change the
port (default `5757`).

## What to expect

1. A browser opens to `http://localhost:5757`. The **mission-control** pack has already
   seeded the canvas, so you land on a composed surface (a hero, a few metrics, a list, a
   status pill) under the locked prompt dock — not a blank page.
2. Type a prompt and send it. The **echo adapter** (in-process, no model) paints your text
   back as **retained-mode tiles** — a hero tile plus a couple of metrics and a status pill.
3. Send another prompt: those same tiles **update in place** rather than the canvas
   repainting. You're watching the reconciler patch by component id.
4. Include the word **"ask"** in a prompt to trigger a glass **decision card** — the
   adapter blocks the turn until you tap, demonstrating the bidirectional `ask` side
   channel that real adapters use for permissions and branches.

Swap `echoAdapter()` in `index.mjs` for a real runtime's adapter (e.g. the Claude Code
adapter, M2) to drive the same surface with an actual agent.
