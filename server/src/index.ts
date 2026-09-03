import { join } from "node:path";

import { hashPassword } from "./auth/passwords";
import { loadConfig } from "./config";
import { buildApp } from "./http/app";
import { installProcessErrorLog } from "./http/requestLog";
import { createPgClient } from "./repository/sql/pgClient";
import { SqliteClient } from "./repository/sql/sqliteClient";
import { SqlRepository } from "./repository/sqlRepository";
import type { Repository } from "./repository/types";
import { AzureBlobObjectStore } from "./storage/azureBlobObjectStore";
import { FilesystemObjectStore } from "./storage/filesystemObjectStore";
import type { ObjectStore } from "./storage/objectStore";

async function main(): Promise<void> {
  installProcessErrorLog();
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

  // Fest verdrahtetes Admin-Konto sicherstellen (ADMIN_EMAIL/ADMIN_PASSWORD).
  // Existiert es schon, bleibt das Passwort unangetastet — nur der
  // Admin-Status wird gesetzt.
  const existingAdmin = await repo.getUserByEmail(config.adminEmail);
  if (!existingAdmin) {
    await repo.createUser({
      email: config.adminEmail,
      name: "Admin",
      passwordHash: hashPassword(config.adminPassword),
      isAdmin: true,
    });
    console.log(
      `Admin-Konto angelegt: ${config.adminEmail} (Passwort per ADMIN_PASSWORD aendern!)`,
    );
  } else if (!existingAdmin.isAdmin) {
    await repo.updateUser(existingAdmin.id, { isAdmin: true });
    console.log(`Admin-Status gesetzt fuer ${config.adminEmail}`);
  }

  const app = buildApp({
    repo,
    store,
    jwtSecret: config.jwtSecret,
    storageMode: config.storage,
    logRequests: config.logRequests,
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(
    `IFC Hub listening on http://${config.host}:${config.port} (storage: ${config.storage}, request log: ${config.logRequests ? "on" : "off"})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
