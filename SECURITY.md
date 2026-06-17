# Security Policy

Surface runs a console that can drive an agent CLI with real file, shell, and network
access. Its security posture is therefore part of the architecture, not an afterthought —
the gotchas in [`CLAUDE.md`](CLAUDE.md) are baked in as **tested invariants**. The full
treatment is in [`docs/security-model.md`](docs/security-model.md); this file is the
summary plus the disclosure process.

## Threat model (summary)

- **Loopback bind.** The server binds `127.0.0.1` only. It is never public by default; a
  remote host cannot reach the WS hub without an explicit, deliberate reverse proxy in
  front of it.
- **WS origin allowlist + real-403 handshake.** WebSocket upgrades are intercepted on the
  `upgrade` event (`{ noServer: true }`) and rejected with a genuine `403` unless the
  `Origin` is on the allowlist (`http://localhost:<port>` / `http://127.0.0.1:<port>`, plus
  same-origin / no-Origin). This is enforced at the handshake, not via `verifyClient`,
  because `verifyClient` cannot return a proper HTTP status. Any other localhost page is
  thereby prevented from driving the kernel.
- **The locked dock is the single trusted input.** All agent instructions enter through one
  channel — the prompt dock — which users cannot move, restyle, or replace. Locking it is
  what makes a visitor-facing (untrusted) surface safe: untrusted viewers get a curated
  surface, not a syscall interface.
- **Visitor mode is a hard lockdown.** In `visitor` mode, component **generation is OFF**
  and **tool access is NONE** — visitors interact only with a curated, pre-installed pack.
  The capability grant rule is `component.capabilities ⊆ mode.grantable ⊆ principal.ceiling`.
- **No Anthropic API keys.** Surface plumbs no model keys. Authentication to the model runs
  through the user's local agent-CLI credentials, inherited by the adapter. There is no key
  material for Surface to leak.
- **Principal attribution → audit.** Surface authenticates the human principal and sets the
  authority ceiling; the runtime attenuates within its own agent tree. Every runtime action
  carries Surface's principal token to an `AuditSink`, so actions are attributable. (Auth /
  identity / audit providers land in M4; the ports are defined now so they target a stable
  contract.)
- **Headless turns never silently hang.** Permission and decision prompts are routed
  through `ask` glass cards in the page (the kernel is the permission-prompt surface) and
  adapter `stderr` is surfaced to the UI — a sensitive operation blocks visibly on a tap
  instead of stalling a headless subprocess forever.

### Trust boundary

The **kernel** (locked dock, canvas runtime, protocol, transport, identity/permission
boundary, providers behind ports) is privileged and always present. **Userspace**
(components, layout, data bindings, packs) is mutable and low-trust — agent-authorable at
runtime, sandboxed, and unable to touch trust, persistence, or transport. Providers
(auth/identity/storage/audit/transport/connectors) live behind kernel ports: the agent may
*configure* a pre-vetted provider through an operator-gated flow, but never *authors* one.

## Supported versions

Surface is pre-1.0 and ships in milestones. Security fixes target the latest published
minor on the `0.x` line.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately to **security@selfworking.ai** (placeholder contact — update before
public launch). Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof-of-concept if possible),
- affected version(s) and environment,
- any suggested remediation.

You can expect an acknowledgement within **3 business days** and a status update within
**10 business days**. We follow coordinated disclosure: we will agree on a disclosure
timeline with you, credit you in the release notes unless you prefer to remain anonymous,
and ask that you give us reasonable time to ship a fix before any public disclosure.

Out of scope: reports that require a non-default deployment that deliberately removes the
loopback bind or origin allowlist without compensating controls, and findings against the
optional build islands' dev-only dependencies.
