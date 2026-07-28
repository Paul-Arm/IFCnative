/**
 * Typisierter fetch-Client für die Hub-API (editor-2.0/hub).
 *
 * Vertrag (Basis-URL konfigurierbar, Default http://127.0.0.1:8711):
 *   GET  /api/health                                        → {ok,version}
 *   GET  /api/projects                    POST {name}       → Projekt(e)
 *   GET  /api/projects/:pid/models        POST {name}       → Modell(e)
 *   GET  /api/projects/:pid/models/:mid/versions            → Stände
 *   POST …/versions?message=&author=  (Body: IFC-Bytes)     → Stand
 *   GET  …/versions/:vid/file                               → Bytes
 *   GET  …/versions/:vid/diff/:otherVid                     → Diff
 *
 * Jeder Ausgang wirft ausschließlich `HubError` mit deutscher Meldung; die
 * Panes zeigen `message` unverändert an. Ein optionales Bearer-Token wird
 * mitgeschickt, sobald es in den Einstellungen steht.
 */
import { HUB_OFFLINE_HINT, HubError, httpError } from "./error";
import {
  toDiff,
  toHealth,
  toModel,
  toModels,
  toProject,
  toProjects,
  toVersion,
  toVersions,
} from "./normalize";
import { DEFAULT_HUB_URL } from "./settings";
import type {
  HubConfig,
  HubDiff,
  HubHealth,
  HubModel,
  HubProject,
  HubVersion,
} from "./types";

/** Normale Anfragen; Uploads/Downloads dürfen länger dauern. */
const TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 120_000;

/** Basis-URL prüfen und auf die Form „scheme://host:port" bringen. */
function baseOf(config: HubConfig): string {
  const raw = config.baseUrl.trim() || DEFAULT_HUB_URL;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    new URL(candidate);
  } catch {
    throw new HubError(
      `Ungültige Hub-Adresse „${raw}" — erwartet wird z. B. ${DEFAULT_HUB_URL}.`,
      "config",
    );
  }
  return candidate.replace(/\/+$/, "");
}

function versionsPath(projectId: string, modelId: string): string {
  return (
    `/api/projects/${encodeURIComponent(projectId)}` +
    `/models/${encodeURIComponent(modelId)}/versions`
  );
}

interface SendOptions {
  method?: "GET" | "POST";
  body?: BodyInit;
  contentType?: string;
  timeoutMs?: number;
}

/** Eine Anfrage absetzen; wirft bei Netz-, Zeit- und HTTP-Fehlern HubError. */
async function send(
  config: HubConfig,
  path: string,
  options: SendOptions = {},
): Promise<Response> {
  const url = baseOf(config) + path;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? TIMEOUT_MS,
  );
  const headers = new Headers();
  const token = config.token.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.contentType) headers.set("Content-Type", options.contentType);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      signal: controller.signal,
    });
  } catch {
    // Abbruch durch den Timer sieht wie ein Netzfehler aus — unterscheiden.
    throw controller.signal.aborted
      ? new HubError(
          "Zeitüberschreitung — der Hub hat nicht rechtzeitig geantwortet.",
          "timeout",
        )
      : new HubError(HUB_OFFLINE_HINT, "offline");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw await httpError(response);
  return response;
}

async function json(response: Response): Promise<unknown> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    throw new HubError("Antwort des Hubs konnte nicht gelesen werden.", "format");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HubError(
      "Unerwartete Antwort des Hubs (kein gültiges JSON) — zeigt die Basis-URL wirklich auf den Hub?",
      "format",
    );
  }
}

async function getJson(config: HubConfig, path: string): Promise<unknown> {
  return json(await send(config, path));
}

async function postJson(
  config: HubConfig,
  path: string,
  payload: unknown,
): Promise<unknown> {
  return json(
    await send(config, path, {
      method: "POST",
      body: JSON.stringify(payload),
      contentType: "application/json",
    }),
  );
}

// — API —

/** Verbindungsprüfung. Ein `ok:false` des Hubs wird als Fehler gemeldet. */
export async function checkHealth(config: HubConfig): Promise<HubHealth> {
  const health = toHealth(await getJson(config, "/api/health"));
  if (!health.ok) {
    throw new HubError("Der Hub meldet sich als nicht betriebsbereit.", "http");
  }
  return health;
}

export async function listProjects(config: HubConfig): Promise<HubProject[]> {
  return toProjects(await getJson(config, "/api/projects"));
}

export async function createProject(
  config: HubConfig,
  name: string,
): Promise<HubProject> {
  return toProject(await postJson(config, "/api/projects", { name }));
}

export async function listModels(
  config: HubConfig,
  projectId: string,
): Promise<HubModel[]> {
  const path = `/api/projects/${encodeURIComponent(projectId)}/models`;
  return toModels(await getJson(config, path));
}

export async function createModel(
  config: HubConfig,
  projectId: string,
  name: string,
): Promise<HubModel> {
  const path = `/api/projects/${encodeURIComponent(projectId)}/models`;
  return toModel(await postJson(config, path, { name }));
}

export async function listVersions(
  config: HubConfig,
  projectId: string,
  modelId: string,
): Promise<HubVersion[]> {
  return toVersions(await getJson(config, versionsPath(projectId, modelId)));
}

/** Stand sichern: IFC-Bytes als octet-stream, Meta als Query-Parameter. */
export async function createVersion(
  config: HubConfig,
  projectId: string,
  modelId: string,
  bytes: Uint8Array,
  meta: { message: string; author: string },
): Promise<HubVersion> {
  const query = new URLSearchParams({
    message: meta.message,
    author: meta.author,
  });
  const response = await send(
    config,
    `${versionsPath(projectId, modelId)}?${query.toString()}`,
    {
      method: "POST",
      // Blob statt Uint8Array: identischer Weg wie beim IFC-Export in der
      // Kopfleiste und unabhängig von der ArrayBuffer-Variante des Views.
      body: new Blob([bytes as BlobPart]),
      contentType: "application/octet-stream",
      timeoutMs: TRANSFER_TIMEOUT_MS,
    },
  );
  return toVersion(await json(response));
}

/** Stand als IFC-Bytes holen (für useDocuments.openDocument). */
export async function downloadVersion(
  config: HubConfig,
  projectId: string,
  modelId: string,
  versionId: string,
): Promise<ArrayBuffer> {
  const path = `${versionsPath(projectId, modelId)}/${encodeURIComponent(versionId)}/file`;
  const response = await send(config, path, {
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    throw new HubError("Der Stand konnte nicht geladen werden.", "format");
  }
  if (buffer.byteLength === 0) {
    throw new HubError("Der Hub hat einen leeren Stand geliefert.", "format");
  }
  return buffer;
}

export async function loadDiff(
  config: HubConfig,
  projectId: string,
  modelId: string,
  versionId: string,
  otherVersionId: string,
): Promise<HubDiff> {
  const path =
    `${versionsPath(projectId, modelId)}/${encodeURIComponent(versionId)}` +
    `/diff/${encodeURIComponent(otherVersionId)}`;
  return toDiff(await getJson(config, path));
}
