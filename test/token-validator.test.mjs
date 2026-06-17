// Token-only validator (M3) — the rule that makes runtime generation survivable:
// a component's styles may use ONLY :root design tokens. Registration rejects the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTokens, tokenViolationReason } from "../client/components/token-validator.mjs";
import { Registry, validateComponentManifest } from "../src/kernel/registry.mjs";

test("accepts token-only styles", () => {
  const css = `.tile{ color: var(--ink); background: var(--glass); border-radius: var(--r-tile);
    box-shadow: var(--shadow); border: 1px solid var(--hairline-soft); }`;
  assert.equal(validateTokens(css).ok, true);
});

test("rejects hardcoded colors (hex, rgb, hsl)", () => {
  assert.equal(validateTokens(".x{color:#fff}").ok, false);
  assert.equal(validateTokens(".x{color:#ff00aa}").ok, false);
  assert.equal(validateTokens(".x{background:rgb(1,2,3)}").ok, false);
  assert.equal(validateTokens(".x{background:rgba(0,0,0,0.3)}").ok, false);
  assert.equal(validateTokens(".x{color:hsl(200,50%,50%)}").ok, false);
  const v = validateTokens(".x{color:#abc}").violations;
  assert.equal(v[0].type, "color");
});

test("rejects hardcoded design radii but allows 0 / 50% / pill / token", () => {
  assert.equal(validateTokens(".x{border-radius:12px}").ok, false);
  assert.equal(validateTokens(".x{border-radius:1.5rem}").ok, false);
  assert.equal(validateTokens(".x{border-radius:0}").ok, true);
  assert.equal(validateTokens(".x{border-radius:50%}").ok, true);    // circle idiom
  assert.equal(validateTokens(".x{border-radius:999px}").ok, true);  // pill idiom
  assert.equal(validateTokens(".x{border-radius:var(--r-inner)}").ok, true);
});

test("var() usage and keywords never false-positive", () => {
  assert.equal(validateTokens(".x{color:transparent;border-color:currentColor}").ok, true);
  assert.equal(validateTokens("/* #fff in a comment */ .x{color:var(--accent)}").ok, true);
  assert.equal(validateTokens(".x{background:var(--glass-strong, rgba(0,0,0,0))}").ok, false); // a literal-color var() fallback is still off-system → caught
});

test("tokenViolationReason summarizes (or is empty when clean)", () => {
  assert.equal(tokenViolationReason(".x{color:var(--ink)}"), "");
  assert.match(tokenViolationReason(".x{color:#fff;border-radius:8px}"), /non-token styles/);
});

test("registry REJECTS a manifest whose styles smuggle non-token values", () => {
  const reg = new Registry();
  const base = { name: "evil", version: "1.0.0", props: {}, capabilities: [], tokensOnly: true };
  assert.equal(validateComponentManifest({ ...base, styles: ":host{color:#f00}" }).ok, false);
  assert.throws(() => reg.register({ ...base, styles: ":host{border-radius:8px}" }), /non-token/);
});

test("registry ACCEPTS a token-only component and lists it", () => {
  const reg = new Registry();
  const manifest = {
    name: "metric", version: "1.0.0", props: { value: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
    styles: ":host{color:var(--ink);border-radius:var(--r-tile);background:var(--glass)}",
  };
  reg.register(manifest);
  assert.equal(reg.has("metric"), true);
  assert.equal(reg.list()[0].name, "metric");
});
