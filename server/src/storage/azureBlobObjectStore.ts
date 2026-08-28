import {
  BlobServiceClient,
  type ContainerClient,
} from "@azure/storage-blob";

import { type ObjectStore, toBuffer } from "./objectStore";

/**
 * Azure Blob Storage driver — the production object store.
 *
 * Configure via a connection string (AZURE_STORAGE_CONNECTION_STRING) and a
 * container name. Call `init()` once at startup to ensure the container exists.
 */
export class AzureBlobObjectStore implements ObjectStore {
  private readonly container: ContainerClient;

  constructor(connectionString: string, containerName: string) {
    this.container = BlobServiceClient.fromConnectionString(
      connectionString,
    ).getContainerClient(containerName);
  }

  static fromConnectionString(
    connectionString: string,
    containerName: string,
  ): AzureBlobObjectStore {
    return new AzureBlobObjectStore(connectionString, containerName);
  }

  async init(): Promise<void> {
    await this.container.createIfNotExists();
  }

  async put(
    key: string,
    data: Buffer | string,
    contentType?: string,
  ): Promise<void> {
    const buffer = toBuffer(data);
    await this.container.getBlockBlobClient(key).uploadData(buffer, {
      blobHTTPHeaders: contentType
        ? { blobContentType: contentType }
        : undefined,
    });
  }

  async get(key: string): Promise<Buffer> {
    return this.container.getBlockBlobClient(key).downloadToBuffer();
  }

  async exists(key: string): Promise<boolean> {
    return this.container.getBlockBlobClient(key).exists();
  }

  async delete(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }
}
