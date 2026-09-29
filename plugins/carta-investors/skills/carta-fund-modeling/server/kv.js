import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class FileKV {
  constructor(dir) {
    this._dir = dir;
    this._ready = mkdir(dir, { recursive: true });
  }

  _path(key) {
    return join(this._dir, encodeURIComponent(key) + ".json");
  }

  async get(key, type) {
    await this._ready;
    try {
      const raw = await readFile(this._path(key), "utf8");
      const entry = JSON.parse(raw);
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        await this.delete(key);
        return null;
      }
      if (type === "json") return entry.value != null ? JSON.parse(entry.value) : null;
      return entry.value ?? null;
    } catch {
      return null;
    }
  }

  async put(key, value, opts) {
    await this._ready;
    const entry = { value };
    if (opts?.expirationTtl) entry.expiresAt = Date.now() + opts.expirationTtl * 1000;
    await writeFile(this._path(key), JSON.stringify(entry));
  }

  async delete(key) {
    await this._ready;
    try { await unlink(this._path(key)); } catch {}
  }
}
