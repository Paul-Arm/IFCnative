/**
 * Laufzeitkonfiguration aus Umgebungsvariablen — identisch für beide
 * Betriebsarten (Tauri-Sidecar auf localhost und zentraler Docker-Dienst).
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const pkg = createRequire(import.meta.url)("../package.json") as {
  version?: string;
};

/** Version des Hub-Dienstes, wie sie `GET /api/health` meldet. */
export const HUB_VERSION: string = pkg.version ?? "0.0.0";

export interface HubConfig {
  /** HTTP-Port (env `HUB_PORT`, Standard 8711). */
  port: number;
  /** Bind-Adresse (env `HUB_HOST`). Standalone: 127.0.0.1, Docker: 0.0.0.0. */
  host: string;
  /** Datenverzeichnis mit `catalog.json` und `blobs/` (env `HUB_DATA_DIR`). */
  dataDir: string;
  /** Optionales Bearer-Token (env `HUB_TOKEN`); leer = keine Prüfung. */
  token: string;
}

export const DEFAULT_PORT = 8711;

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(
      `HUB_PORT ist kein gültiger Port: "${raw}" (erwartet 0–65535).`,
    );
  }
  return parsed;
}

/** Standard-Datenverzeichnis im Benutzerprofil (Standalone-Betrieb). */
export function defaultDataDir(): string {
  return path.join(os.homedir(), ".ifcnative", "hub");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const dataDir = env["HUB_DATA_DIR"]?.trim();
  return {
    port: readPort(env["HUB_PORT"]),
    host: env["HUB_HOST"]?.trim() || "127.0.0.1",
    dataDir: dataDir && dataDir.length > 0 ? path.resolve(dataDir) : defaultDataDir(),
    token: env["HUB_TOKEN"]?.trim() ?? "",
  };
}
