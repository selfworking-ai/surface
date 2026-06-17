// MCP stdio server for the Surface console — the agent's hands on the canvas.
//
// This is the side the agent CLI (e.g. Claude Code) loads via --mcp-config. It
// speaks JSON-RPC 2.0 over stdio (no SDK dep — line-buffered stdin, same skeleton
// as body/mcp-console.mjs) and RELAYS every tool call to the kernel's loopback
// side-channel HTTP server. The kernel does the real work (paint the canvas, hold
// the turn open on ask/permission, composite a screenshot); this process is a thin
// translator between the CLI's MCP transport and the kernel's `/mcp/*` endpoints.
//
// Surface vs body, the key shift: body was IMMEDIATE-mode (render(html) repainted
// the whole canvas each turn). Surface is RETAINED-mode — the agent PATCHES a
// persistent canvas with mount/update/remove/layout ops and REUSES component ids
// across turns to update in place. `render` survives only as a legacy escape hatch.
// The tool DESCRIPTIONS below are the operating contract the model actually reads;
// they teach that vocabulary, so keep them tight and accurate.
//
// Tools exposed (each becomes `mcp__surface__<name>` to the CLI):
//   patch(ops)              → POST /mcp/event {kind:"patch", ops}     (primary paint)
//   render(html)            → POST /mcp/event {kind:"render", html}   (legacy)
//   ask(question, options)  → POST /mcp/ask        (BLOCKS for the user's tap)
//   permission_prompt(...)  → POST /mcp/permission (BLOCKS; CLI --permission-prompt-tool)
//   screenshot()            → POST /mcp/screenshot (composite image + marked tiles)
//   timeline()              → GET  /mcp/timeline   (past frames metadata)
//   recall(n)               → POST /mcp/recall     (re-surface a past frame)
//
// Transport contract (the kernel side is ALREADY BUILT and frozen): every request
// carries header `x-surface-token: <SURFACE_MCP_TOKEN>`; a 409 means no active turn
// (or bad token). The base URL + token arrive in the env the adapter sets on spawn.

// ── Env: where the kernel side channel lives + the per-turn auth token ──────────
// Declared at module top (above any boot-reachable use) to dodge the TDZ trap (G5).
const BASE_URL = (process.env.SURFACE_MCP_URL ?? "http://127.0.0.1:5761").replace(/\/+$/, "");
const TOKEN = process.env.SURFACE_MCP_TOKEN ?? "";
const PROTOCOL_VERSION = "2024-11-05";

function rid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Every call to the kernel side channel goes through here so the token header is
// never forgotten. Returns the parsed JSON body (kernel always replies JSON).
async function call(path, { method = "POST", body } = {}) {
  const init = {
    method,
    headers: { "content-type": "application/json", "x-surface-token": TOKEN },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`${BASE_URL}${path}`, init);
  if (r.status === 409) {
    // Side-channel contract: 409 = no active turn / bad token. Surface it clearly.
    throw new Error(`side channel rejected ${path}: 409 (no active turn or bad token)`);
  }
  if (!r.ok) throw new Error(`side channel ${path} failed: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  // Most endpoints return JSON; tolerate an empty body on fire-and-forget acks.
  const text = await r.text();
  if (!text) return { ok: true };
  try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}

// Fire-and-forget presentation events all ride the one /mcp/event endpoint.
async function emit(kind, extra) {
  await call("/mcp/event", { body: { kind, ...extra } });
}

// ── Tool implementations ────────────────────────────────────────────────────────
async function patchImpl({ ops }) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error("patch requires a non-empty `ops` array");
  await emit("patch", { ops });
  return "Patched the canvas.";
}

async function renderImpl({ html }) {
  if (typeof html !== "string" || !html.trim()) throw new Error("render requires non-empty `html`");
  await emit("render", { html });
  return "Painted the canvas for this turn.";
}

async function askImpl({ question, options, context }) {
  if (!question || typeof question !== "string") throw new Error("ask requires `question` (string)");
  if (!Array.isArray(options) || options.length === 0) throw new Error("ask requires a non-empty `options` array");
  if (options.length > 6) throw new Error("ask supports at most 6 options");
  const clean = options.map((o, i) => {
    if (!o || typeof o !== "object") throw new Error(`option ${i} must be {label, value, freeText?}`);
    if (!o.label || typeof o.label !== "string") throw new Error(`option ${i} needs a string \`label\``);
    if (!o.value || typeof o.value !== "string") throw new Error(`option ${i} needs a string \`value\``);
    return { label: o.label, value: o.value, freeText: o.freeText === true };
  });

  // BLOCKS on the kernel until the user taps; the kernel resolves the HTTP
  // response with the chosen option (or a cancellation).
  const answer = await call("/mcp/ask", {
    body: { question, context: typeof context === "string" ? context : undefined, options: clean },
  });
  if (answer?.cancelled) {
    return JSON.stringify({ cancelled: true, reason: typeof answer.reason === "string" ? answer.reason : "user did not pick" });
  }
  return JSON.stringify({
    label: typeof answer?.label === "string" ? answer.label : "",
    value: typeof answer?.value === "string" ? answer.value : "",
  });
}

async function permissionPromptImpl(args) {
  // The CLI --permission-prompt-tool contract: it hands us the tool it wants to
  // run; we MUST reply {behavior:"allow", updatedInput} | {behavior:"deny", message}.
  // Any transport failure → deny (never leave the CLI hanging; G3).
  const tool_name = args?.tool_name;
  const input = args?.input ?? {};
  if (!tool_name || typeof tool_name !== "string") {
    return JSON.stringify({ behavior: "deny", message: "permission_prompt called without tool_name" });
  }
  let decision;
  try {
    decision = await call("/mcp/permission", { body: { tool: tool_name, input } });
  } catch (err) {
    return JSON.stringify({ behavior: "deny", message: `permission side channel error: ${err?.message || err}` });
  }
  if (decision?.behavior === "allow") {
    return JSON.stringify({ behavior: "allow", updatedInput: decision.updatedInput ?? input });
  }
  return JSON.stringify({ behavior: "deny", message: typeof decision?.message === "string" ? decision.message : "denied" });
}

// Returns either a string OR an MCP content array (text + image). The dispatcher
// passes content arrays through verbatim; strings get wrapped as one text block.
async function screenshotImpl() {
  let d;
  try { d = await call("/mcp/screenshot", { body: {} }); }
  catch (err) { throw new Error(`screenshot side channel error: ${err?.message || err}`); }
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

async function timelineImpl() {
  const d = await call("/mcp/timeline", { method: "GET" });
  const frames = d?.frames;
  if (!Array.isArray(frames) || !frames.length) return "No frames yet this session.";
  return JSON.stringify(frames.map((f) => ({ n: f.n, prompt: f.prompt, ts: f.ts })));
}

async function recallImpl({ n }) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) throw new Error("recall requires a positive integer turn number `n`");
  const d = await call("/mcp/recall", { body: { n: num } });
  if (d?.error) return `No frame ${num} in history. ${d.error || ""}`.trim();
  return `Re-surfaced turn ${d?.n ?? num} (prompt: "${d?.prompt ?? ""}") onto the canvas.`;
}

// ── Tool descriptors — these ARE the operating contract the model reads ──────────
const TOOLS = [
  {
    name: "patch",
    description:
      "Compose the user's canvas for THIS turn (retained-mode — the PRIMARY way you answer). The user sees ONLY the " +
      "canvas, never your chat text. `ops` is an array of patch ops applied in order; REUSE component ids across turns " +
      "and `update` them in place rather than re-mounting (the canvas persists between turns). Ops: " +
      "{op:'mount', id, component, props, slot?} upserts a component (re-mounting an existing id just updates it); " +
      "{op:'update', id, props} shallow-merges new props into a mounted component; {op:'remove', id} deletes one; " +
      "{op:'layout', spec:{columns?}} sets the grid. Components + props: " +
      "metric{label, value, delta?, tone?:'good'|'warn'|'bad', size?:'lg'|'tall'}, " +
      "hero{label, value, body?}, list{label, items:[string]}, status{label, value, tone?}, " +
      "text{label?, text}, kv{label, pairs:[{k,v}]}. Keep it GLANCEABLE — graspable in ~2 seconds; summarize, " +
      "never dump walls of text or whole files into a tile.",
    inputSchema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          description: "Patch ops applied in order: mount (upsert) / update (shallow-merge) / remove / layout.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["mount", "update", "remove", "layout"] },
              id: { type: "string", description: "Stable component id. Reuse across turns to update in place." },
              component: { type: "string", description: "Registered component name (mount only)." },
              props: { type: "object", description: "Component props (mount/update)." },
              slot: { type: "string", description: "Optional named layout slot (mount)." },
              spec: { type: "object", description: "Layout spec, e.g. {columns} (layout only)." },
            },
            required: ["op"],
          },
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "render",
    description:
      "Legacy escape hatch — paint the canvas with a raw HTML fragment for THIS turn. Prefer `patch` (retained-mode " +
      "components); use `render` only when no registered component fits. The user sees ONLY what you paint, never " +
      "chat text. Keep it glanceable; never dump walls of text.",
    inputSchema: {
      type: "object",
      properties: { html: { type: "string", description: "The HTML fragment to paint onto the canvas." } },
      required: ["html"],
    },
  },
  {
    name: "ask",
    description:
      "Surface a glass decision card on the canvas to get a user choice. Use for ANY fork, decision, or confirmation " +
      "(2–6 options ideal) — never ask in chat text. Each option is {label, value}: the label is what the user taps; " +
      "the value is the instruction returned as the user's chosen intent. BLOCKS until the user taps, then returns a " +
      "JSON string {\"label\":\"…\",\"value\":\"…\"} — treat the value as the user's instruction and continue the SAME " +
      "turn. An option may set freeText:true to render a text input instead of a button; use {user_input} in that " +
      "option's value to splice in what they type. If aborted, returns {\"cancelled\":true,\"reason\":\"…\"}. " +
      "Write values as self-contained instructions, not coy ('Tell me more') — write what the user would type.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The headline shown above the options. Specific to the decision." },
        context: { type: "string", description: "Optional one-line secondary context shown beneath the question." },
        options: {
          type: "array", minItems: 1, maxItems: 6,
          description: "2–6 options. Order matters — first is primary.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Button text (or input placeholder when freeText)." },
              value: { type: "string", description: "Instruction returned to you. May contain {user_input} when freeText." },
              freeText: { type: "boolean", description: "If true, render a text input instead of a button." },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "timeline",
    description:
      "List the canvases you've already painted earlier in THIS session — one entry per past turn, as {n, prompt, ts}. " +
      "Call this to find the turn number to pass to recall(n), or to reason about what you've shown the user before. " +
      "Returns a JSON array (a message instead if there's no history yet).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "recall",
    description:
      "Re-surface a PAST canvas by its turn number `n`, exactly as it was — WITHOUT regenerating it. Use when the user " +
      "says 'go back', 'show that again', 'what did you show me earlier', or refers to something from an earlier turn. " +
      "Find `n` via timeline() first. This re-paints the old frame; you may then continue or patch a fresh view.",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer", description: "The turn number of the past frame to re-surface (from timeline())." } },
      required: ["n"],
    },
  },
  {
    name: "screenshot",
    description:
      "Capture what's currently on the user's screen — the canvas you painted PLUS any freehand annotation the user has " +
      "drawn over it. Returns an IMAGE you can see, plus a list of which components the drawing overlaps. Call this " +
      "whenever a turn note says the user has drawn something, or when the user says 'look at this', 'see what I drew', " +
      "'this one', or otherwise refers to something on screen.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "permission_prompt",
    description:
      "Internal CLI hook — wired via --permission-prompt-tool. Do NOT call this directly. The CLI invokes it when a tool " +
      "call needs approval; it surfaces an Approve/Deny glass card and returns the user's decision as a JSON-stringified " +
      "{behavior:'allow', updatedInput} or {behavior:'deny', message}.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" },
        permission_suggestions: { type: "array" },
      },
      required: ["tool_name", "input"],
    },
  },
];

// ── JSON-RPC 2.0 over stdio ───────────────────────────────────────────────────
// stdin is NOT one-line-per-callback — line-buffer across chunks (same discipline
// as G4 for the adapter's stdout). Slice on "\n", keep the dangling remainder.
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handleLine(line);
  }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

async function handleLine(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification — nothing to reply to

  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "surface-console", version: "0.1.0" },
      }});
    }
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      let result;
      if (name === "patch") result = await patchImpl(args);
      else if (name === "render") result = await renderImpl(args);
      else if (name === "ask") result = await askImpl(args);
      else if (name === "permission_prompt") result = await permissionPromptImpl(args);
      else if (name === "screenshot") result = await screenshotImpl(args);
      else if (name === "timeline") result = await timelineImpl(args);
      else if (name === "recall") result = await recallImpl(args);
      else throw new Error(`unknown tool: ${name}`);
      // A tool may return a ready-made content array (text + image); otherwise wrap
      // its string result as a single text block.
      const content = (result && typeof result === "object" && Array.isArray(result.content))
        ? result.content
        : [{ type: "text", text: result }];
      return send({ jsonrpc: "2.0", id, result: { content } });
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } });
  } catch (err) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: err?.message || String(err) } });
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
