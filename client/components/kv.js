// <surface-kv> — a label + key/value rows (from a [{k,v}] array or an object).
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceKv extends SurfaceComponent {
  static manifest = {
    name: "kv", version: "1.0.0",
    props: { label: { type: "string" }, pairs: { type: "array" }, size: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `
    .kv { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--hairline-soft); }
    .kv:last-child { border-bottom: 0; }
    .kv .k { color: var(--muted); }
    .kv .v { font-weight: 600; text-align: right; }
  `;
  static template(p, esc) {
    let pairs = [];
    if (Array.isArray(p.pairs)) pairs = p.pairs.map((x) => [String(x?.k ?? ""), String(x?.v ?? "")]);
    else if (p.pairs && typeof p.pairs === "object") pairs = Object.entries(p.pairs).map(([k, v]) => [String(k), String(v)]);
    const rows = pairs.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
    return `<div class="label">${esc(p.label)}</div>${rows}`;
  }
}

export const manifest = defineComponent("surface-kv", SurfaceKv);
export default SurfaceKv;
