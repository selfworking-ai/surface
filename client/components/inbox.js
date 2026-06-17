// <surface-inbox> — a glanceable agent inbox from an `agent.inbox` PROJECTION
// ({ agent, messages:[{from, text}] }). Generic renderer, like org-graph: the
// kernel relays the projection unchanged and mounts this by the namespace→component
// map, so a Tier-A runtime's live inbox shows up with no bespoke UI. The header
// reads "Inbox · <agent>"; each row is a sender (accented) + the message text.
import { SurfaceComponent, defineComponent } from "./base.js";

class SurfaceInbox extends SurfaceComponent {
  static manifest = {
    name: "inbox", version: "1.0.0",
    props: { agent: { type: "string" }, messages: { type: "array" }, size: { type: "string" } },
    capabilities: ["render"], tokensOnly: true,
  };
  // Token-only: rows sit on a faint hairline divider; the sender is accent-toned.
  static styles = `
    :host { gap: 10px; }
    .msgs { display: flex; flex-direction: column; margin-top: 2px; }
    .msg { display: flex; flex-direction: column; gap: 2px; padding: 9px 0; border-bottom: 1px solid var(--hairline-soft); }
    .msg:last-child { border-bottom: 0; }
    .from { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--accent); }
    .from.you { color: var(--muted); }
    .text { color: var(--ink); line-height: 1.4; }
    .empty { color: var(--muted); }
  `;
  static template(p, esc) {
    const agent = p.agent != null ? String(p.agent) : "";
    const label = agent ? `Inbox · ${esc(agent)}` : "Inbox";
    const messages = Array.isArray(p.messages) ? p.messages : [];
    if (!messages.length) {
      return `<div class="label">${label}</div><p class="empty">No messages.</p>`;
    }
    const rows = messages.map((m) => {
      const from = m && typeof m === "object" ? String(m.from ?? "") : "";
      const text = m && typeof m === "object" ? String(m.text ?? "") : String(m);
      const youCls = from.toLowerCase() === "you" ? " you" : "";
      const fromEl = from ? `<span class="from${youCls}">${esc(from)}</span>` : "";
      return `<div class="msg">${fromEl}<span class="text">${esc(text)}</span></div>`;
    }).join("");
    return `<div class="label">${label}</div><div class="msgs">${rows}</div>`;
  }
}

export const manifest = defineComponent("surface-inbox", SurfaceInbox);
export default SurfaceInbox;
