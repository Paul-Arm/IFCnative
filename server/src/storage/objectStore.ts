/**
 * Object storage abstraction for raw IFC blobs and version manifests.
 *
 * The production driver is Azure Blob Storage (see azureBlobObjectStore.ts);
 * the filesystem driver backs local development and tests. Keep this interface
 * narrow so additional backends (S3, GCS) stay trivial to add.
 */
export interface ObjectStore {
  /** Idempotently store a blob under `key`. */
  put(key: string, data: Buffer | string, contentType?: string): Promise<void>;
  /** Fetch a blob; rejects if the key does not exist. */
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Remove a blob; resolving is fine even if the key does not exist. */
  delete(key: string): Promise<void>;
}

export function toBuffer(data: Buffer | string): Buffer {
  return typeof data === "string" ? Buffer.from(data, "utf8") : data;
}
