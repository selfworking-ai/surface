/**
 * Surface kernel hub — editor-facing types for `createSurface`. The executable
 * source of truth is `server.mjs`; keep these in lockstep. The hub wires an
 * http+ws server, the retained-mode workspace, the registry + broker, the
 * identity/permission boundary, and the per-turn loop that drives an AgentAdapter.
 */

import type { AgentAdapter, Principal } from "../adapter-sdk/adapter";
import type { StorageProvider } from "../provider-sdk/ports";
import type { Mode, ServerMsg } from "../protocol/surface-protocol";

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
  /** Presentation storage. Default new FileStore({ dir: env.SURFACE_DIR || "./.surface" }). */
  store?: StorageProvider;
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
