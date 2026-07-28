/**
 * Einstiegspunkt des Hub-Dienstes (`npm start`).
 *
 * Dasselbe Artefakt bedient beide Betriebsarten:
 *  a) Standalone — als Tauri-Sidecar auf 127.0.0.1, Ablage im App-Datenverzeichnis;
 *  b) zentral — im Docker-Container mit HUB_HOST=0.0.0.0 und HUB_TOKEN.
 */
import { loadConfig } from "./config.js";
import { FilesystemStore } from "./storage/filesystem.js";
import { HubService } from "./service.js";
import { buildServer } from "./http/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new FilesystemStore(config.dataDir);
  const service = new HubService(store);
  await service.init();

  const app = await buildServer({
    service,
    token: config.token,
    logger: true,
  });

  const shutdown = (signal: string): void => {
    app.log.info(`${signal} empfangen — Hub wird beendet.`);
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `IFC-Hub bereit — Daten: ${config.dataDir}, Token-Pflicht: ${
      config.token ? "ja" : "nein"
    }`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Hub konnte nicht starten: ${message}`);
  process.exit(1);
});
