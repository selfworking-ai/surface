// <surface-org-graph> — a glanceable org chart from a runtime's `org.graph`
// PROJECTION ({ nodes:[{id, role, reportsTo, status}] }). It is a GENERIC renderer:
// the kernel relays the projection unchanged and the client mounts this by the
// namespace→component map, so ANY Tier-A runtime lights up an org chart with no
// bespoke UI. Structure is conveyed by tiering each node under its parent (no SVG,
// no edges) — calm and indented. Every node is TAPPABLE: a tap (or Enter) is the
// "talk to this node" gesture — it dispatches the composed `surface:prompt`
// CustomEvent the kernel turns into a `{type:"prompt", text:"talk to <id>"}` turn.
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceOrgGraph extends SurfaceComponent {
  static manifest = {
    name: "org-graph", version: "1.0.0",
    props: { nodes: { type: "array" }, label: { type: "string" }, size: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  // Token-only: the row tint + hover use --glass / color-mix over signal tokens;
  // the status dot is a 50% circle toned good/muted. No literal colors or radii.
  static styles = `
    :host { gap: 10px; }
    .tree { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
    .node { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box;
      padding: 9px 12px; text-align: left; cursor: pointer; color: var(--ink);
      background: var(--glass); border: 1px solid var(--hairline-soft);
      border-radius: var(--r-inner); font: inherit; transition: background 120ms ease, border-color 120ms ease; }
    .node:hover, .node:focus-visible { background: color-mix(in srgb, var(--accent) 12%, var(--glass));
      border-color: color-mix(in srgb, var(--accent) 36%, transparent); outline: none; }
    .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
    .dot.good { background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 22%, transparent); }
    .dot.warn { background: var(--warn); }
    .meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .role { font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .id { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .reports { margin-left: auto; flex: none; font-size: 11px; color: var(--faint); }
    .empty { color: var(--muted); }
  `;

  // Tone the status dot: active reads "good", idle reads muted, anything else warns.
  static _tone(status) {
    const s = String(status || "").toLowerCase();
    if (s === "active" || s === "online" || s === "running") return "good";
    if (s === "idle" || s === "paused" || s === "" ) return "";
    return "warn";
  }

  static template(p, esc) {
    const nodes = Array.isArray(p.nodes) ? p.nodes.filter((n) => n && typeof n === "object" && n.id != null) : [];
    const label = p.label != null ? String(p.label) : "Org chart";
    if (!nodes.length) {
      return `<div class="label">${esc(label)}</div><p class="empty">No nodes.</p>`;
    }

    // Index children by parent, then walk from the root(s) depth-first so the order
    // is tiered. A node whose reportsTo is null/absent (or points nowhere) is a root.
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    const children = new Map();
    const roots = [];
    for (const n of nodes) {
      const parent = n.reportsTo != null ? String(n.reportsTo) : null;
      if (parent && byId.has(parent)) {
        (children.get(parent) || children.set(parent, []).get(parent)).push(n);
      } else {
        roots.push(n);
      }
    }

    const rows = [];
    const seen = new Set();
    const walk = (n, depth) => {
      const id = String(n.id);
      if (seen.has(id)) return;          // guard against a cycle in untrusted data
      seen.add(id);
      const tone = SurfaceOrgGraph._tone(n.status);
      const dotCls = tone ? " " + tone : "";
      const indent = depth > 0 ? ` style="margin-left:${Math.min(depth, 4) * 18}px"` : "";
      const parent = n.reportsTo != null ? String(n.reportsTo) : "";
      const parentNode = parent ? byId.get(parent) : null;
      const reports = parentNode ? `<span class="reports">↳ ${esc(parentNode.role ?? parentNode.id)}</span>` : "";
      const statusTitle = n.status != null ? ` · ${esc(n.status)}` : "";
      rows.push(
        `<button type="button" class="node" data-id="${esc(id)}"${indent} title="Talk to ${esc(id)}${statusTitle}">`
        + `<span class="dot${dotCls}"></span>`
        + `<span class="meta"><span class="role">${esc(n.role ?? id)}</span><span class="id">${esc(id)}</span></span>`
        + reports
        + `</button>`
      );
      for (const c of children.get(id) || []) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    // Any node not reached from a root (orphaned parent ref) still gets shown flat.
    for (const n of nodes) if (!seen.has(String(n.id))) walk(n, 0);

    return `<div class="label">${esc(label)}</div><div class="tree">${rows.join("")}</div>`;
  }

  // The talk-to-any-node gesture. Delegated on the host so it survives every
  // content re-render (the base only rewrites the inner .content on a prop set).
  connectedCallback() {
    super.connectedCallback();
    if (this._wired) return;
    this._wired = true;
    this.shadowRoot.addEventListener("click", (e) => {
      const btn = e.target.closest(".node");
      if (btn) this._talkTo(btn.dataset.id);
    });
  }

  _talkTo(id) {
    if (!id) return;
    this.dispatchEvent(new CustomEvent("surface:prompt", {
      detail: { text: "talk to " + id },
      bubbles: true, composed: true,        // composed crosses the shadow boundary
    }));
  }
}

export const manifest = defineComponent("surface-org-graph", SurfaceOrgGraph);
export default SurfaceOrgGraph;
