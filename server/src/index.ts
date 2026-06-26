import { loadConfig } from "./config";
import { buildApp } from "./http/app";
import { MemoryRepository } from "./repository/memoryRepository";
import { AzureBlobObjectStore } from "./storage/azureBlobObjectStore";
import { FilesystemObjectStore } from "./storage/filesystemObjectStore";
import type { ObjectStore } from "./storage/objectStore";

async function main(): Promise<void> {
  const config = loadConfig();

  let store: ObjectStore;
  if (config.storage === "azure") {
    if (!config.azureConnectionString) {
      throw new Error(
        "AZURE_STORAGE_CONNECTION_STRING is required when STORAGE=azure",
      );
    }
    const azure = new AzureBlobObjectStore(
      config.azureConnectionString,
      config.azureContainer,
    );
    await azure.init();
    store = azure;
  } else {
    store = new FilesystemObjectStore(config.dataDir);
  }

  // NOTE: MemoryRepository is non-persistent. Replace with a Postgres /
  // Azure SQL implementation of Repository for production deployments.
  const repo = new MemoryRepository();

  const app = buildApp({ repo, store, jwtSecret: config.jwtSecret });

  await app.listen({ port: config.port, host: config.host });
  // eslint-disable-next-line no-console
  console.log(
    `IFC VCS server listening on http://${config.host}:${config.port} (storage: ${config.storage})`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
