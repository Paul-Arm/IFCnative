import { loadConfig } from "./config";
import { buildApp } from "./http/app";
import { MemoryRepository } from "./repository/memoryRepository";
import { createPgClient } from "./repository/sql/pgClient";
import { SqlRepository } from "./repository/sqlRepository";
import type { Repository } from "./repository/types";
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

  // Postgres when DATABASE_URL is set, else the non-persistent in-memory repo.
  let repo: Repository;
  if (config.databaseUrl) {
    const sqlRepo = new SqlRepository(createPgClient(config.databaseUrl));
    await sqlRepo.migrate();
    repo = sqlRepo;
  } else {
    repo = new MemoryRepository();
  }

  const app = buildApp({ repo, store, jwtSecret: config.jwtSecret });

  await app.listen({ port: config.port, host: config.host });
  console.log(
    `IFC VCS server listening on http://${config.host}:${config.port} (storage: ${config.storage})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
