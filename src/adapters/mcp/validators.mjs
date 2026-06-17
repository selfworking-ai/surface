// Pure validators + shapers for the Surface MCP console — the side-channel-free core.
//
// surface-console.mjs attaches stdin/SIGTERM at import and exports nothing, so it's
// unreachable by unit tests. Its `*Impl` tool functions MIX pure validation/
// normalization/shaping with the impure side-channel `call()`/`emit()`. This module
// holds ONLY the pure half — no fetch, no process, no I/O; just validate (throw on
// bad input), normalize, and shape strings/content. The `*Impl` functions delegate
// here so the rules are unit-testable WITHOUT a running kernel (the token-validator
// pattern). Behavior MUST be identical: same throw messages, same returned strings.
//
// The G3 liveness invariant lives here too: permission shaping DEFAULTS TO DENY on any
// error / missing tool_name, so a headless turn never silently hangs (CLAUDE.md G3 /
// gotchas SX-D). `denyResponse` + `shapePermissionResponse` make that pure-testable.

// ── patch ────────────────────────────────────────────────────────────────────────
/**
 * Validate `patch` args. Mirrors patchImpl's guard.
 * @param {{ops?: unknown}} args
 * @returns {{ops: unknown[]}}
 * @throws if `ops` is not a non-empty array.
 */
export function validatePatchArgs(args) {
  const ops = args?.ops;
  if (!Array.isArray(ops) || ops.length === 0) throw new Error("patch requires a non-empty `ops` array");
  return { ops };
}

// ── render ───────────────────────────────────────────────────────────────────────
/**
 * Validate `render` args. Mirrors renderImpl's guard.
 * @param {{html?: unknown}} args
 * @returns {{html: string}}
 * @throws if `html` is not a non-empty (trimmed) string.
 */
export function validateRenderArgs(args) {
  const html = args?.html;
  if (typeof html !== "string" || !html.trim()) throw new Error("render requires non-empty `html`");
  return { html };
}

// ── ask ──────────────────────────────────────────────────────────────────────────
/**
 * Validate + normalize `ask` args, cleaning each option to {label, value, freeText}.
 * Mirrors askImpl's validation block exactly (same messages, same coercion).
 * @param {{question?: unknown, options?: unknown, context?: unknown}} args
 * @returns {{question: string, context: string|undefined, options: {label:string, value:string, freeText:boolean}[]}}
 * @throws on: non-string/empty question; non-array/empty options; >6 options;
 *   any option not an object; any option missing a string label or string value.
 */
export function normalizeAskArgs(args) {
  const { question, options, context } = args ?? {};
  if (!question || typeof question !== "string") throw new Error("ask requires `question` (string)");
  if (!Array.isArray(options) || options.length === 0) throw new Error("ask requires a non-empty `options` array");
  if (options.length > 6) throw new Error("ask supports at most 6 options");
  const clean = options.map((o, i) => {
    if (!o || typeof o !== "object") throw new Error(`option ${i} must be {label, value, freeText?}`);
    if (!o.label || typeof o.label !== "string") throw new Error(`option ${i} needs a string \`label\``);
    if (!o.value || typeof o.value !== "string") throw new Error(`option ${i} needs a string \`value\``);
    return { label: o.label, value: o.value, freeText: o.freeText === true };
  });
  return {
    question,
    context: typeof context === "string" ? context : undefined,
    options: clean,
  };
}

/**
 * Shape the JSON-string result of an `ask` from the kernel's answer object.
 * Mirrors askImpl's tail (after the blocking call).
 * @param {{cancelled?: unknown, reason?: unknown, label?: unknown, value?: unknown}} [answer]
 * @returns {string} JSON: {cancelled,reason} when cancelled, else {label,value}.
 */
export function shapeAskResult(answer) {
  if (answer?.cancelled) {
    return JSON.stringify({ cancelled: true, reason: typeof answer.reason === "string" ? answer.reason : "user did not pick" });
  }
  return JSON.stringify({
    label: typeof answer?.label === "string" ? answer.label : "",
    value: typeof answer?.value === "string" ? answer.value : "",
  });
}

// ── permission_prompt (G3: DEFAULT TO DENY on any error / missing tool_name) ───────
/**
 * Build a `{behavior:"deny", message}` JSON string. The pure G3 escape hatch:
 * missing tool_name, transport failure, or a non-allow decision all route here so
 * the CLI is never left hanging.
 * @param {string} message
 * @returns {string} JSON: {behavior:"deny", message}.
 */
export function denyResponse(message) {
  return JSON.stringify({ behavior: "deny", message });
}

/**
 * Shape the kernel's permission decision into the CLI's required reply string.
 * Mirrors permissionPromptImpl's tail (after the blocking call). An `allow` decision
 * passes `updatedInput` through (falling back to the original `input`); anything else
 * DENIES (G3) with the decision's message, or "denied" when none was given.
 * @param {{behavior?: unknown, updatedInput?: unknown, message?: unknown}} [decision]
 * @param {unknown} input  the original tool input, used as the allow fallback.
 * @returns {string} JSON: {behavior:"allow", updatedInput} | {behavior:"deny", message}.
 */
export function shapePermissionResponse(decision, input) {
  if (decision?.behavior === "allow") {
    return JSON.stringify({ behavior: "allow", updatedInput: decision.updatedInput ?? input });
  }
  return denyResponse(typeof decision?.message === "string" ? decision.message : "denied");
}

// ── screenshot ─────────────────────────────────────────────────────────────────────
/**
 * Parse the kernel's screenshot result into a string OR an MCP content array.
 * Mirrors screenshotImpl's tail (after the blocking call): unavailable → message
 * string; malformed data-URL → message string; otherwise a [text, image] content
 * array, with the text annotated by which components the user's drawing overlaps.
 * @param {{ok?: unknown, dataUrl?: unknown, reason?: unknown, annotated?: unknown}} [d]
 * @returns {string | {content: ({type:"text", text:string}|{type:"image", data:string, mimeType:string})[]}}
 */
export function parseScreenshotResult(d) {
  if (!d?.ok || !d.dataUrl) return `No screenshot available (${d?.reason || "nothing to capture"}).`;
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(d.dataUrl);
  if (!m) return "Screenshot returned malformed image data.";
  const overlaps = Array.isArray(d.annotated) && d.annotated.length
    ? `The user's drawing overlaps: ${d.annotated.join("; ")}.`
    : "The user has drawn on the screen.";
  return {
    content: [
      { type: "text", text: `${overlaps} Below is the current screen (your canvas with the user's annotation drawn over it):` },
      { type: "image", data: m[2], mimeType: m[1] },
    ],
  };
}
