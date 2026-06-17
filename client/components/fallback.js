// <surface-fallback> — renders any UNKNOWN component name as its name + a props
// dump, so a mount of something unregistered is never silently invisible.
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceFallback extends SurfaceComponent {
  static manifest = { name: "fallback", version: "1.0.0", props: {}, capabilities: ["render"], tokensOnly: true };
  static styles = `
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
      color: var(--muted); white-space: pre-wrap; word-break: break-word; }
  `;
  static template(p, esc) {
    let dump;
    try { dump = JSON.stringify(p.__props ?? {}); } catch { dump = String(p.__props); }
    return `<div class="label">${esc(p.__name || "component")}</div><p class="mono">${esc(dump)}</p>`;
  }
}

export const manifest = defineComponent("surface-fallback", SurfaceFallback);
export default SurfaceFallback;
