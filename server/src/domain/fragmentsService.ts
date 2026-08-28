import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { Commit } from "../repository/types";
import type { ObjectStore } from "../storage/objectStore";

/**
 * IFC -> Fragments (ThatOpen) für die 3D-Vorschau der Web-UI.
 *
 * Die Konvertierung (web-ifc-WASM-Parsing + Geometrieaufbau) ist der teure
 * Schritt — deshalb wird das Ergebnis im Object Store neben der IFC abgelegt
 * (gleicher Key mit .frag statt .ifc). Commits sind unveränderlich, der
 * Cache veraltet also nie: konvertiert wird höchstens einmal pro Commit,
 * gleichzeitige Erst-Anfragen teilen sich denselben Konvertierungslauf.
 */
export class FragmentsService {
  constructor(private readonly store: ObjectStore) {}

  private readonly inflight = new Map<string, Promise<Buffer>>();

  /**
   * Format-Generation des Caches: v2 = mit allen Attributen/Relationen
   * (Psets für die Info-Anzeige im Viewer). Bei Format-Änderungen hochzählen
   * — alte Einträge werden einfach neu konvertiert.
   */
  static fragKey(blobKey: string): string {
    return `${blobKey.replace(/\.ifc$/i, "")}.v2.frag`;
  }

  /** Alle Cache-Generationen zu einem Blob (fürs Aufräumen beim Löschen). */
  static allFragKeys(blobKey: string): string[] {
    const base = blobKey.replace(/\.ifc$/i, "");
    return [`${base}.frag`, `${base}.v2.frag`];
  }

  async getFragments(commit: Commit): Promise<Buffer> {
    const key = FragmentsService.fragKey(commit.blobKey);
    if (await this.store.exists(key)) {
      return this.store.get(key);
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const job = this.convert(commit, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, job);
    return job;
  }

  private async convert(commit: Commit, key: string): Promise<Buffer> {
    const ifc = await this.store.get(commit.blobKey);
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
    const bytes = await importer.process({ bytes: new Uint8Array(ifc) });
    const buffer = Buffer.from(bytes);
    await this.store.put(key, buffer, "application/octet-stream");
    return buffer;
  }
}
