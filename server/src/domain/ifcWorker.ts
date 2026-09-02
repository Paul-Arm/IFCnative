import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parentPort, type TransferListItem } from "node:worker_threads";

import { DOMParser } from "linkedom";

import {
  buildVersionManifest,
  diffEntityFields,
  parseIdsXml,
  parseNativeIfcText,
  validateIds,
  type NativeIfcDocument,
} from "../ifc";
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerTask,
} from "./ifcWorkerProtocol";

/**
 * Worker-Thread für alle CPU-lastigen IFC-Arbeiten des Hubs (STEP-Parsing,
 * Manifest-Hashing, Feld-Diff, IDS-Validierung, Fragments-Konvertierung).
 *
 * Ein 270-MB-IFC blockiert den Parser 30 s und die web-ifc-Konvertierung
 * noch länger — im Hauptthread stünde der ganze Server so lange still. Hier
 * läuft das isoliert; der Hauptthread bedient währenddessen weiter Requests.
 *
 * Geparste Dokumente bleiben pro Commit-Id in einem kleinen LRU, damit das
 * Aufklappen mehrerer Entities eines Diffs die beiden Stände nur einmal
 * parst. Commits sind unveränderlich, der Cache veraltet also nie.
 */

// Der Editor-IDS-Parser erwartet einen DOM-Parser wie im Browser.
if (typeof globalThis.DOMParser === "undefined") {
  (globalThis as unknown as Record<string, unknown>).DOMParser = DOMParser;
}

const PARSE_CACHE_LIMIT = 4;
const parseCache = new Map<string, NativeIfcDocument>();

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "utf8",
  );
}

function cachedDocument(
  id: string,
  bytes: Uint8Array | undefined,
): NativeIfcDocument | undefined {
  const cached = parseCache.get(id);
  if (cached) {
    // LRU: zuletzt genutzt nach hinten.
    parseCache.delete(id);
    parseCache.set(id, cached);
    return cached;
  }
  if (!bytes) {
    return undefined;
  }
  const doc = parseNativeIfcText(decode(bytes));
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) {
      parseCache.delete(oldest);
    }
  }
  parseCache.set(id, doc);
  return doc;
}

async function convertFragments(bytes: Uint8Array): Promise<Uint8Array> {
  // Lazy import: three/@thatopen/fragments nur laden, wenn wirklich eine
  // Vorschau angefragt wird.
  const { IfcImporter } = await import("@thatopen/fragments");
  const importer = new IfcImporter();
  const require = createRequire(import.meta.url);
  // web-ifc kapselt sein package.json hinter "exports" — deshalb den
  // Modul-Einstieg aufloesen und dessen Verzeichnis als WASM-Pfad nehmen.
  importer.wasm = {
    absolute: true,
    path: join(dirname(require.resolve("web-ifc")), "/"),
  };
  importer.webIfcSettings = {
    // Georeferenzierte Modelle zum Ursprung verschieben, damit die
    // Vertexdaten in float32-Präzision bleiben (gleiches Setting wie im
    // Editor-Konvertierungs-Worker).
    COORDINATE_TO_ORIGIN: true,
  };
  // Attribute + Relationen (Psets etc.) in die Fragments aufnehmen —
  // Grundlage für die Klick-Info-Anzeige im Viewer (getItemsData).
  importer.addAllAttributes();
  importer.addAllRelations();
  return importer.process({ bytes });
}

async function handle(
  task: WorkerTask,
): Promise<{ result: unknown; transfer: TransferListItem[] }> {
  switch (task.type) {
    case "analyze": {
      const doc = parseNativeIfcText(decode(task.bytes));
      const manifest = buildVersionManifest(doc);
      return {
        result: {
          schema: doc.schema,
          manifestHash: manifest.manifestHash,
          entityCount: manifest.entityCount,
          duplicateGlobalIds: manifest.duplicateGlobalIds,
          entries: [...manifest.entries.values()],
        },
        transfer: [],
      };
    }
    case "entityDiff": {
      const before = cachedDocument(task.from.id, task.from.bytes);
      const after = cachedDocument(task.to.id, task.to.bytes);
      const missing = [
        ...(before ? [] : [task.from.id]),
        ...(after ? [] : [task.to.id]),
      ];
      if (!before || !after) {
        return { result: { missing }, transfer: [] };
      }
      return {
        result: {
          detail: diffEntityFields(before, after, task.globalId),
          cachedIds: [...parseCache.keys()],
        },
        transfer: [],
      };
    }
    case "validateIds": {
      const ids = parseIdsXml(task.idsXml, task.idsFileName);
      const document = parseNativeIfcText(decode(task.bytes));
      const summary = validateIds(document, ids);
      // GlobalIds der Verstöße — für "Issue erstellen" + 3D-Verortung.
      const failedGuids: string[] = [];
      for (const result of summary.results) {
        for (const failure of result.failures) {
          const guid = document.entityById.get(failure.entityId)?.globalId;
          if (guid) {
            failedGuids.push(guid);
          }
        }
      }
      return {
        result: { summary, idsWarnings: ids.warnings, failedGuids },
        transfer: [],
      };
    }
    case "fragments": {
      const bytes = await convertFragments(task.bytes);
      return { result: { bytes }, transfer: [bytes.buffer as ArrayBuffer] };
    }
    default: {
      const unknown = task as { type?: string };
      throw new Error(`Unbekannte Worker-Aufgabe: ${unknown.type}`);
    }
  }
}

const port = parentPort;
if (!port) {
  throw new Error("ifcWorker muss als Worker-Thread laufen");
}

port.on("message", (request: WorkerRequest) => {
  void handle(request.task)
    .then(({ result, transfer }) => {
      const response: WorkerResponse = { id: request.id, ok: true, result };
      port.postMessage(response, transfer);
    })
    .catch((error: unknown) => {
      const response: WorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      port.postMessage(response);
    });
});
