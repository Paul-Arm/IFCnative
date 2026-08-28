import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { type ObjectStore, toBuffer } from "./objectStore";

/**
 * Filesystem-backed object store for local development and tests.
 * Keys map to paths under `rootDir`; nested "directories" in keys are created
 * on demand.
 */
export class FilesystemObjectStore implements ObjectStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  private pathFor(key: string): string {
    // Disallow path traversal out of the root. Compare via path.relative so the
    // check is correct on Windows (backslash separators) as well as POSIX.
    const target = resolve(join(this.rootDir, key));
    const rel = relative(this.rootDir, target);
    if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
      throw new Error(`Invalid object key: ${key}`);
    }
    return target;
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, toBuffer(data));
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
