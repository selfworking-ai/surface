// <surface-status> — a value plus a toned pill (good/warn/bad). The tint is
// derived from the signal token via color-mix (token-only — no literal rgba).
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceStatus extends SurfaceComponent {
  static manifest = {
    name: "status", version: "1.0.0",
    props: { label: { type: "string" }, value: { type: "string" }, tone: { type: "string" }, status: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  static styles = `
    .pill { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
      padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--glass-strong); border: 1px solid var(--hairline-soft); color: var(--ink); }
    .pill.good { background: color-mix(in srgb, var(--good) 16%, transparent); border-color: color-mix(in srgb, var(--good) 40%, transparent); color: var(--good); }
    .pill.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); border-color: color-mix(in srgb, var(--warn) 40%, transparent); color: var(--warn); }
    .pill.bad  { background: color-mix(in srgb, var(--bad) 16%, transparent);  border-color: color-mix(in srgb, var(--bad) 40%, transparent);  color: var(--bad); }
  `;
  static template(p, esc) {
    const tone = ["good", "warn", "bad"].includes(p.tone) ? " " + p.tone : "";
    const pillText = p.status ?? p.tone ?? p.value ?? "";
    const value = p.value != null ? `<div class="value">${esc(p.value)}</div>` : "";
    return `<div class="label">${esc(p.label)}</div>${value}<span class="pill${tone}">${esc(pillText)}</span>`;
  }
}

export const manifest = defineComponent("surface-status", SurfaceStatus);
export default SurfaceStatus;
