/**
 * Dateisystem-Adapter — die Standalone-Ablage des Hubs.
 *
 * Verzeichnisbaum unter `dataDir`:
 *   catalog.json          Katalog (atomar geschrieben: tmp-Datei + rename)
 *   blobs/<sha256-hex>    unveränderliche IFC-Blobs, dedupliziert
 *
 * Atomarität: `rename()` ist auf einem Dateisystem atomar, ein abgebrochener
 * Schreibvorgang hinterlässt also nie einen halben Katalog. Die Serialisierung
 * über `queue` verhindert, dass zwei parallele Commits einander überschreiben
 * (klassisches Lost-Update bei read-modify-write).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CatalogStore } from "./adapter.js";
import { emptyCatalog, type Catalog } from "../types.js";
import { HubError } from "../errors.js";

const CATALOG_FILE = "catalog.json";
const BLOB_DIR = "blobs";
/** sha256 als 64 Hex-Zeichen — schützt den Pfad vor `..`-Tricks. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export class FilesystemStore implements CatalogStore {
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;

  constructor(readonly dataDir: string) {}

  private get catalogPath(): string {
    return path.join(this.dataDir, CATALOG_FILE);
  }

  private blobPath(hash: string): string {
    if (!HASH_PATTERN.test(hash)) {
      throw new HubError(400, `Ungültiger Blob-Hash: "${hash}".`);
    }
    return path.join(this.dataDir, BLOB_DIR, hash);
  }

  async init(): Promise<void> {
    if (this.ready) return;
    await fs.mkdir(path.join(this.dataDir, BLOB_DIR), { recursive: true });
    this.ready = true;
  }

  async read(): Promise<Catalog> {
    await this.init();
    let raw: string;
    try {
      raw = await fs.readFile(this.catalogPath, "utf8");
    } catch (cause) {
      if (isMissing(cause)) return emptyCatalog();
      throw cause;
    }
    return parseCatalog(raw, this.catalogPath);
  }

  async transaction<T>(
    mutate: (catalog: Catalog) => Promise<T> | T,
  ): Promise<T> {
    // An die Warteschlange anhängen: der nächste Zyklus startet erst, wenn der
    // vorherige geschrieben hat. Fehler brechen die Kette nicht ab.
    const run = this.queue.then(
      () => this.runTransaction(mutate),
      () => this.runTransaction(mutate),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runTransaction<T>(
    mutate: (catalog: Catalog) => Promise<T> | T,
  ): Promise<T> {
    const catalog = await this.read();
    const result = await mutate(catalog);
    await this.writeCatalog(catalog);
    return result;
  }

  private async writeCatalog(catalog: Catalog): Promise<void> {
    const tmp = `${this.catalogPath}.${randomUUID()}.tmp`;
    const payload = `${JSON.stringify(catalog, null, 2)}\n`;
    await fs.writeFile(tmp, payload, "utf8");
    try {
      await fs.rename(tmp, this.catalogPath);
    } catch (cause) {
      await fs.rm(tmp, { force: true });
      throw cause;
    }
  }

  async putBlob(hash: string, bytes: Uint8Array): Promise<boolean> {
    await this.init();
    const target = this.blobPath(hash);
    if (await exists(target)) return false; // Dedup: Bytes liegen schon vor.
    const tmp = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, bytes);
    try {
      await fs.rename(tmp, target);
    } catch (cause) {
      await fs.rm(tmp, { force: true });
      throw cause;
    }
    return true;
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    await this.init();
    try {
      return await fs.readFile(this.blobPath(hash));
    } catch (cause) {
      if (isMissing(cause)) {
        throw new HubError(410, `Blob ${hash} fehlt in der Ablage.`);
      }
      throw cause;
    }
  }

  async hasBlob(hash: string): Promise<boolean> {
    await this.init();
    return exists(this.blobPath(hash));
  }
}

function isMissing(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function parseCatalog(raw: string, file: string): Catalog {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HubError(500, `Katalogdatei ${file} ist kein gültiges JSON.`);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as Catalog).projects)
  ) {
    throw new HubError(500, `Katalogdatei ${file} hat ein unbekanntes Format.`);
  }
  const catalog = value as Catalog;
  return { catalogVersion: 1, projects: catalog.projects };
}
