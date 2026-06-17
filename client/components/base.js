// SurfaceComponent — the base for every design-system primitive. Each primitive
// is a Web Component with its own shadow root (visual + style ISOLATION); the
// :root glass tokens still reach inside because CSS custom properties pierce the
// shadow boundary. The reconciler sets `.props` (a plain object); the element
// renders itself. Styles are injected ONCE; updates only rewrite the content, so
// a prop change never replays the mount animation (retained-mode, not repaint).
//
// Token discipline (M3): a component's `static styles` are checked at definition
// against the token-only validator — a dev-time guard mirroring the registry's
// registration-time enforcement. Compose from tokens, never hardcode.

import { validateTokens } from "./token-validator.mjs";

/** Escape text for safe innerHTML inside the shadow root. */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Shared host styles — every primitive is a glass card and a grid item. Token-only.
// The mount RISE animation lives in the LIGHT DOM (.mounted, added by the reconciler
// on first mount only) so updates don't re-animate.
const BASE_STYLES = `
  :host { display: flex; flex-direction: column; gap: 8px; min-width: 0; overflow: hidden;
    padding: 22px 24px; background: var(--glass);
    -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    border: 1px solid var(--hairline-soft); border-radius: var(--r-tile);
    box-shadow: var(--shadow-soft); }
  :host([size="lg"])   { grid-column: span 2; }
  :host([size="tall"]) { grid-row: span 2; }
  .content { display: contents; }
  .label { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); }
  .value { font-size: clamp(26px, 3vw, 40px); font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }
  p { margin: 0; color: var(--muted); }
`;

export class SurfaceComponent extends HTMLElement {
  constructor() {
    super();
    this._props = {};
    this._rendered = false;
    this.attachShadow({ mode: "open" });
  }

  /** The reconciler sets this on mount + each update; setting it re-renders. */
  set props(p) {
    this._props = p && typeof p === "object" ? p : {};
    this._render();
  }
  get props() { return this._props; }

  connectedCallback() { if (!this._rendered) this._render(); }

  _render() {
    const ctor = this.constructor;
    // Reflect `size` to a host attribute so :host([size]) grid sizing applies.
    if (this._props.size) this.setAttribute("size", String(this._props.size));
    else this.removeAttribute("size");

    if (!this._rendered) {
      this.shadowRoot.innerHTML = `<style>${BASE_STYLES}${ctor.styles || ""}</style><div class="content"></div>`;
      this._content = this.shadowRoot.querySelector(".content");
      this._rendered = true;
    }
    this._content.innerHTML = ctor.template(this._props, esc);
  }
}

/**
 * Define a custom element + return its manifest. Dev-time guard: the component's
 * own styles must be token-only (the registry enforces the same at registration).
 * @param {string} tag e.g. "surface-metric"
 * @param {typeof SurfaceComponent} ctor
 * @returns {object} the component manifest (with `styles` attached for the registry)
 */
export function defineComponent(tag, ctor) {
  const css = String(ctor.styles || "");
  const v = validateTokens(css);
  if (!v.ok) console.error(`[surface] ${tag}: non-token styles rejected`, v.violations);
  if (!customElements.get(tag)) customElements.define(tag, ctor);
  return { ...ctor.manifest, styles: css };
}
