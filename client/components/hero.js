// <surface-hero> — the full-width headline tile (the turn's key answer).
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceHero extends SurfaceComponent {
  static manifest = {
    name: "hero", version: "1.0.0",
    props: { label: { type: "string" }, value: { type: "string" }, body: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `
    :host { grid-column: 1 / -1; background: var(--glass-strong); border-color: var(--hairline); box-shadow: var(--shadow); }
    .value { font-size: clamp(32px, 4vw, 56px); }
  `;
  static template(p, esc) {
    const body = p.body != null ? `<p>${esc(p.body)}</p>` : "";
    return `<div class="label">${esc(p.label)}</div><div class="value">${esc(p.value)}</div>${body}`;
  }
}

export const manifest = defineComponent("surface-hero", SurfaceHero);
export default SurfaceHero;
