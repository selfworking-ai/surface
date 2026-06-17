// Token-only validator — the rule that makes runtime generation SURVIVABLE.
// A component's stylesheet may use ONLY the :root design tokens (var(--…)), never
// hardcoded colors or design radii. Registration runs this and REJECTS violations,
// so an agent-authored (or hand-written) component cannot smuggle off-system
// styling onto the glass canvas. Pure + DOM-free so it runs both in the browser
// (at component definition) and in node (the registry + CI tests).
//
// What's rejected:
//   • colors  — any hex (#rgb…), rgb()/rgba()/hsl()/hsla() literal not inside var().
//   • radii   — a border-radius length in px/rem/em (design radii must be tokens).
// What's allowed:
//   • var(--token) (any token), `transparent`, `currentColor`, keywords, `0`,
//   • `50%` (circle idiom) and ≥900px (the fully-round "pill" idiom).

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g;
const RADIUS_DECL_RE = /border-radius\s*:\s*([^;}\n]+)/gi;
const LENGTH_RE = /-?\d*\.?\d+(?:px|rem|em)\b/gi;

/**
 * Validate a CSS string against the token-only rule.
 * @param {string} css
 * @returns {{ ok: boolean, violations: {type:"color"|"radius", value:string}[] }}
 */
export function validateTokens(css) {
  const violations = [];
  const text = String(css || "");

  // Neutralize comments + every token IDENTIFIER (both `--x:` definitions and
  // `var(--x)` references) → "__T__". Correct token usage can't false-positive,
  // while any literal that remains is caught — including a literal sitting in a
  // var() FALLBACK (`var(--x, #fff)`), which is still off-system styling here.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[a-zA-Z0-9-]+/g, "__T__");

  let m;
  COLOR_RE.lastIndex = 0;
  while ((m = COLOR_RE.exec(stripped))) {
    violations.push({ type: "color", value: m[0].replace(/\s*\($/, "()") });
  }

  RADIUS_DECL_RE.lastIndex = 0;
  while ((m = RADIUS_DECL_RE.exec(stripped))) {
    const lengths = m[1].match(LENGTH_RE) || [];
    for (const L of lengths) {
      const n = parseFloat(L);
      if (n === 0) continue;        // 0 is fine
      if (n >= 900) continue;       // 999px pill idiom — fully round, not a design radius
      violations.push({ type: "radius", value: L.trim() });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Convenience: a one-line reason string for a rejection (or "" when ok). */
export function tokenViolationReason(css) {
  const { ok, violations } = validateTokens(css);
  if (ok) return "";
  const shown = violations.slice(0, 6).map((v) => `${v.type}:${v.value}`).join(", ");
  return `non-token styles (${violations.length}): ${shown}`;
}
