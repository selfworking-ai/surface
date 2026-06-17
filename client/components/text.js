// <surface-text> — an optional label + a paragraph of prose.
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceText extends SurfaceComponent {
  static manifest = {
    name: "text", version: "1.0.0",
    props: { label: { type: "string" }, text: { type: "string" }, body: { type: "string" }, size: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `p { font-size: 15px; line-height: 1.5; }`;
  static template(p, esc) {
    const label = p.label != null ? `<div class="label">${esc(p.label)}</div>` : "";
    return `${label}<p>${esc(p.text ?? p.body ?? "")}</p>`;
  }
}

export const manifest = defineComponent("surface-text", SurfaceText);
export default SurfaceText;
