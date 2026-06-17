// WS origin allowlist + loopback bind (gotcha G8) — the security invariant that
// makes a local server running an agent CLI safe. Boots a real Surface on an
// ephemeral port and probes the upgrade handshake with various Origin headers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createSurface } from "../src/kernel/server.mjs";
import { echoAdapter } from "../src/adapters/echo.mjs";
import { FileStore } from "../src/providers/store-file.mjs";

function tryConnect(port, origin, path = "/ws") {
  return new Promise((resolve) => {
    const opts = origin === undefined ? {} : { origin };
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, opts);
    ws.on("open", () => { ws.close(); resolve({ ok: true }); });
    ws.on("unexpected-response", (_req, res) => { try { ws.terminate(); } catch {} resolve({ ok: false, status: res.statusCode }); });
    ws.on("error", (e) => resolve({ ok: false, error: String(e?.message || e) }));
  });
}

test("origin allowlist accept/reject matrix (G8)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surface-origin-"));
  const surface = createSurface({
    adapter: echoAdapter(),
    port: 0,
    host: "127.0.0.1",
    openBrowser: false,
    store: new FileStore({ dir }),
    allowedOrigins: ["http://good.example"],
  });
  const { port } = await surface.listen();
  try {
    assert.equal((await tryConnect(port, undefined)).ok, true, "no Origin (native/curl) is allowed");
    assert.equal((await tryConnect(port, "http://good.example")).ok, true, "allowlisted origin connects");
    assert.equal((await tryConnect(port, "http://GOOD.example/")).ok, true, "origin is normalized (case + trailing slash)");

    const evil = await tryConnect(port, "http://evil.example");
    assert.equal(evil.ok, false, "a disallowed origin is rejected");
    assert.equal(evil.status, 403, "rejection is a real 403 (not a silent drop — G8)");

    const badPath = await tryConnect(port, "http://good.example", "/nope");
    assert.equal(badPath.ok, false, "upgrade on a non-/ws path is rejected");
  } finally {
    await surface.close();
    await rm(dir, { recursive: true, force: true });
  }
});
