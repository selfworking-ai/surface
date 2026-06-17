// <surface-list> — a label + a bulleted list of items (strings or {text}).
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceList extends SurfaceComponent {
  static manifest = {
    name: "list", version: "1.0.0",
    props: { label: { type: "string" }, items: { type: "array" }, size: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `
    ul { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    li { position: relative; padding-left: 18px; color: var(--ink); }
    li::before { content: ""; position: absolute; left: 2px; top: 9px; width: 6px; height: 6px;
      border-radius: 50%; background: var(--accent); }
  `;
  static template(p, esc) {
    const items = Array.isArray(p.items) ? p.items : [];
    const lis = items
      .map((it) => (it && typeof it === "object" ? String(it.text ?? "") : String(it)))
      .map((t) => `<li>${esc(t)}</li>`).join("");
    return `<div class="label">${esc(p.label)}</div><ul>${lis}</ul>`;
  }
}

export const manifest = defineComponent("surface-list", SurfaceList);
export default SurfaceList;
