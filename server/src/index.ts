import { join } from "node:path";

import { loadConfig } from "./config";
import { buildApp } from "./http/app";
import { JsonFileRepository } from "./repository/jsonFileRepository";
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

  // Postgres when DATABASE_URL is set; otherwise a JSON catalog file under
  // DATA_DIR so the local mode survives restarts (blobs live next to it).
  let repo: Repository;
  if (config.databaseUrl) {
    const sqlRepo = new SqlRepository(createPgClient(config.databaseUrl));
    await sqlRepo.migrate();
    repo = sqlRepo;
  } else {
    const fileRepo = new JsonFileRepository(join(config.dataDir, "catalog.json"));
    await fileRepo.init();
    repo = fileRepo;
  }

  const app = buildApp({
    repo,
    store,
    jwtSecret: config.jwtSecret,
    storageMode: config.storage,
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(
    `IFC VCS server listening on http://${config.host}:${config.port} (storage: ${config.storage})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
