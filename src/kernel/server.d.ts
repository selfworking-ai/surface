/**
 * Surface kernel hub — editor-facing types for `createSurface`. The executable
 * source of truth is `server.mjs`; keep these in lockstep. The hub wires an
 * http+ws server, the retained-mode workspace, the registry + broker, the
 * identity/permission boundary, and the per-turn loop that drives an AgentAdapter.
 */

import type { AgentAdapter, Principal } from "../adapter-sdk/adapter";
import type { StorageProvider, AuditSink, AuthProvider, IdentityProvider, ProviderSet } from "../provider-sdk/ports";
import type { Mode, ServerMsg } from "../protocol/surface-protocol";
import type { PackModule } from "../pack-sdk/pack";

/** Configuration for {@link createSurface}. Only `adapter` is required. */
export interface SurfaceConfig {
  /** REQUIRED. The runtime seam — teaches Surface to drive one agent CLI. */
  adapter: AgentAdapter;
  /** HTTP/WS port. Default: env SURFACE_PORT || PORT || 5757. */
  port?: number;
  /** Bind address. Default "127.0.0.1" (loopback only — G8). */
  host?: string;
  /** Default working mode announced in `hello`. Default "operator". */
  mode?: Mode;
  /** Modes this surface offers. Default ["operator","team","visitor"]. */
  modes?: Mode[];
  /**
   * Privileged provider plane (M4): storage / audit / auth / identity behind kernel
   * ports. Each member is optional; `storage` defaults to a FileStore, `audit` to a
   * noop sink, `auth`/`identity` to null (single-operator). Individual `store`/
   * `audit`/`auth`/`identity` below are back-compat shortcuts for `providers.*`.
   */
  providers?: ProviderSet;
  /** Presentation storage. Default new FileStore({ dir: env.SURFACE_DIR || "./.surface" }). */
  store?: StorageProvider;
  /** Audit sink — records every mutating action against the principal. Default: noop. */
  audit?: AuditSink;
  /** Auth provider (SSO/OIDC) establishing the human principal. Default: null. */
  auth?: AuthProvider;
  /** Identity provider (WebAuthn/passkey). Default: null. */
  identity?: IdentityProvider;
  /** WS origin allowlist. Default [http://localhost:PORT, http://127.0.0.1:PORT]. */
  allowedOrigins?: string[];
  /** Static client directory. Default resolves ../../client from server.mjs. */
  clientDir?: string;
  /** Open the OS browser on listen(). Default env.OPEN_BROWSER !== "0". */
  openBrowser?: boolean;
  /** The authenticated human principal. Default defaultPrincipal() (single operator). */
  principal?: Principal;
  /** Optional pre-built data broker (else the kernel makes one). */
  broker?: import("./broker").Broker;
  /** Optional pre-built component registry (else the kernel makes one). */
  registry?: import("./registry").Registry;
  /** Starter pack (M5): seeds the initial canvas composition on boot. */
  pack?: PackModule;
}

/** A running Surface kernel. */
export interface SurfaceInstance {
  /** The bound host address. */
  readonly host: string;
  /** The bound port. */
  readonly port: number;
  /** The local URL clients open. */
  readonly url: string;
  /** The topic data bus (used by components; lightly used in M1). */
  readonly broker: import("./broker").Broker;
  /** The component catalog the agent composes from. */
  readonly registry: import("./registry").Registry;
  /** The resolved provider plane (storage/audit/auth/identity). */
  readonly providers: { storage: StorageProvider; audit: AuditSink; auth: AuthProvider | null; identity: IdentityProvider | null };
  /** The default/instance principal (single operator unless auth is wired). */
  readonly principal: Principal;
  /** Encode + send a ServerMsg to every connected client. */
  broadcast(msg: ServerMsg | Record<string, unknown>): void;
  /** Start listening on host:port; resolves once bound. */
  listen(): Promise<{ port: number; url: string }>;
  /** Abort any in-flight turn, close all sockets + the server. */
  close(): Promise<void>;
}

/** Create a Surface kernel instance. */
export function createSurface(config: SurfaceConfig): SurfaceInstance;
export default createSurface;
