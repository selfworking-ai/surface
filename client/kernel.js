// Surface — browser kernel. The locked dock + a retained-mode, keyed DOM
// reconciler over a persistent canvas + time-travel + drawing + screenshot +
// context meter + activity feed + the mode gate.
//
// The big change vs `body`: body was immediate-mode (canvas.innerHTML = html
// every turn). Surface is RETAINED-MODE — the agent PATCHES a persistent canvas
// with mount/update/remove/layout ops, which we apply through a reconciler keyed
// by component id. render(html)/scene(spec) survive as escape hatches.
//
// Persistence is the browser's job (G12): mode + session id + drawing strokes in
// localStorage, replayed on every (re)connect. The server is logically stateless.
//
// TDZ discipline (G5): EVERY module-scope const the boot path touches is declared
// up here, above boot() at the very bottom. This bit `body` twice — stay strict.

// Design-system Web Components (M3) — importing this DEFINES the custom elements
// (<surface-metric> …) and gives the reconciler the name→tag resolver. Tokens
// pierce the shadow boundary, so :root styling still reaches inside each element.
import { tagFor, isRegistered } from "./components/index.js";

const PROTOCOL_V = 1;

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("canvas");
const statusEl = $("status");
const statusLabel = statusEl.querySelector(".status-label");
const cardsEl = $("cards");
const gate = $("gate");
const promptEl = $("prompt");
const sendBtn = $("send");
const toastEl = $("toast");
const seekEl = $("seek");
const seekTrack = $("seek-track");
const seekFill = $("seek-fill");
const seekThumb = $("seek-thumb");
const seekNow = $("seek-now");
const seekSpan = $("seek-span");
const sessionChip = $("session-chip");
const modeChip = $("mode-chip");
const drawCanvas = $("draw");
const drawToggle = $("draw-toggle");
const drawClear = $("draw-clear");
const toolfeed = $("toolfeed");
const meter = $("meter");
const newSessionBtn = $("new-session");
const playerRoot = $("player-root");

const LS_MODE = "surface.mode";
const LS_SESSION = "surface.session";
const LS_DRAW = "surface.draw";

const getMode = () => localStorage.getItem(LS_MODE);
const setModeLS = (m) => localStorage.setItem(LS_MODE, m);
const getSession = () => localStorage.getItem(LS_SESSION);
const setSession = (id) => localStorage.setItem(LS_SESSION, id);

let ws = null;
let modeLocked = false;
let currentMode = null;

// ── Retained-mode store ──────────────────────────────────────────────────
// The live composition. id → { component, props, slot, at, el }. This is the
// source of truth for "now"; the reconciler mutates it on every patch op.
const nodes = new Map();
let layoutSpec = { columns: 4 };

// Generic projection renderers (M6): a borrowed-namespace projection (org.graph,
// agent.inbox, …) maps to a registered component that renders the data. This is how
// a Tier-A runtime lights up org mode with NO bespoke UI — the kernel relays the
// projection unchanged; the client picks the renderer by namespace.
const NS_RENDERER = { "org.graph": "org-graph", "agent.inbox": "inbox" };

// ── Time-travel state ──────────────────────────────────────────────────────
// `frames` = committed turns (from /api/history); each frame carries a retained
// `snapshot` (components + layout) and/or an `html`/`spec` escape-hatch payload.
// `viewIndex` = which frame is on screen; at the right edge we show the LIVE
// canvas (the live `nodes`), not a frame.
let frames = [];
let viewIndex = -1;
let live = true;              // are we showing the PRESENT (vs a scrubbed-back frame)?
let liveKind = "patch";       // what the live view is: "patch" | "html" | "scene"
let liveHtml = null;          // latest live render() html (escape hatch)
let liveSpec = null;          // latest live scene() spec (escape hatch)
let scenePlayer = null;       // optional scene player instance, mounted lazily
// "At now" is an EXPLICIT flag, not derived from viewIndex vs frames.length: a
// live patch lands BEFORE its frame-commit grows `frames`, so a derived check
// reads stale and would snap us into the past on the very next history refresh.
const atNow = () => live;

// Time-travel runs on a real time axis. Default window is 1 hour; it grows to
// fit the whole session if it has run longer. "now" is the right edge.
const SEEK_SPAN_MIN = 60 * 60 * 1000;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── WebSocket ────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.addEventListener("open", () => setConnected(true));
  ws.addEventListener("close", () => { setConnected(false); modeLocked = false; setDockEnabled(false); setTimeout(connect, 800); });
  ws.addEventListener("message", (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  });
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ v: PROTOCOL_V, ...obj })); }

function handle(msg) {
  switch (msg.type) {
    case "hello": {
      // Re-handshake on every (re)connect. A stored, still-offered mode auto-
      // locks the dock optimistically; otherwise surface the gate. (The M1
      // contract has no separate mode-ack — hello is the round-trip.)
      const stored = getMode();
      if (stored && msg.modes?.includes(stored)) { lockMode(stored); }
      else { showGate(msg); }
      const sid = getSession();
      if (sid) send({ type: "resume", sessionId: sid });
      if (strokes.length) send({ type: "event", name: "drawing-state", data: { present: true } }); // re-announce a restored drawing
      break;
    }
    case "capabilities": /* M1: keep for later; affordances are static for now */ break;
    case "patch": onPatch(msg); break;
    case "render": onRender(msg); break;
    case "scene": onScene(msg); break;
    case "ask": showAsk(msg); break;
    case "permission": showPermission(msg); break;
    case "resolved": removeCard(msg.id); break;
    case "status": setStatus(msg.state, msg.text); break;
    case "tool": onToolCall(msg); break;
    case "usage": setMeter(msg); break;
    case "session": setSession(msg.id); setSessionChip(msg.id); break;
    case "frame": fetchHistory(); break;
    case "projection": onProjection(msg); break;
    case "turn-end": setStatus("idle"); if (msg.stderr) toast(`Turn error: ${firstLine(msg.stderr)}`); break;
    case "error": toast(msg.message || "error"); break;
    case "capture-request": handleCaptureRequest(msg); break;
  }
}

// ── Component rendering — registered Web Components (M3) ─────────────────────
// Each primitive is a shadow-DOM custom element (<surface-metric> …), defined by
// importing ./components. The reconciler creates the element and assigns `.props`;
// the element renders ITSELF (isolated styles; :root tokens still cascade in). An
// unknown component name → <surface-fallback> (name + props dump) so a mount is
// never silently invisible. Sizing/items/tone now live inside the components.
function renderComponent(name, props) {
  props = props && typeof props === "object" ? props : {};
  const el = document.createElement(tagFor(name));
  el.dataset.component = name;
  el.props = isRegistered(name) ? props : { __name: name, __props: props };
  return el;
}

// Display fields for the screenshot composite. Custom-element hosts expose `.props`;
// legacy render(html) `.tile` nodes are read from their light DOM.
function tileInfo(el) {
  const p = el.props;
  if (p && typeof p === "object") {
    const src = p.__props || p;
    const body = src.body ?? src.text ?? (Array.isArray(src.items) ? src.items.join(", ") : "");
    return { label: src.label, value: src.value, body };
  }
  return {
    label: el.querySelector(".label")?.textContent?.trim(),
    value: el.querySelector(".value")?.textContent?.trim(),
    body: el.querySelector("p, .list, ul")?.textContent?.trim(),
  };
}

// ── The reconciler ─────────────────────────────────────────────────────────
// Applies mount/update/remove/layout. mount = upsert, update = shallow-merge,
// remove = delete, layout = merge. Identical op semantics to the server-side
// reconciler. Always snaps the view to "now" (a patch describes the present).
function ensureGrid() {
  if (canvas.querySelector(".surface-empty")) canvas.textContent = "";
  canvas.classList.add("grid");
  showHtmlView();
}

function applyPatch(ops) {
  if (!Array.isArray(ops)) return;
  if (!atNow()) returnToNow();           // a live patch is the present; leave history
  ensureGrid();
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    switch (op.op) {
      case "mount": opMount(op); break;
      case "update": opUpdate(op); break;
      case "remove": opRemove(op); break;
      case "layout": opLayout(op); break;
    }
  }
  liveKind = "patch"; liveHtml = null; liveSpec = null;
  live = true;
  viewIndex = frames.length - 1;
  setPast(false);
  buildRail();
}

function opMount({ id, component, props, slot, at }) {
  if (!id || !component) return;
  const el = renderComponent(component, props);
  el.dataset.id = id;
  const existing = nodes.get(id);
  if (existing && existing.el && existing.el.parentNode === canvas) {
    canvas.replaceChild(el, existing.el);   // upsert: swap in place, keep order
  } else {
    el.classList.add("mounted");            // first mount → rise in
    canvas.appendChild(el);
  }
  nodes.set(id, { component, props: props && typeof props === "object" ? { ...props } : {}, slot, at, el });
}

function opUpdate({ id, props }) {
  const node = nodes.get(id);
  if (!node) return;                        // unknown id → ignore
  node.props = { ...node.props, ...(props && typeof props === "object" ? props : {}) };
  // Setting .props re-renders the custom element in place (no mount rise replay).
  node.el.props = isRegistered(node.component) ? node.props : { __name: node.component, __props: node.props };
}

function opRemove({ id }) {
  const node = nodes.get(id);
  if (!node) return;
  if (node.el && node.el.parentNode) node.el.remove();
  nodes.delete(id);
}

function opLayout({ spec }) {
  if (!spec || typeof spec !== "object") return;
  layoutSpec = { ...layoutSpec, ...spec };
  canvas.classList.add("grid");
  if (layoutSpec.columns != null) canvas.style.setProperty("--cols", String(layoutSpec.columns));
}

function onPatch(msg) {
  if (msg.recalled != null) { recallFrame(msg.recalled); return; }
  applyPatch(msg.ops);
}

// A borrowed-namespace projection → mount/upsert its generic renderer on the
// canvas, keyed by namespace, fed the projection data. Unknown namespaces are
// vendor passthroughs a pack renders; the core ignores them.
function onProjection(msg) {
  const component = NS_RENDERER[msg.namespace];
  if (!component) return;
  applyPatch([{ op: "mount", id: "proj:" + msg.namespace, component, props: msg.data || {} }]);
}

// Re-render the LIVE canvas from `nodes` (used on return-to-now). No rise
// animation — these components already existed. Reapplies the live layout.
function renderLive() {
  if (liveKind === "scene" && liveSpec) { playScene(liveSpec); return; }
  if (liveKind === "html" && liveHtml != null) { showHtml(liveHtml); return; }
  showHtmlView();
  canvas.textContent = "";
  if (nodes.size === 0) { canvas.classList.remove("grid"); paintEmpty(); return; }
  canvas.classList.add("grid");
  if (layoutSpec.columns != null) canvas.style.setProperty("--cols", String(layoutSpec.columns));
  for (const [id, node] of nodes) {
    const el = renderComponent(node.component, node.props);
    el.dataset.id = id;
    node.el = el;
    canvas.appendChild(el);
  }
  stage.scrollTop = 0;
}

function paintEmpty() {
  canvas.innerHTML = `<div class="surface-empty">
    <div class="eyebrow">Surface</div>
    <h1>Speak to begin.</h1>
    <p>Ask anything in the dock below.</p>
  </div>`;
}

// ── Escape hatches: render(html) and scene(spec) ───────────────────────────
function showHtmlView() { playerRoot.hidden = true; canvas.style.display = ""; }
function showSceneView() { canvas.style.display = "none"; playerRoot.hidden = false; }
function setPast(on) { canvas.classList.toggle("past", on); playerRoot.classList.toggle("past", on); }

function paint(html) {
  canvas.classList.remove("paint", "grid");
  canvas.style.removeProperty("--cols");
  canvas.innerHTML = html;
  void canvas.offsetWidth;            // restart the rise animation
  canvas.classList.add("paint");
  stage.scrollTop = 0;
}
function showHtml(html) { showHtmlView(); paint(html); }

function playScene(spec) {
  showSceneView();                    // size the container before mounting
  const s = { ...spec, bare: true };  // blend over the page backdrop
  const SS = window.SurfaceScenes;
  if (!SS) return;                    // scenes are an optional island — degrade silently
  if (!scenePlayer) scenePlayer = SS.mount(playerRoot, s, { controls: false });
  else scenePlayer.update(s);
}

function onRender(msg) {
  if (msg.recalled != null) { recallFrame(msg.recalled); return; }
  liveKind = "html"; liveHtml = msg.html; liveSpec = null;
  live = true;
  viewIndex = frames.length - 1;
  showHtml(msg.html); setPast(false);
  buildRail();
}

function onScene(msg) {
  if (msg.recalled != null) { recallFrame(msg.recalled); return; }
  liveKind = "scene"; liveSpec = msg.spec; liveHtml = null;
  live = true;
  viewIndex = frames.length - 1;
  playScene(msg.spec); setPast(false);
  buildRail();
}

// ── Time-travel ─────────────────────────────────────────────────────────
// A frame is shown read-only WITHOUT mutating the live `nodes` Map. "now" =
// renderLive() from the live store. A new prompt always returns to now first.
async function fetchHistory() {
  const sid = getSession(); if (!sid) return;
  try {
    const r = await fetch(`/api/history?session=${encodeURIComponent(sid)}`);
    if (!r.ok) return;
    const data = await r.json();
    frames = Array.isArray(data) ? data : (Array.isArray(data.frames) ? data.frames : []);
    if (atNow()) viewIndex = frames.length - 1;
    paintCurrent(); buildRail();
  } catch { /* offline / no history yet */ }
}

// Render a committed frame read-only. Retained frames carry a `snapshot`
// {components, layout}; escape-hatch frames carry `html` or `spec`.
function renderSnapshot(frame) {
  if (!frame) return;
  if (frame.spec) { playScene(frame.spec); return; }
  if (frame.html != null && !frame.snapshot) { showHtml(frame.html); return; }
  const snap = frame.snapshot || {};
  const comps = Array.isArray(snap.components) ? snap.components : [];
  showHtmlView();
  canvas.classList.remove("paint");
  canvas.textContent = "";
  canvas.classList.add("grid");
  const cols = snap.layout && snap.layout.columns;
  canvas.style.setProperty("--cols", String(cols != null ? cols : (layoutSpec.columns ?? 4)));
  for (const c of comps) {
    if (!c || !c.component) continue;
    const el = renderComponent(c.component, c.props);
    if (c.id) el.dataset.id = c.id;
    canvas.appendChild(el);          // NB: does NOT touch the live `nodes` Map
  }
  void canvas.offsetWidth;
  canvas.classList.add("paint");
  stage.scrollTop = 0;
}

function paintCurrent() {
  if (!atNow()) { renderSnapshot(frames[viewIndex]); setPast(true); }
  else { renderLive(); setPast(false); }
}

function gotoFrame(i) {
  if (!frames.length) return;
  viewIndex = Math.max(0, Math.min(i, frames.length - 1));
  live = viewIndex >= frames.length - 1;     // scrubbing to the last tick === live
  paintCurrent(); buildRail();
}
function returnToNow() { live = true; viewIndex = frames.length - 1; paintCurrent(); buildRail(); }

// Agent-driven recall — re-surface a past frame verbatim (read-only look-back).
function recallFrame(n) {
  const idx = frames.findIndex((f) => f.n === n);
  if (idx >= 0) { viewIndex = idx; live = idx >= frames.length - 1; paintCurrent(); buildRail(); }
}

function shortPrompt(s) { s = String(s); return s.length > 60 ? s.slice(0, 57) + "…" : s; }

// ── Time ruler ──────────────────────────────────────────────────────────
function frameTs(f) { return new Date(f.ts).getTime(); }
function seekWindow() {
  const now = Date.now();
  const oldest = frames.length ? frameTs(frames[0]) : now;
  const span = Math.max(SEEK_SPAN_MIN, now - oldest);   // ≥1h, grows to fit
  return { now, span, start: now - span };
}
function seekPctTs(ts, win) { return Math.max(0, Math.min(100, ((ts - win.start) / win.span) * 100)); }
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h${rm}m` : `${h}h`;
}

// Render the video-style scrubber inside the dock. Appears at ≥2 turns.
// Checkpoints sit at their real timestamp on the time window.
function buildRail() {
  if (frames.length < 2) { seekEl.hidden = true; return; }
  seekEl.hidden = false;
  if (seekTrack.dataset.count !== String(frames.length)) {
    seekTrack.querySelectorAll(".seek-tick").forEach((t) => t.remove());
    frames.forEach((f) => {
      const tk = document.createElement("div");
      tk.className = "seek-tick";
      tk.title = shortPrompt(f.prompt);
      seekTrack.insertBefore(tk, seekThumb);
    });
    seekTrack.dataset.count = String(frames.length);
  }
  const win = seekWindow();
  const ticks = seekTrack.querySelectorAll(".seek-tick");
  frames.forEach((f, i) => { if (ticks[i]) ticks[i].style.left = seekPctTs(frameTs(f), win) + "%"; });
  const now = atNow();
  const cur = now ? frames.length - 1 : viewIndex;
  const p = now ? 100 : seekPctTs(frameTs(frames[cur]), win);
  seekFill.style.width = p + "%";
  seekThumb.style.left = p + "%";
  seekSpan.textContent = fmtDur(win.span);
  seekNow.textContent = now ? "now" : `${fmtDur(win.now - frameTs(frames[cur]))} ago`;
  seekNow.classList.toggle("live", now);
}

// Map a pointer x on the track → time → nearest checkpoint (snaps to a turn).
function frameFromClientX(x) {
  const r = seekTrack.getBoundingClientRect();
  const ratio = r.width ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0;
  const win = seekWindow();
  const t = win.start + ratio * win.span;
  let best = 0, bestD = Infinity;
  frames.forEach((f, i) => { const d = Math.abs(frameTs(f) - t); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

// ── Status pill ──────────────────────────────────────────────────────────
function setStatus(state, text) {
  if (state === "working") { statusLabel.textContent = text || "working"; statusEl.hidden = false; }
  else { statusEl.hidden = true; fadeToolFeed(); }   // turn done → let the feed dissolve
}

// ── Streaming tool-call feed (bottom-left) ─────────────────────────────────
// Each tool the runtime invokes this turn streams in as a glass row, keyed by
// tool id, capped, dissolving when the turn ends.
const toolRows = new Map();        // tool id → row element
const TOOL_FEED_MAX = 4;
let toolFeedTimer = null;

function onToolCall({ id, name, input }) {
  if (!id) return;
  if (toolFeedTimer) { clearTimeout(toolFeedTimer); toolFeedTimer = null; }
  toolfeed.classList.remove("fading");
  toolfeed.hidden = false;
  let row = toolRows.get(id);
  if (!row) {
    row = document.createElement("div");
    row.className = "tf-row";
    row.innerHTML = `<span class="tf-dot"></span><span class="tf-name"></span><span class="tf-arg"></span>`;
    toolfeed.appendChild(row);
    toolRows.set(id, row);
    while (toolfeed.children.length > TOOL_FEED_MAX) {           // drop the oldest
      const old = toolfeed.firstElementChild;
      for (const [k, v] of toolRows) if (v === old) toolRows.delete(k);
      old.remove();
    }
    requestAnimationFrame(() => row.classList.add("in"));
  }
  row.querySelector(".tf-name").textContent = toolLabel(name);
  const arg = toolArg(input);
  const argEl = row.querySelector(".tf-arg");
  argEl.textContent = arg;
  argEl.hidden = !arg;
}

// Honest tool names — a developer-facing activity stream, not the calm pill.
function toolLabel(name) { return String(name || "").replace(/^mcp__[a-z0-9_]+__/, ""); }

// A short, human target for the call: the file, command, query, etc.
function toolArg(input) {
  if (!input || typeof input !== "object") return "";
  if (typeof input.html === "string") return "canvas";          // render() — never dump html
  if (Array.isArray(input.ops)) return "canvas";                // patch
  for (const k of ["file_path", "path", "command", "pattern", "query", "url", "question", "description"]) {
    let v = input[k];
    if (typeof v !== "string" || !v) continue;
    if (k === "file_path" || k === "path") v = v.split("/").slice(-2).join("/");
    v = v.replace(/\s+/g, " ").trim();
    return v.length > 46 ? v.slice(0, 44) + "…" : v;
  }
  return "";
}

function resetToolFeed() {
  if (toolFeedTimer) { clearTimeout(toolFeedTimer); toolFeedTimer = null; }
  toolRows.clear(); toolfeed.innerHTML = "";
  toolfeed.classList.remove("fading"); toolfeed.hidden = true;
}
function fadeToolFeed() {
  if (toolfeed.hidden || !toolfeed.children.length) return;
  toolfeed.classList.add("fading");
  toolFeedTimer = setTimeout(resetToolFeed, 600);
}

// ── Context meter (bottom-right) — model · tokens · context fill · % ────────
function setMeter(u) {
  meter.hidden = false;
  if (u.model) meter.querySelector(".mt-model").textContent = prettyModel(u.model);
  const pct = Math.max(0, Math.min(100, Number(u.pct) || 0));
  meter.querySelector(".mt-pct").textContent = pct + "%";
  meter.querySelector(".mt-fill").style.width = pct + "%";
  meter.classList.toggle("warn", pct >= 75 && pct < 90);
  meter.classList.toggle("bad", pct >= 90);
  meter.querySelector(".mt-tokens").textContent = `${fmtTokens(u.contextUsed)} / ${fmtTokens(u.contextWindow)}`;
  meter.title = `${prettyModel(u.model)} · ${Number(u.contextUsed).toLocaleString()} of ${Number(u.contextWindow).toLocaleString()} context tokens (${pct}%)`;
}
function prettyModel(m) {
  return String(m || "").replace(/^claude-/, "").replace(/-20\d{6}$/, "") || "model";
}
function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(n);
}

// ── Dock + mode ─────────────────────────────────────────────────────────
function setDockEnabled(on) { sendBtn.disabled = !on; promptEl.disabled = !on; }
function autoGrow() { promptEl.style.height = "auto"; promptEl.style.height = Math.min(promptEl.scrollHeight, 160) + "px"; }

function showGate(hello) {
  gate.hidden = false;
  setDockEnabled(false);
}
// Lock the connection's working mode. visitor = view-only (generation off): the
// dock stays disabled so no prompts can be sent.
function lockMode(mode) {
  currentMode = mode;
  modeLocked = true;
  setModeLS(mode);
  gate.hidden = true;
  send({ type: "mode", mode });
  setModeChip(mode);
  const canSpeak = mode !== "visitor";
  setDockEnabled(canSpeak);
  promptEl.placeholder = canSpeak ? "Speak to Surface…" : "View only — generation is off";
  if (canSpeak) promptEl.focus();
}

function submitPrompt() {
  const text = promptEl.value.trim();
  if (!text || !modeLocked || currentMode === "visitor") return;
  if (!atNow()) returnToNow();          // a new turn always continues from now
  resetToolFeed();                      // clear last turn's stream
  send({ type: "prompt", text });
  promptEl.value = ""; autoGrow(); setStatus("working");
}

// ── Cards ──────────────────────────────────────────────────────────────
function removeCard(id) { const el = cardsEl.querySelector(`[data-rid="${cssEsc(id)}"]`); if (el) el.remove(); }
function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

function showPermission({ id, tool, input }) {
  if (cardsEl.querySelector(`[data-rid="${cssEsc(id)}"]`)) return;
  const card = document.createElement("div");
  card.className = "card"; card.dataset.rid = id;
  card.innerHTML = `
    <div class="eyebrow">Permission</div>
    <h3>Allow ${escapeHtml(toolLabel(tool))}?</h3>
    <div class="mono">${escapeHtml(summarizeInput(input))}</div>
    <div class="row">
      <button class="btn primary" data-act="allow">Approve</button>
      <button class="btn ghost" data-act="deny">Deny</button>
    </div>`;
  card.querySelector('[data-act="allow"]').onclick = () => { send({ type: "decision", id, decision: "allow" }); card.remove(); };
  card.querySelector('[data-act="deny"]').onclick  = () => { send({ type: "decision", id, decision: "deny" }); card.remove(); };
  cardsEl.appendChild(card);
}

function summarizeInput(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  for (const k of ["command", "file_path", "path", "url", "pattern", "query"]) {
    if (typeof input[k] === "string") return input[k];
  }
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

function showAsk({ id, question, context, options }) {
  if (cardsEl.querySelector(`[data-rid="${cssEsc(id)}"]`)) return;
  const card = document.createElement("div");
  card.className = "card"; card.dataset.rid = id;
  const head = `
    <div class="eyebrow">Decision</div>
    <h3>${escapeHtml(question)}</h3>
    ${context ? `<p class="sub">${escapeHtml(context)}</p>` : ""}`;
  const buttons = [], fields = [];
  (options || []).forEach((opt, i) => {
    if (opt.freeText) fields.push(`<div class="field"><input type="text" data-i="${i}" placeholder="${escapeHtml(opt.label)}"><button class="btn primary" data-submit="${i}">→</button></div>`);
    else buttons.push(`<button class="btn ${i === 0 ? "primary" : ""}" data-i="${i}">${escapeHtml(opt.label)}</button>`);
  });
  card.innerHTML = head + (buttons.length ? `<div class="row">${buttons.join("")}</div>` : "") + fields.join("");

  card.querySelectorAll("button[data-i]").forEach((b) => {
    b.onclick = () => { const o = options[+b.dataset.i]; send({ type: "answer", id, label: o.label, value: o.value }); card.remove(); };
  });
  card.querySelectorAll("button[data-submit]").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.submit; const o = options[i];
      const val = card.querySelector(`input[data-i="${i}"]`).value.trim();
      if (!val) return;
      const value = String(o.value).includes("{user_input}") ? String(o.value).replaceAll("{user_input}", val) : val;
      send({ type: "answer", id, label: o.label, value });
      card.remove();
    };
  });
  cardsEl.appendChild(card);
}

// ── Toast ────────────────────────────────────────────────────────────────
function toast(text) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = text;
  toastEl.appendChild(t); setTimeout(() => t.remove(), 6000);
}
function firstLine(s) { return String(s).split("\n").find((l) => l.trim()) || s; }

function setConnected(on) { /* reserved for a future connection dot */ }

// ── Chips (top-right) ───────────────────────────────────────────────────────
function setSessionChip(id) {
  if (!id) return;
  sessionChip.querySelector(".sc-id").textContent = String(id).slice(0, 8);
  sessionChip.title = `Session ${id} — tap to copy`;
  sessionChip.hidden = false;
}
function setModeChip(mode) {
  if (!mode) return;
  modeChip.querySelector(".sc-id").textContent = mode;
  modeChip.hidden = false;
}

// ── Drawing overlay ─────────────────────────────────────────────────────
const dctx = drawCanvas.getContext("2d");
const DRAW_COLOR = "#cdfb45", DRAW_W = 3;
let drawing = false;        // draw mode on/off
let drawStroke = null;      // stroke in progress
let strokes = [];           // [{ pts: [{x,y}, …] }] in viewport CSS px

function sizeDrawCanvas() {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  drawCanvas.width = window.innerWidth * scale;
  drawCanvas.height = window.innerHeight * scale;
  dctx.setTransform(scale, 0, 0, scale, 0, 0);
  redrawStrokes();
}
function redrawStrokes() {
  dctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  dctx.strokeStyle = DRAW_COLOR; dctx.lineWidth = DRAW_W; dctx.lineCap = "round"; dctx.lineJoin = "round";
  dctx.shadowColor = "rgba(205,251,69,0.5)"; dctx.shadowBlur = 6;
  for (const st of strokes) strokePath(dctx, st);
  dctx.shadowBlur = 0;
}
function strokePath(c, st) {
  const p = st.pts; if (!p.length) return;
  c.beginPath(); c.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y);
  if (p.length === 1) c.lineTo(p[0].x + 0.1, p[0].y + 0.1);
  c.stroke();
}
function setDrawMode(on) {
  drawing = on;
  document.body.classList.toggle("drawing", on);
  drawToggle.classList.toggle("active", on);
  drawClear.hidden = !(on && strokes.length);
}
function onDrawChange() {
  drawClear.hidden = !(drawing && strokes.length);
  try { localStorage.setItem(LS_DRAW, JSON.stringify(strokes)); } catch {}
  send({ type: "event", name: "drawing-state", data: { present: strokes.length > 0 } });
}
function clearDrawing() { strokes = []; redrawStrokes(); onDrawChange(); }
function loadStrokes() {
  try { const s = JSON.parse(localStorage.getItem(LS_DRAW) || "[]"); if (Array.isArray(s)) strokes = s; } catch {}
}

drawCanvas.addEventListener("pointerdown", (e) => {
  if (!drawing) return;
  drawStroke = { pts: [{ x: e.clientX, y: e.clientY }] };
  strokes.push(drawStroke);
  try { drawCanvas.setPointerCapture(e.pointerId); } catch {}
});
drawCanvas.addEventListener("pointermove", (e) => {
  if (!drawing || !drawStroke) return;
  drawStroke.pts.push({ x: e.clientX, y: e.clientY });
  redrawStrokes();
});
function endStroke() { if (drawStroke) { drawStroke = null; onDrawChange(); } }
drawCanvas.addEventListener("pointerup", endStroke);
drawCanvas.addEventListener("pointercancel", endStroke);

// ── Screenshot — composite the canvas + the user's strokes into a PNG ─────
function handleCaptureRequest(msg) {
  let dataUrl = null, annotated = [];
  const had = strokes.length > 0;
  try { dataUrl = captureComposite(); annotated = annotatedTiles(); } catch { /* tainted/failed */ }
  send({ type: "event", name: "capture", data: { id: msg.id, dataUrl, annotated, hasDrawing: had } });
  // The agent has the drawing now — clear it from the screen (also resets the
  // server's drawing-present flag via clearDrawing → drawing-state). Confirms receipt.
  if (had && dataUrl) clearDrawing();
}
function captureComposite() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const oc = document.createElement("canvas");
  oc.width = vw * scale; oc.height = vh * scale;
  const c = oc.getContext("2d"); c.scale(scale, scale);
  c.fillStyle = "#0e0f14"; c.fillRect(0, 0, vw, vh);
  canvas.querySelectorAll("[data-id], .tile").forEach((t) => {
    const r = t.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    roundRect(c, r.left, r.top, r.width, r.height, 16);
    c.fillStyle = "rgba(255,255,255,0.06)"; c.fill();
    c.lineWidth = 1; c.strokeStyle = "rgba(255,255,255,0.18)"; c.stroke();
    drawTileText(c, tileInfo(t), r);
  });
  c.strokeStyle = DRAW_COLOR; c.lineWidth = DRAW_W; c.lineCap = "round"; c.lineJoin = "round";
  for (const st of strokes) strokePath(c, st);
  return oc.toDataURL("image/png");
}
function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function drawTileText(c, info, r) {
  const pad = 18, x = r.left + pad, maxW = r.width - pad * 2; let y = r.top + pad;
  c.textBaseline = "top";
  const label = info.label, value = info.value, body = info.body;
  if (label) { c.fillStyle = "rgba(246,246,248,0.5)"; c.font = "700 10px -apple-system, system-ui, sans-serif"; c.fillText(label.toUpperCase().slice(0, 30), x, y); y += 18; }
  if (value) { c.fillStyle = "#f6f6f8"; c.font = "700 22px -apple-system, system-ui, sans-serif"; y = wrapText(c, value, x, y, maxW, 26, 2); }
  if (body) { c.fillStyle = "rgba(246,246,248,0.62)"; c.font = "13px -apple-system, system-ui, sans-serif"; wrapText(c, body, x, y + 2, maxW, 17, 4); }
}
function wrapText(c, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/); let line = "", n = 0;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (c.measureText(test).width > maxW && line) {
      c.fillText(line, x, y); y += lh; n++; line = w;
      if (n >= maxLines) { c.fillText("…", x, y); return y + lh; }
    } else line = test;
  }
  if (line && n < maxLines) { c.fillText(line, x, y); y += lh; }
  return y;
}
function annotatedTiles() {
  const out = [];
  canvas.querySelectorAll("[data-id], .tile").forEach((t) => {
    const r = t.getBoundingClientRect();
    const hit = strokes.some((st) => st.pts.some((p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom));
    if (hit) {
      const info = tileInfo(t);
      out.push([info.label, info.value].filter(Boolean).join(": ") || "a tile");
    }
  });
  return out;
}

// ── Boot ───────────────────────────────────────────────────────────────
promptEl.addEventListener("input", autoGrow);
promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPrompt(); } });
sendBtn.addEventListener("click", submitPrompt);

// Components (e.g. org-chart nodes) can request a turn by dispatching a composed
// CustomEvent("surface:prompt", { detail: { text } }) — the "talk to this" gesture.
// Composed events cross the shadow boundary + bubble to document.
document.addEventListener("surface:prompt", (e) => {
  const text = e.detail && typeof e.detail.text === "string" ? e.detail.text.trim() : "";
  if (!text || !modeLocked || currentMode === "visitor") return;
  if (!atNow()) returnToNow();
  resetToolFeed();
  send({ type: "prompt", text });
  setStatus("working");
});
gate.querySelectorAll("button[data-mode]").forEach((b) => { b.onclick = () => lockMode(b.dataset.mode); });

// Seek-bar scrubbing — drag the thumb / click the track to travel in time;
// the far-right edge is "now". Snaps to the nearest turn.
let seekDragging = false;
seekTrack.addEventListener("pointerdown", (e) => {
  if (frames.length < 2) return;
  seekDragging = true;
  try { seekTrack.setPointerCapture(e.pointerId); } catch {}
  gotoFrame(frameFromClientX(e.clientX));
});
seekTrack.addEventListener("pointermove", (e) => { if (seekDragging) gotoFrame(frameFromClientX(e.clientX)); });
seekTrack.addEventListener("pointerup", () => { seekDragging = false; });
seekTrack.addEventListener("pointercancel", () => { seekDragging = false; });
seekNow.addEventListener("click", () => { if (!atNow()) returnToNow(); });

sessionChip.addEventListener("click", () => {
  const id = getSession(); if (!id) return;
  navigator.clipboard?.writeText(id).then(() => toast("Session id copied"), () => {});
});

// New session — drop the stored id so the next turn starts the runtime WITHOUT
// resume → a fresh session. A reload is the clean reset: boot finds no id.
newSessionBtn.addEventListener("click", () => {
  localStorage.removeItem(LS_SESSION);
  toast("Starting a fresh session…");
  setTimeout(() => location.reload(), 250);
});

drawToggle.addEventListener("click", () => setDrawMode(!drawing));
drawClear.addEventListener("click", clearDrawing);

window.addEventListener("resize", () => { sizeDrawCanvas(); buildRail(); });
setInterval(() => { if (!seekEl.hidden && !seekDragging) buildRail(); }, 30000);  // checkpoints drift left as time passes

setDockEnabled(false);
setSessionChip(getSession());   // restore the chip for a returning session
loadStrokes();
sizeDrawCanvas();               // restore any per-session drawing
connect();
fetchHistory();                 // restore the filmstrip for a returning session
