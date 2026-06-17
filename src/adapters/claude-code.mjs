// Claude Code adapter — teaches Surface to drive the `claude` CLI (Tier B:
// session orchestration; subagents within a turn). It is a SUBPROCESS adapter:
// `run()` spawns `claude -p … --output-format stream-json`, parses the NDJSON
// stream into canonical TurnEvents (via `mapClaudeEvent`), and wires the CLI to
// the kernel's MCP side channel so presentation (patch/render/scene), `ask`,
// permission prompts, and screenshots flow OUT-OF-BAND — NOT over stdout.
//
// The split that matters:
//   • stdout (stream-json) → cognition signals: session id, tool-call activity,
//     token usage, turn boundary. Parsed here, mapped to TurnEvents, yielded.
//   • the MCP side channel (surface-console.mjs ⇄ kernel `/mcp/*`) → presentation
//     + blocking interactions. The kernel turns those into TurnEvents itself via
//     ctx.emit / ctx.ask / ctx.requestPermission. We do NOT try to read them here.
//
// Gotchas baked in: G1 (resolve the binary — `claude` is usually a shell alias),
// G2 (stream-json needs BOTH --include-partial-messages AND --verbose), G3 (route
// permissions through the side channel + allowlist permission_prompt so the CLI
// never hangs asking permission to call its own permission tool), G4 (line-buffered
// NDJSON via readNdjson), G11 (capture session_id exactly once, thread --resume).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";

import { resolveBin, readNdjson } from "../adapter-sdk/index.mjs";

// Absolute path to the MCP stdio server we ship alongside this adapter. Resolved
// from THIS module's URL (not cwd) so it's correct no matter where Surface is run.
const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = join(HERE, "mcp", "surface-console.mjs");

// The MCP server name the CLI registers it under → tools become `mcp__surface__*`.
const MCP_SERVER_NAME = "surface";
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// Tools we explicitly allow so `--permission-mode acceptEdits` auto-grants them
// (G3). permission_prompt MUST be in this list, or the CLI will try to ask
// permission to call its OWN permission tool → infinite hang (body-gotcha #3).
const ALLOWED_TOOLS = [
  "patch", "render", "scene", "ask", "recall", "timeline", "screenshot", "permission_prompt",
].map((t) => TOOL_PREFIX + t).join(",");

// Map the connection's working MODE → the CLI's --permission-mode. operator is
// trusted (auto-edit); team is the default gated posture; visitor can only plan
// (no tools) — the kernel also blocks generation for visitors, this is defence
// in depth on the CLI side.
const MODE_TO_PERMISSION_MODE = {
  operator: "acceptEdits",
  team: "default",
  visitor: "plan",
};

// Operating contract handed to the console agent via --append-system-prompt. It
// teaches the RETAINED-MODE patch vocabulary (Surface's core difference from
// body's immediate-mode render). Modeled on body's CONSOLE_SYSTEM_PROMPT but for
// `patch` + the component registry rather than scene/render.
const CONSOLE_PROMPT = `You operate an AMBIENT OPERATOR CONSOLE. The user sees ONE \
visionOS glass canvas in their browser plus a floating prompt dock they type into. \
They do NOT see your chat text — ONLY the canvas you paint. The terminal is invisible.

Hard rules for THIS environment:

1. ANSWER BY COMPOSING, NOT TALKING. Every turn, paint the canvas with the patch \
tool. patch(ops) applies an array of retained-mode ops: mount {id, component, \
props, slot?} to add a component (re-mounting an existing id just updates it), \
update {id, props} to shallow-merge new props, remove {id} to delete, layout \
{spec:{columns}} to set the grid. If you never patch, the user sees nothing and the \
turn is wasted.

2. RETAINED-MODE — REUSE IDS, UPDATE IN PLACE. The canvas PERSISTS between turns. \
Give each component a stable id and, on later turns, UPDATE it (don't re-mount the \
whole canvas). The reconciler diffs by id; updating in place is the point.

3. THE COMPONENTS. Compose from these registered components (do not invent props): \
metric{label, value, delta?, tone?:'good'|'warn'|'bad', size?:'lg'|'tall'}, \
hero{label, value, body?}, list{label, items:[string]}, status{label, value, tone?}, \
text{label?, text}, kv{label, pairs:[{k,v}]}. Keep it GLANCEABLE — graspable in ~2 \
seconds. Summarize ruthlessly; never dump walls of text or whole files into a tile.

4. DECISIONS GO THROUGH ask, NEVER CHAT. For any fork, choice, confirmation, or \
permission, call ask(question, options) — it renders a glass decision card and \
BLOCKS until the user taps. Each option is {label, value}; the chosen value comes \
back as the user's instruction — continue the SAME turn.

5. Tool-permission requests are handled automatically by the permission card — do \
not worry about them, just proceed with your work.

6. Do NOT use AskUserQuestion or ExitPlanMode (the CLI has no stdin here, so their \
answers can't return). Your private reasoning is fine, but the ONLY thing that \
reaches the user each turn is the canvas you patch. Stay quiet and high-level: show \
state and results, not process. No fake progress.

7. The session REMEMBERS. Every past turn — its prompt and the canvas you painted — \
is preserved and replayed. Call timeline() to list past frames (turn number · \
prompt) and recall(n) to RE-SURFACE a past canvas exactly as it was, without \
regenerating it. Reach for this on "go back", "show that again", "what did you \
show me earlier".

8. The user can DRAW freehand on the canvas to annotate it. When a turn note says a \
drawing is present (or the user says "look at this", "this one", etc.), call the \
screenshot tool — it returns an IMAGE of the current screen (your canvas + their \
strokes) plus which components the drawing overlaps. Look, then respond to what \
they actually marked.`;

// ── mapClaudeEvent — PURE: one raw stream-json object → one TurnEvent or null ────
// Factored out (and named-exported) so it's unit-testable without spawning a real
// `claude`. Returns at most ONE event. For an `assistant` message that carries
// several tool_use blocks, the run loop calls this PER content block (passing a
// synthetic {type:"assistant", message:{content:[oneBlock]}}); see run() below.
//
// Mappings:
//   system/init                         → session_started {id}  (+ surfaces model via usage? no — see below)
//   stream_event content_block_start    → tool_call {id, name, args}   (the instant a tool_use begins)
//     (tool_use only)
//   assistant message tool_use block    → tool_call {id, name, args}   (resolved input)
//   assistant|result usage              → usage {model, inputTokens, outputTokens}
//   anything else                       → null
export function mapClaudeEvent(evt) {
  if (!evt || typeof evt !== "object") return null;

  // Session start — capture the id (caller dedupes to the FIRST only; G11).
  if (evt.type === "system" && evt.subtype === "init") {
    if (typeof evt.session_id === "string" && evt.session_id) {
      return { kind: "session_started", id: evt.session_id };
    }
    return null;
  }

  // Streaming tool-call: with --include-partial-messages the CLI emits a
  // content_block_start the INSTANT the model begins a tool_use (name known,
  // args still streaming). Surface it immediately as activity.
  if (evt.type === "stream_event" && evt.event?.type === "content_block_start") {
    const cb = evt.event.content_block;
    if (cb?.type === "tool_use") {
      return { kind: "tool_call", id: cb.id, name: cb.name, args: cb.input ?? {} };
    }
    return null;
  }

  // Resolved assistant message. It can carry usage AND tool_use blocks. We return
  // ONE event, preferring a tool_call (the visible activity) over usage; the run
  // loop re-feeds per block, and also handles usage from the result event. To keep
  // the function single-purpose and testable, the priority is: first tool_use
  // block present → tool_call; else if usage present → usage; else null.
  if (evt.type === "assistant" && evt.message && typeof evt.message === "object") {
    const content = Array.isArray(evt.message.content) ? evt.message.content : [];
    const toolUse = content.find((b) => b?.type === "tool_use");
    if (toolUse) {
      return { kind: "tool_call", id: toolUse.id, name: toolUse.name, args: toolUse.input ?? {} };
    }
    const u = evt.message.usage;
    if (u && typeof u === "object") return usageEvent(u, evt.message.model);
    return null;
  }

  // Final result event carries the turn's total usage.
  if (evt.type === "result") {
    const u = evt.usage;
    if (u && typeof u === "object") return usageEvent(u, evt.model);
    return null;
  }

  return null;
}

// Build a usage TurnEvent. inputTokens sums the prompt + both cache buckets so the
// context meter reflects everything the model actually read (matches body/server.js).
function usageEvent(u, model) {
  const inputTokens =
    (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return {
    kind: "usage",
    model: typeof model === "string" ? model : undefined,
    inputTokens,
    outputTokens: u.output_tokens || 0,
  };
}

// Write the per-instance MCP config ONCE (registers the `surface` server → our
// stdio script). Cached across turns. The CLI reads this via --mcp-config; the
// adapter passes the side-channel URL + token through the spawn ENV (below), so
// the config itself is static and contains no secrets.
let mcpConfigPath = null;
function ensureMcpConfig() {
  if (mcpConfigPath) return mcpConfigPath;
  const dir = mkdtempSync(join(tmpdir(), "surface-mcp-"));
  const path = join(dir, "mcp-config.json");
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: { command: "node", args: [MCP_SERVER_PATH] },
    },
  }, null, 2));
  mcpConfigPath = path;
  return path;
}

/**
 * @param {{ model?: string }} [opts]
 * @returns {import("../adapter-sdk/adapter").AgentAdapter}
 */
export function claudeCodeAdapter(opts = {}) {
  let binPath = null;

  /** Resolve the `claude` binary (G1). Cached after the first call. */
  function resolveClaudeBin() {
    if (binPath) return binPath;
    binPath = resolveBin("claude", {
      envVar: "CLAUDE_BIN",
      knownPaths: [
        join(homedir(), ".claude", "local", "claude"),
        join(homedir(), ".claude", "bin", "claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
      ],
    });
    return binPath;
  }

  return {
    name: "claude-code",
    capabilities: {
      protocolVersion: 1,
      presentation: "mcp",          // paints via the MCP side channel, not stdout
      resume: true,                 // threads --resume <session-id>
      turnBoundary: "result-event", // the `result` event / process exit ends a turn
      permissionPrompt: true,       // routes tool-permission prompts back to Surface
      namespaces: ["claude.subagents"],
      orgTier: "B",                 // session orchestration (subagents within a turn)
    },

    async resolveBin() { return resolveClaudeBin(); },

    async *run({ prompt, ctx }) {
      const bin = resolveClaudeBin();
      const sideChannel = ctx?.sideChannel || {};
      const mode = ctx?.mode || "operator";
      const permissionMode = MODE_TO_PERMISSION_MODE[mode] || "default";

      const args = [
        "-p", String(prompt ?? ""),
        "--output-format", "stream-json",
        "--include-partial-messages",        // G2: BOTH flags or the stream drops
        "--verbose",
        "--permission-mode", permissionMode,
        "--permission-prompt-tool", `${TOOL_PREFIX}permission_prompt`,
        "--mcp-config", ensureMcpConfig(),
        "--append-system-prompt", CONSOLE_PROMPT,
        "--allowedTools", ALLOWED_TOOLS,     // G3: includes permission_prompt
      ];
      if (opts.model) args.push("--model", opts.model);
      if (ctx?.sessionId) args.push("--resume", ctx.sessionId);

      const proc = spawn(bin, args, {
        // Side-channel coordinates flow via env so the static mcp-config holds no
        // secrets and the token rotates per turn. FORCE_COLOR off keeps NDJSON clean.
        env: {
          ...process.env,
          SURFACE_MCP_URL: sideChannel.baseUrl ?? "",
          SURFACE_MCP_TOKEN: sideChannel.token ?? "",
          FORCE_COLOR: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],   // no stdin (avoid a long-lived stdin wait)
      });

      // Honor cancellation: abort the turn → kill the subprocess (G3 — a headless
      // turn must never be left hanging). Detach the listener when the turn ends.
      const signal = ctx?.signal;
      const onAbort = () => { try { proc.kill("SIGTERM"); } catch { /* already gone */ } };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      // Collect stderr so a non-zero exit isn't a silent hang (G3): the tail is
      // surfaced as an `error` event the kernel can toast.
      let stderrBuf = "";
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => { stderrBuf += chunk; });

      // Drive the process to exit in the background; resolve a promise on close so
      // the generator can yield turn_done AFTER the stdout stream is fully drained.
      let exitCode = null;
      let spawnError = null;
      const done = new Promise((resolve) => {
        proc.on("error", (err) => { spawnError = err; resolve(); });   // e.g. ENOENT
        proc.on("close", (code) => { exitCode = code; resolve(); });
      });

      // Parse stdout NDJSON (G4 — line-buffered across chunks via readNdjson) and
      // map each record to a TurnEvent. Dedupe session_started to the FIRST (G11):
      // the id also appears on every assistant + the final result; capture once.
      let sessionSeen = false;
      try {
        for await (const evt of readNdjson(proc.stdout)) {
          const mapped = mapClaudeEvent(evt);
          if (!mapped) continue;
          if (mapped.kind === "session_started") {
            if (sessionSeen) continue;       // G11: never overwrite the captured id
            sessionSeen = true;
          }
          yield mapped;
        }
      } catch (err) {
        // A broken stdout (e.g. killed mid-read) shouldn't crash the turn — fall
        // through to the close handling, which reports exit/stderr.
        if (!spawnError) spawnError = err;
      }

      await done;
      if (signal) signal.removeEventListener?.("abort", onAbort);

      // Spawn failure (ENOENT etc.) — report it, then close the turn.
      if (spawnError) {
        yield { kind: "error", message: `claude failed to start: ${spawnError.message || spawnError}` };
        yield { kind: "turn_done", code: typeof exitCode === "number" ? exitCode : 1 };
        return;
      }

      // Non-zero exit with stderr → surface the tail (last ~10 lines) before ending.
      if (exitCode !== 0 && stderrBuf.trim()) {
        const tail = stderrBuf.trim().split("\n").slice(-10).join("\n");
        yield { kind: "error", message: tail };
      }
      yield { kind: "turn_done", code: typeof exitCode === "number" ? exitCode : 0 };
    },
  };
}

export default claudeCodeAdapter;
