# Contributing to Surface

Thanks for helping build Surface. This is a small, deliberate codebase with a strong
philosophy — read this before opening a PR.

## Dev setup

```sh
git clone https://github.com/selfworking-ai/surface
cd surface
npm i            # installs the single runtime dep (ws) + nothing else for the core
npm test         # node:test suite
npm run dev      # boot a local Surface (echo adapter) — same as: npx surface dev
```

`npm run dev` opens `http://localhost:5757`. Set `OPEN_BROWSER=0` to skip auto-opening,
`PORT` / `SURFACE_PORT` to change the port, and `SURFACE_DIR` to relocate the file store
(default `./.surface`).

Build the HTML docs mirror (an isolated island, not part of the core):

```sh
npm run docs:build   # node scripts/build-docs.mjs → writes docs/**/*.html
```

## Philosophy — the constraints that keep Surface small

- **Zero-build core.** Vanilla HTML/CSS/JS and Node ESM. No React, Vite, Tailwind, or
  bundler in the core. If a heavy add-on is genuinely needed (e.g. a Remotion scene kit),
  it lives as an **isolated build island** that commits a prebuilt artifact — the core
  still runs with no build step.
- **Single runtime dependency.** `ws` is it. Do not add a runtime dependency without
  discussion; most needs are met by the Node standard library. (Dev/test tooling that adds
  no runtime weight is a separate, lighter conversation.)
- **Token-only design.** All visual values come from the `:root` glass tokens in
  `client/style.css` (the four-rings contract: tokens → primitives → composed → packs).
  Never hardcode a color or radius — registration rejects non-token values, and so do we
  in review.
- **Surface owns the surface; the runtime owns the fabric.** Don't reimplement agents,
  memory, orchestration, or scheduling in the kernel. If a feature *composes on the canvas
  and is safe to author at runtime*, it's a userspace app/pack. If it *provides a system
  capability or touches trust / persistence / transport*, it's a provider behind a port.

## Gotchas are tested invariants

The numbered gotchas (`G1`–`G12`) in [`CLAUDE.md`](CLAUDE.md) are the hazards that *will*
bite this architecture — binary resolution, NDJSON line-buffering, the `127.0.0.1` bind +
origin allowlist, the `[hidden]` specificity trap, TDZ-on-boot, session continuity, and so
on. They are not tribal knowledge: each is (or should be) covered by a test in `test/`. If
you touch the relevant area, **keep the invariant green**; if you fix a new class of bug,
add the test that pins it.

## Code style

- **Match the surrounding code.** Mirror the existing naming, comment density, and idioms
  of the file you're editing. Surface's comments explain the *non-obvious why* (especially
  the gotchas), not the obvious *what* — write in that voice.
- ESM throughout (`import`/`export`, `.mjs` for runtime modules). `.d.ts` files carry the
  editor-facing types; the `.mjs` codec is the executable source of truth.
- Keep modules pure and dependency-free where they can be (the protocol codec and the
  reconciler especially — they're shared and heavily tested).
- Comment a deliberate exception or a footgun inline; don't leave a reviewer guessing.

## Pull-request checklist

Before requesting review:

- [ ] `npm test` is green.
- [ ] `npm run lint` passes (`node --check` on entry points + the lint script).
- [ ] No new **runtime** dependency (or it was discussed in the issue/PR first).
- [ ] Only design tokens used — no hardcoded colors/radii.
- [ ] Any gotcha you touched still has a passing test; new invariants get new tests.
- [ ] Docs updated if behavior or the protocol changed (and `CHANGELOG.md` under
      `## [Unreleased]`).
- [ ] If the wire protocol changed, the version was bumped and negotiation still degrades
      gracefully.
- [ ] The server still boots and paints a turn (verify the UI in a real browser, not just
      syntax checks).

## Reporting bugs & security issues

Functional bugs: open a GitHub issue with repro steps and your environment. **Security
vulnerabilities: do not open a public issue** — follow [`SECURITY.md`](SECURITY.md).

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
