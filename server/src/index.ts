import { join } from "node:path";

import { loadConfig } from "./config";
import { buildApp } from "./http/app";
import { createPgClient } from "./repository/sql/pgClient";
import { SqliteClient } from "./repository/sql/sqliteClient";
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

  // Postgres when DATABASE_URL is set; otherwise SQLite (node:sqlite) under
  // DATA_DIR — the blobs live next to it in the filesystem object store.
  let repo: Repository;
  if (config.databaseUrl) {
    const sqlRepo = new SqlRepository(createPgClient(config.databaseUrl));
    await sqlRepo.migrate();
    repo = sqlRepo;
  } else {
    const sqliteRepo = new SqlRepository(
      new SqliteClient(join(config.dataDir, "catalog.sqlite")),
    );
    await sqliteRepo.migrate();
    repo = sqliteRepo;
  }

  const app = buildApp({
    repo,
    store,
    jwtSecret: config.jwtSecret,
    storageMode: config.storage,
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(
    `IFC Hub listening on http://${config.host}:${config.port} (storage: ${config.storage})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
