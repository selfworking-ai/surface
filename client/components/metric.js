// <surface-metric> — a single number/answer with an optional toned delta.
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceMetric extends SurfaceComponent {
  static manifest = {
    name: "metric", version: "1.0.0",
    props: { label: { type: "string" }, value: { type: "string" }, delta: { type: "string" }, tone: { type: "string" }, size: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `
    .delta { font-size: 13px; font-weight: 600; color: var(--muted); }
    .delta.good { color: var(--good); }
    .delta.warn { color: var(--warn); }
    .delta.bad  { color: var(--bad); }
  `;
  static template(p, esc) {
    const tone = ["good", "warn", "bad"].includes(p.tone) ? " " + p.tone : "";
    const delta = p.delta != null ? `<div class="delta${tone}">${esc(p.delta)}</div>` : "";
    return `<div class="label">${esc(p.label)}</div><div class="value">${esc(p.value)}</div>${delta}`;
  }
}

export const manifest = defineComponent("surface-metric", SurfaceMetric);
export default SurfaceMetric;
