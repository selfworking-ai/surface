// Surface kernel — the hub. `createSurface(config)` wires an http+ws server, a
// retained-mode workspace, a component registry + data broker, the identity/
// permission boundary, and the per-turn loop that drives an AgentAdapter. It is
// the runtime-agnostic generalization of body/server.js: same hardened CLI-bridge
// patterns (origin allowlist + loopback bind, NDJSON in the adapter, held-promise
// ask/permission plumbing, session continuity, frames log), but the body-specific
// bits (MCP spawn, scenes API, skills scan) are out — adapters own the runtime,
// and the canvas is retained-mode (patches) not immediate-mode (render(html)).
//
// Wire contract: every outbound message goes through `encode()` from the protocol
// codec (stamps {v:PROTOCOL_VERSION}); inbound is `decode()`d (incompatible/garbage
// dropped). The browser client implements the mirror.
//
// Scope assumption (carried from body, gotcha G11/§11): ONE active turn at a time
// and effectively one operator client. State that the turn loop touches lives on
// the SurfaceInstance, not module scope, so a host *could* run two instances — but
// within an instance, liveFrame/turnInFlight/the pending-card maps assume a single
// in-flight turn. Multi-client would key these by connection/session.

// ── Imports (G5: everything boot/turn-loop reaches is imported up top) ──────────
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

import { encode, decode, PROTOCOL_VERSION, MODES, isMode } from "../protocol/messages.mjs";
import { Workspace } from "./workspace.mjs";
import { snapshotToOps } from "./reconciler.mjs";
import { Broker } from "./broker.mjs";
import { Registry } from "./registry.mjs";
import { defaultPrincipal, capabilityToken } from "./identity.mjs";
import { modeAllowsGeneration } from "./permissions.mjs";
import { FileStore } from "../providers/store-file.mjs";
import { isValidSessionId } from "../providers/store-file.mjs";
import { installPack } from "../pack-sdk/index.mjs";

// ── Module constants (declared above any boot/closure that reads them — G5) ─────

/** Static MIME map for the served client (small + explicit; no `mime` dep). */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Held-open timeouts. The operator may be AFK — resolve a pending card eventually
// rather than blocking the adapter's turn forever (body §"Held-open timeouts").
const ASK_TIMEOUT_MS = 30 * 60 * 1000;        // decision cards: 30 min
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;  // tool-permission cards: 5 min
const CAPTURE_TIMEOUT_MS = 20 * 1000;         // screenshot composite: 20 s

// Default AuditSink — discards. A host wires a real one (file/console/external) via
// config.providers.audit; the kernel records every mutating action regardless (M4).
const NOOP_AUDIT = { id: "noop", record: async () => {} };

// Default SignalSink — discards. Self-improvement signals (render errors, dwell /
// dismiss, markup, unknown-component) flow here; a host opts into a real sink to
// feed the gardener (M7). The kernel emits signals regardless.
const NOOP_SIGNALS = { id: "noop", record: async () => {} };

// Default model context windows — drives the usage meter's fill/%. 200k by
// default; the 1M beta variants (id contains "[1m]" or "-1m") bump to a million.
function contextWindowFor(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("[1m]") || m.includes("-1m")) return 1_000_000;
  return 200_000;
}

/** Normalize an Origin header for allowlist comparison (trim/lower/strip slash). */
function normalizeOrigin(origin) {
  return String(origin).trim().toLowerCase().replace(/\/+$/, "");
}

/** Resolve the bundled client directory relative to this module (src/kernel → client). */
function defaultClientDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client");
}

/** Best-effort open the OS browser at `url` (skipped when OPEN_BROWSER=0). */
function openBrowserAt(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {}); // headless box / no browser — non-fatal
    child.unref();
  } catch { /* ignore — opening the browser is a convenience, never required */ }
}

// ── createSurface — the factory (the public contract) ───────────────────────────

/**
 * Create a Surface kernel instance.
 * @param {import("./server").SurfaceConfig} config
 * @returns {import("./server").SurfaceInstance}
 */
export function createSurface(config = {}) {
  const adapter = config.adapter;
  if (!adapter || typeof adapter.run !== "function") {
    throw new TypeError("createSurface: config.adapter (an AgentAdapter with run()) is required");
  }

  const env = process.env;
  const port = Number(config.port ?? env.SURFACE_PORT ?? env.PORT ?? 5757);
  const host = config.host ?? "127.0.0.1";                 // loopback only (G8)
  const modes = config.modes ?? [...MODES];
  const defaultMode = config.mode ?? "operator";
  // Provider plane (M4): storage/audit/auth/identity behind kernel ports. The file
  // store is the zero-dep default; audit defaults to noop (a host opts into a real
  // sink); auth/identity stay null until a host wires an IdP (single-operator else).
  const providers = config.providers ?? {};
  const store = providers.storage ?? config.store ?? new FileStore({ dir: env.SURFACE_DIR || "./.surface" });
  const audit = providers.audit ?? config.audit ?? NOOP_AUDIT;
  const signals = providers.signals ?? config.signals ?? NOOP_SIGNALS;
  const auth = providers.auth ?? config.auth ?? null;
  const identity = providers.identity ?? config.identity ?? null;
  const principal = config.principal ?? defaultPrincipal();
  const clientDir = config.clientDir ?? defaultClientDir();
  const openBrowser = config.openBrowser ?? (env.OPEN_BROWSER !== "0");
  const allowedOrigins = new Set(
    (config.allowedOrigins ?? [`http://localhost:${port}`, `http://127.0.0.1:${port}`]).map(normalizeOrigin),
  );

  // Userspace plumbing — shipped now, lightly used in M1 (components land M3).
  const broker = config.broker ?? new Broker();
  const registry = config.registry ?? new Registry();

  // ── Per-instance turn state (single active turn / one client — see header) ────
  const workspace = new Workspace({ store });
  // Starter pack (M5): seed the initial composition on boot. A returning session's
  // saved workspace replaces this via workspace.load(); fresh sessions start here.
  if (config.pack) {
    try { installPack(config.pack, { workspace, registry }); }
    catch (err) { console.error("[surface] pack install failed:", err?.message ?? err); }
  }
  let sessionId = null;                  // captured ONCE from the adapter (G11)
  let turnInFlight = false;
  let currentAbort = null;               // AbortController for the in-flight turn
  let currentCtx = null;                 // active turn's TurnContext — reached by the loopback /mcp side channel
  let turnToken = null;                  // per-turn bearer scoping /mcp/* to the spawned runtime (M2)
  let activePrincipal = principal;       // the principal attributed for the in-flight turn (M4)
  let liveFrame = null;                  // { prompt, ts, kind?, html?, spec? }
  let drawingPresent = false;            // user has a freehand annotation on screen
  const frameCount = new Map();          // sessionId → committed frame count (cache)

  // Held-open side channels (resolved by inbound client messages or timeout).
  const pendingAsks = new Map();         // id → { resolve, timer, question, options, context }
  const pendingPermissions = new Map();  // id → { resolve, timer, tool, input }
  const pendingCaptures = new Map();     // id → { resolve, timer }

  const clients = new Set();             // connected WebSockets

  // ── Wire helpers ──────────────────────────────────────────────────────────────
  function broadcast(msg) {
    const str = encode(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(str);
  }
  function sendTo(ws, msg) {
    if (ws.readyState === 1) ws.send(encode(msg));
  }

  // Audit anchor (M4): record a mutating action against the responsible principal.
  // Fire-and-forget + swallow errors — auditing must NEVER break or block a turn.
  function auditRecord(action, who, data) {
    try {
      const r = audit.record({ principal: who || "anonymous", action, ts: Date.now(), data });
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch { /* audit failures are non-fatal */ }
  }

  // Self-improvement signal (M7): record a REAL observed signal (render-error, dwell,
  // dismiss, markup, unknown-component) for the gardener. Fire-and-forget; never
  // breaks a turn. "The signal is the hard part" — only genuine observations land here.
  function signalRecord(kind, component, data) {
    try {
      const r = signals.record({ kind, component: component || null, ts: Date.now(), data });
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch { /* signal failures are non-fatal */ }
  }

  // ── Frames log (durable presentation history; cognition is the runtime's) ─────
  async function frameNumber(sid) {
    let n = frameCount.get(sid);
    if (n === undefined) {
      const frames = await store.listFrames(sid);
      n = frames.length;
      frameCount.set(sid, n);
    }
    return n + 1;
  }

  // Commit the turn's final frame. Retained-mode default: store a self-contained
  // workspace SNAPSHOT (so recall rebuilds the canvas at turn N without folding
  // history). If the turn last used the escape hatch / scene, store that instead.
  async function commitFrame() {
    const f = liveFrame;
    liveFrame = null;
    if (!f || !isValidSessionId(sessionId)) return; // no session yet → skip gracefully
    const n = await frameNumber(sessionId);
    /** @type {import("../provider-sdk/ports").Frame} */
    const frame = { n, ts: f.ts, prompt: f.prompt };
    if (f.kind === "render" && f.html != null) frame.html = f.html;
    else if (f.kind === "scene" && f.spec != null) frame.spec = f.spec;
    else frame.snapshot = workspace.snapshot();
    try {
      await store.appendFrame(sessionId, frame);
      frameCount.set(sessionId, n);
      await workspace.persist();
      broadcast({ type: "frame", n });
      auditRecord("frame.commit", activePrincipal?.id, { n, session: sessionId });
    } catch (err) {
      console.error("[surface] frame commit failed:", err?.message ?? err);
    }
  }

  // ── Pending-card lifecycle (cancel on turn end / abort / disconnect) ──────────
  function clearPending(reason) {
    for (const [id, e] of pendingAsks) {
      clearTimeout(e.timer);
      try { e.resolve({ cancelled: true, reason }); } catch {}
      broadcast({ type: "resolved", id, kind: "ask", outcome: reason });
    }
    pendingAsks.clear();
    for (const [id, e] of pendingPermissions) {
      clearTimeout(e.timer);
      try { e.resolve({ behavior: "deny", message: reason }); } catch {}
      broadcast({ type: "resolved", id, kind: "permission", outcome: reason });
    }
    pendingPermissions.clear();
    for (const [, e] of pendingCaptures) {
      clearTimeout(e.timer);
      try { e.resolve({ ok: false, reason }); } catch {}
    }
    pendingCaptures.clear();
  }

  // Replay outstanding cards to a (re)connecting client so a refresh mid-turn
  // doesn't strand the user with a dead card.
  function replayPendingTo(ws) {
    for (const [id, e] of pendingAsks) sendTo(ws, { type: "ask", id, question: e.question, options: e.options, context: e.context });
    for (const [id, e] of pendingPermissions) sendTo(ws, { type: "permission", id, tool: e.tool, input: e.input });
  }

  // ── TurnContext side channels — the bidirectional seam the adapter calls into ─
  function makeAsk(signal) {
    return (question, options, context) => new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (!pendingAsks.has(id)) return;
        pendingAsks.delete(id);
        resolve({ cancelled: true, reason: "timeout" });
        broadcast({ type: "resolved", id, kind: "ask", outcome: "timeout" });
      }, ASK_TIMEOUT_MS);
      pendingAsks.set(id, { resolve, timer, question, options, context });
      broadcast({ type: "ask", id, question, options, context });
    });
  }
  function makeRequestPermission() {
    return (tool, input) => new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (!pendingPermissions.has(id)) return;
        pendingPermissions.delete(id);
        resolve({ behavior: "deny", message: "timeout" });
        broadcast({ type: "resolved", id, kind: "permission", outcome: "timeout" });
      }, PERMISSION_TIMEOUT_MS);
      pendingPermissions.set(id, { resolve, timer, tool, input });
      broadcast({ type: "permission", id, tool, input });
    });
  }
  function makeScreenshot() {
    return () => new Promise((resolve) => {
      if (clients.size === 0) { resolve({ ok: false, reason: "no browser connected" }); return; }
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (!pendingCaptures.has(id)) return;
        pendingCaptures.delete(id);
        resolve({ ok: false, reason: "timeout" });
      }, CAPTURE_TIMEOUT_MS);
      pendingCaptures.set(id, { resolve, timer });
      broadcast({ type: "capture-request", id });
    });
  }

  // ── The turn loop — the core ──────────────────────────────────────────────────
  // Handle ONE canonical TurnEvent (shared by the run-loop and ctx.emit, so an
  // adapter pushing out-of-band hits the exact same routing). Returns true on a
  // turn_done sentinel so the loop can break.
  function handleEvent(evt) {
    if (!evt || typeof evt.kind !== "string") return false;
    switch (evt.kind) {
      case "session_started": {
        // Capture ONCE, never overwrite (G11). On first capture, bind + hydrate
        // the workspace and tell the browser to persist the id.
        if (!sessionId && typeof evt.id === "string" && evt.id) {
          sessionId = evt.id;
          workspace.setSession(sessionId);
          // load() is async; fire-and-forget is fine here — the first turn's
          // adapter is mid-stream and won't race the doc (echo mounts fresh).
          workspace.load().catch(() => {});
          broadcast({ type: "session", id: sessionId });
        }
        break;
      }
      case "patch": {
        const { applied, rejected } = workspace.applyOps(evt.ops);
        if (applied.length) broadcast({ type: "patch", ops: applied });
        // Rejected ops are a render-error signal — the agent emitted something the
        // reconciler couldn't apply (bad shape, update/remove of an absent id).
        for (const r of rejected) signalRecord("render-error", r.op?.id, { error: r.error, op: r.op?.op });
        liveFrame && (liveFrame.kind = "patch");
        break;
      }
      case "render": {
        broadcast({ type: "render", html: evt.html });
        if (liveFrame) { liveFrame.kind = "render"; liveFrame.html = evt.html; liveFrame.spec = null; }
        break;
      }
      case "scene": {
        broadcast({ type: "scene", spec: evt.spec });
        if (liveFrame) { liveFrame.kind = "scene"; liveFrame.spec = evt.spec; liveFrame.html = null; }
        break;
      }
      case "tool_call":
        broadcast({ type: "tool", id: evt.id ?? randomUUID(), name: evt.name, input: evt.args });
        break;
      case "status":
        broadcast({ type: "status", state: "working", text: evt.text });
        break;
      case "usage": {
        const model = evt.model;
        const used = (evt.inputTokens || 0) + (evt.outputTokens || 0);
        const window = contextWindowFor(model);
        const pct = window ? Math.min(100, Math.round((used / window) * 1000) / 10) : 0;
        broadcast({ type: "usage", model, contextUsed: used, contextWindow: window, pct });
        break;
      }
      case "projection":
        broadcast({ type: "projection", namespace: evt.namespace, data: evt.data });
        break;
      case "text_delta":
        break; // M1: streaming assistant text is not surfaced (no chat transcript).
      case "error":
        broadcast({ type: "error", message: evt.message });
        break;
      case "turn_done":
        return true;
    }
    return false;
  }

  async function runTurn(text, mode, who) {
    if (turnInFlight) { broadcast({ type: "error", message: "still processing" }); return; }
    turnInFlight = true;
    activePrincipal = who || principal;
    currentAbort = new AbortController();
    liveFrame = { prompt: text, ts: new Date().toISOString(), kind: null, html: null, spec: null };
    broadcast({ type: "status", state: "working" });
    auditRecord("turn.start", activePrincipal?.id, { mode: mode || defaultMode, chars: text.length });

    // If the user drew on screen, hint the adapter to screenshot first. The frame
    // still records the ORIGINAL prompt — the note is for the runtime only.
    const promptText = drawingPresent
      ? `${text}\n\n[The user has drawn a freehand annotation on the current canvas. Use the screenshot tool FIRST to see exactly what they marked, then respond.]`
      : text;

    turnToken = randomUUID();
    /** @type {import("../adapter-sdk/adapter").TurnContext} */
    const ctx = {
      sessionId,
      mode: mode || defaultMode,
      principal: activePrincipal,
      capabilityToken: capabilityToken(activePrincipal),
      ask: makeAsk(currentAbort.signal),
      requestPermission: makeRequestPermission(),
      screenshot: makeScreenshot(),
      emit: (e) => { handleEvent(e); },
      signal: currentAbort.signal,
      // Loopback side channel for runtimes that present OUT-OF-BAND (the Claude
      // adapter's MCP server POSTs presentation/decisions to /mcp/* here, rather
      // than streaming them on stdout). Scoped to this turn by `token`.
      sideChannel: { baseUrl: instance.url, token: turnToken, get session() { return sessionId; } },
    };
    currentCtx = ctx;

    let code = 0;
    let errored = null;
    try {
      for await (const evt of adapter.run({ prompt: promptText, ctx })) {
        if (currentAbort.signal.aborted) break;
        const done = handleEvent(evt);
        if (done) { code = (evt && typeof evt.code === "number") ? evt.code : 0; break; }
      }
    } catch (err) {
      errored = err?.message ?? String(err);
      code = 1;
      broadcast({ type: "error", message: errored });
    } finally {
      // Outstanding cards belong to the turn that just ended — resolve them.
      clearPending("turn ended");
      await commitFrame();
      broadcast({ type: "turn-end", code, ...(code !== 0 && errored ? { stderr: errored } : {}) });
      broadcast({ type: "status", state: "idle" });
      turnInFlight = false;
      currentAbort = null;
      currentCtx = null;
      turnToken = null;
    }
  }

  function abortTurn() {
    if (currentAbort) { try { currentAbort.abort(); } catch {} }
    clearPending("turn aborted");
  }

  // ── Inbound client message handling ───────────────────────────────────────────
  function onClientMessage(ws, conn, raw) {
    const res = decode(raw);
    if (!res.ok) return;                       // garbage / incompatible version — drop
    const msg = res.msg;
    switch (msg.type) {
      case "mode": {
        if (conn.mode) return;                 // immutable once locked (like body)
        if (!isMode(msg.mode) || !modes.includes(msg.mode)) {
          sendTo(ws, { type: "error", message: "invalid mode" });
          return;
        }
        conn.mode = msg.mode;
        auditRecord("mode.lock", conn.principal?.id, { mode: msg.mode });
        break;
      }
      case "resume": {
        // Browser owns session identity (G12). Adopt its id only if we have none.
        if (!sessionId && isValidSessionId(msg.sessionId)) {
          sessionId = msg.sessionId;
          workspace.setSession(sessionId);
          workspace.load().then(() => {
            broadcast({ type: "patch", ops: workspace.toOps() });
          }).catch(() => {});
        }
        break;
      }
      case "prompt": {
        if (!conn.mode) { sendTo(ws, { type: "error", message: "mode required first" }); return; }
        if (turnInFlight) { sendTo(ws, { type: "error", message: "still processing" }); return; }
        if (typeof msg.text !== "string") return;
        // Visitor mode is curated-only — no generation/turns (the safety property).
        if (!modeAllowsGeneration(conn.mode)) {
          sendTo(ws, { type: "error", message: "generation is disabled in visitor mode" });
          return;
        }
        runTurn(msg.text, conn.mode, conn.principal);
        break;
      }
      case "answer": {
        const e = pendingAsks.get(msg.id);
        if (!e) return;                        // stale / double-tap
        clearTimeout(e.timer);
        pendingAsks.delete(msg.id);
        e.resolve(msg.cancelled
          ? { cancelled: true, reason: "user dismissed" }
          : { label: msg.label, value: msg.value });
        broadcast({ type: "resolved", id: msg.id, kind: "ask", outcome: msg.cancelled ? "cancelled" : "answered" });
        auditRecord("ask.answer", conn.principal?.id, { id: msg.id, cancelled: !!msg.cancelled });
        break;
      }
      case "decision": {
        const e = pendingPermissions.get(msg.id);
        if (!e) return;
        clearTimeout(e.timer);
        pendingPermissions.delete(msg.id);
        const allow = msg.decision === "allow";
        e.resolve(allow
          ? { behavior: "allow", updatedInput: e.input }
          : { behavior: "deny", message: (typeof msg.message === "string" && msg.message) || "user denied" });
        broadcast({ type: "resolved", id: msg.id, kind: "permission", outcome: allow ? "allow" : "deny" });
        auditRecord("permission." + (allow ? "allow" : "deny"), conn.principal?.id, { id: msg.id, tool: e.tool });
        break;
      }
      case "abort":
        abortTurn();
        break;
      case "recall":
        // M1: the browser does time-travel itself from /api/history. No-op here.
        break;
      case "event": {
        if (msg.name === "drawing-state") {
          drawingPresent = !!(msg.data && msg.data.present);
        } else if (msg.name === "signal") {
          // Client-observed self-improvement signal (dwell/dismiss/markup/unknown-component).
          const d = msg.data || {};
          if (typeof d.kind === "string") signalRecord(d.kind, d.component, d);
        } else if (msg.name === "capture") {
          const d = msg.data || {};
          const e = pendingCaptures.get(d.id);
          if (e) {
            clearTimeout(e.timer);
            pendingCaptures.delete(d.id);
            e.resolve({ ok: !!d.dataUrl, dataUrl: d.dataUrl || undefined, annotated: Array.isArray(d.annotated) ? d.annotated : [] });
          }
        }
        // Other named events ride along for userspace; ignored by the core.
        break;
      }
    }
  }

  // ── Loopback side channel (/mcp/*) — out-of-band runtime presentation (M2) ────
  // The Claude adapter spawns an MCP server that POSTs presentation + decisions
  // here instead of streaming them on stdout. Every call carries the per-turn
  // token and works only while THAT turn is live — the trust boundary that scopes
  // the side channel to the spawned runtime (loopback bind keeps it off the network).
  function readJsonBody(req) {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(); });
      req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch { resolve(null); } });
      req.on("error", () => resolve(null));
    });
  }
  function sendJson(res, obj, code = 200) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  }

  async function handleMcp(req, res, url) {
    if (!turnToken || !currentCtx || req.headers["x-surface-token"] !== turnToken) {
      return sendJson(res, { error: "no active turn or bad token" }, 409);
    }
    const ctx = currentCtx;
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    if (body === null) return sendJson(res, { error: "bad json" }, 400);
    try {
      switch (url.pathname) {
        case "/mcp/event":            // fire-and-forget: patch/render/scene/tool/status/usage/projection
          ctx.emit(body);
          return sendJson(res, { ok: true });
        case "/mcp/ask": {
          const ans = await ctx.ask(body.question, body.options, body.context);
          return sendJson(res, ans);
        }
        case "/mcp/permission": {
          const dec = await ctx.requestPermission(body.tool, body.input);
          return sendJson(res, dec);
        }
        case "/mcp/screenshot": {
          const shot = await ctx.screenshot();
          return sendJson(res, shot);
        }
        case "/mcp/timeline": {
          const frames = sessionId ? await store.listFrames(sessionId) : [];
          return sendJson(res, { frames: frames.map(({ n, ts, prompt }) => ({ n, ts, prompt })) });
        }
        case "/mcp/recall": {
          const n = Number(body.n);
          const frames = sessionId ? await store.listFrames(sessionId) : [];
          const f = frames.find((fr) => fr.n === n) || frames[n - 1];
          if (!f) return sendJson(res, { error: `no frame ${n}` }, 404);
          if (f.snapshot) broadcast({ type: "patch", ops: snapshotToOps(f.snapshot), recalled: f.n });
          else if (f.html != null) broadcast({ type: "render", html: f.html, recalled: f.n });
          else if (f.spec) broadcast({ type: "scene", spec: f.spec, recalled: f.n });
          return sendJson(res, { ok: true, n: f.n, prompt: f.prompt });
        }
        default:
          return sendJson(res, { error: "unknown side-channel route" }, 404);
      }
    } catch (err) {
      return sendJson(res, { error: err?.message || String(err) }, 500);
    }
  }

  // ── HTTP routing (health, history, static client) ────────────────────────────
  async function handleHttp(req, res) {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); }
    catch { res.writeHead(400).end("bad request"); return; }

    if (url.pathname === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, clients: clients.size }));
      return;
    }
    if (url.pathname === "/api/history") {
      const sid = url.searchParams.get("session") || "";
      if (!isValidSessionId(sid)) { res.writeHead(400).end("bad session"); return; }
      const frames = await store.listFrames(sid);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ frames }));
      return;
    }
    // Loopback side channel for out-of-band runtimes (M2): the spawned MCP server
    // POSTs presentation/decisions here, scoped to the active turn by its token.
    if (url.pathname.startsWith("/mcp/")) return handleMcp(req, res, url);

    // Static client. "/" → index.html. Block traversal. Dev cache headers (G7).
    let path = decodeURIComponent(url.pathname);
    if (path === "/" || path === "") path = "/index.html";
    const safe = normalize(path).replace(/^\/+/, "");
    if (safe.includes("..")) { res.writeHead(403).end("forbidden"); return; }
    const file = join(clientDir, safe);
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error("not a file");
      const buf = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store, must-revalidate",   // G7: not no-cache
        "pragma": "no-cache",
        "expires": "0",
        "x-content-type-options": "nosniff",
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  }

  // ── Boot the http + ws hub ────────────────────────────────────────────────────
  const httpServer = createServer(handleHttp);
  const wss = new WebSocketServer({ noServer: true });   // G8: intercept upgrade ourselves

  httpServer.on("upgrade", (req, socket, head) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); }
    catch { socket.destroy(); return; }
    // Origin allowed = no Origin (native/curl) OR normalized ∈ allowlist (G8).
    const origin = req.headers.origin;
    const ok = url.pathname === "/ws" && (!origin || allowedOrigins.has(normalizeOrigin(origin)));
    if (!ok) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    const conn = { mode: null, principal };   // per-connection state (mode locked once; principal from auth, else the default operator)

    // Handshake first: announce modes + the negotiated protocol version, then the
    // adapter's capabilities (LSP-style), then replay the live composition so a
    // refresh rebuilds the canvas (retained-mode reconnect).
    sendTo(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, modes, defaultMode });
    sendTo(ws, { type: "capabilities", caps: adapter.capabilities });
    const ops = workspace.toOps();
    if (ops.length) sendTo(ws, { type: "patch", ops });
    replayPendingTo(ws);

    ws.on("message", (data) => {
      try { onClientMessage(ws, conn, data.toString("utf8")); }
      catch (err) { console.error("[surface] message handler threw:", err?.message ?? err); }
    });
    ws.on("close", () => {
      clients.delete(ws);
      // If the disconnecting client owned the in-flight turn (one-client assumption),
      // abort it so a dropped tab doesn't leave a turn hung on a dead card.
      if (clients.size === 0 && turnInFlight) abortTurn();
    });
    ws.on("error", () => { /* socket-level errors handled by close */ });
  });

  // ── SurfaceInstance ─────────────────────────────────────────────────────────
  /** @type {import("./server").SurfaceInstance} */
  const instance = {
    host,
    port,
    get url() { return `http://localhost:${this.port}`; },
    broker,
    registry,
    providers: { storage: store, audit, signals, auth, identity },
    principal,
    broadcast,
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener("error", reject);
          instance.port = httpServer.address().port;   // actual bound port (supports port:0 for ephemeral/tests)
          const url = instance.url;
          console.log(`[surface] ${url}  (bound ${host}, adapter: ${adapter.name})`);
          if (openBrowser) openBrowserAt(url);
          resolve({ port: instance.port, url });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        abortTurn();
        for (const ws of clients) { try { ws.close(); } catch {} }
        clients.clear();
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
  };

  // Optional one-time adapter setup (resolve a binary, warm a connection). Fire it
  // here so a host that calls listen() immediately still gets init() run first;
  // errors surface on the console rather than crashing boot.
  if (typeof adapter.init === "function") {
    Promise.resolve().then(() => adapter.init()).catch((err) =>
      console.error(`[surface] adapter.init() failed:`, err?.message ?? err));
  }

  return instance;
}

export default createSurface;
