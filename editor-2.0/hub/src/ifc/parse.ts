/**
 * Dünner Adapter auf `@ifc-lite/parser`.
 *
 * Der Hub parst IFC nur aus zwei Gründen: um beim Commit Schema und
 * Entity-Zahl als Metadaten festzuhalten, und um zwei Stände zu vergleichen.
 * Geometrie wird bewusst nicht erzeugt (kein WASM-Mesh-Pass im Dienst).
 */
import { IfcParser, type IfcDataStore } from "@ifc-lite/parser";
import { unprocessable } from "../errors.js";

/** Metadaten, die aus dem Modell selbst stammen. */
export interface ModelFacts {
  schema: string;
  entityCount: number;
}

/**
 * Kopiert die Bytes in einen eigenständigen `ArrayBuffer`. Nötig, weil ein
 * `Uint8Array` aus einem Fastify-Buffer ein Fenster auf einen größeren,
 * geteilten Pool ist — `bytes.buffer` direkt zu übergeben würde dem Parser
 * fremde Bytes unterschieben.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Parst IFC-Bytes in den kolumnaren Store von ifc-lite. */
export async function parseIfc(bytes: Uint8Array): Promise<IfcDataStore> {
  if (bytes.byteLength === 0) {
    throw unprocessable("Leerer Inhalt — es wurden keine IFC-Bytes gesendet.");
  }
  let store: IfcDataStore;
  try {
    store = await new IfcParser().parseColumnar(toArrayBuffer(bytes));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw unprocessable(`IFC konnte nicht gelesen werden: ${detail}`);
  }
  // Der Parser wirft bei Datenmüll nicht, sondern liefert einen leeren Store
  // (er protokolliert nur). Ein IFC ohne eine einzige Entity ist als
  // Versionsstand wertlos — hier ist die Grenze zwischen 201 und 422.
  if (store.entityCount <= 0) {
    throw unprocessable(
      "Der Inhalt enthält keine IFC-Entities — das ist keine gültige IFC-Datei.",
    );
  }
  return store;
}

/** Liest Schema und Entity-Zahl aus einem geparsten Store. */
export function factsOf(store: IfcDataStore): ModelFacts {
  return {
    schema: store.schemaVersion ?? "unbekannt",
    entityCount: store.entityCount,
  };
}

/** Kurzweg für den Commit: parsen und nur die Metadaten behalten. */
export async function readFacts(bytes: Uint8Array): Promise<ModelFacts> {
  return factsOf(await parseIfc(bytes));
}
