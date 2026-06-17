// FileStore — the default StorageProvider (jsonl + json on disk). Persists ONLY
// presentation: the frames log (turn history for time-travel), the workspace
// document (durable composition), and a small kv space (session metadata, prefs).
// Surface never persists cognition or org state — the runtime owns those.
//
// Layout under `dir` (default ./.surface):
//   sessions/<id>.jsonl    one frame per line (the timeline)
//   workspaces/<id>.json   the latest workspace snapshot
//   kv/<key>.json          generic key/value
//
// Implements the StorageProvider port (see provider-sdk/ports.d.ts).

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// Session ids must be filesystem-safe (they come from the runtime + the browser).
const VALID_SID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function fileStore(opts = {}) { return new FileStore(opts); }

export class FileStore {
  constructor({ dir } = {}) {
    this.id = "file";
    this.dir = dir || join(process.cwd(), ".surface");
    this._ensured = null;
  }

  _ensure() {
    if (!this._ensured) {
      this._ensured = Promise.all([
        mkdir(join(this.dir, "sessions"), { recursive: true }),
        mkdir(join(this.dir, "workspaces"), { recursive: true }),
        mkdir(join(this.dir, "kv"), { recursive: true }),
      ]);
    }
    return this._ensured;
  }

  _framesFile(s) { return join(this.dir, "sessions", `${s}.jsonl`); }
  _wsFile(s) { return join(this.dir, "workspaces", `${s}.json`); }
  _kvFile(k) { return join(this.dir, "kv", `${encodeURIComponent(k)}.json`); }

  async get(key) {
    try { return JSON.parse(await readFile(this._kvFile(key), "utf8")); }
    catch { return undefined; }
  }

  async put(key, value) {
    await this._ensure();
    await writeFile(this._kvFile(key), JSON.stringify(value), "utf8");
  }

  async appendFrame(session, frame) {
    if (!VALID_SID.test(session || "")) throw new Error("appendFrame: invalid session id");
    await this._ensure();
    await appendFile(this._framesFile(session), JSON.stringify(frame) + "\n", "utf8");
  }

  async listFrames(session) {
    if (!VALID_SID.test(session || "")) return [];
    try {
      const txt = await readFile(this._framesFile(session), "utf8");
      return txt.split("\n").filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch { return []; }
  }

  async saveWorkspace(session, snapshot) {
    if (!VALID_SID.test(session || "")) return;
    await this._ensure();
    await writeFile(this._wsFile(session), JSON.stringify(snapshot), "utf8");
  }

  async loadWorkspace(session) {
    if (!VALID_SID.test(session || "")) return null;
    try { return JSON.parse(await readFile(this._wsFile(session), "utf8")); }
    catch { return null; }
  }
}

/** Exposed for callers that want to validate ids the same way the store does. */
export function isValidSessionId(id) { return VALID_SID.test(id || ""); }
