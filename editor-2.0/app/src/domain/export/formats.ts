/**
 * Exportformate des aktiven Dokuments (M7).
 *
 * Jede Funktion liefert ein {@link ExportArtifact} — Dateiname, Bytes, MIME —
 * und wirft im Fehlerfall eine deutsche Meldung, die der Aufrufer unverändert
 * anzeigen kann (Statuszeile/alert).
 *
 * Gemeinsame Grundlage aller Formate sind die STEP-Bytes der Sitzung
 * (`session.exportStep()`), NICHT die Originaldatei: nur so fließen
 * Sitzungsänderungen (Properties, neue Bauteile, Tombstones) in jedes Format
 * ein. Die Wasm-gestützten Formate (GLB, CSV, JSON-LD) bekommen genau diese
 * Bytes durchgereicht, das Parquet/BOS-Paket parst sie erneut, weil
 * `ParquetExporter` einen `IfcDataStore` erwartet.
 *
 * BEFUND (Kernfrage Geometrie): `GeometryProcessor` kapselt die
 * Rust-Exporter aus `ifc-lite-export` (siehe d.ts von @ifc-lite/geometry
 * 3.4.0) — `exportGlb`, `exportCsv`, `exportJsonld` arbeiten alle auf dem
 * IFC-Puffer und brauchen nur `init()`. Dieselbe WASM-Kette läuft bereits in
 * `domain/checks/sources/clash.ts` im Node-Kontext von vitest.
 */
import { GeometryProcessor, isNoRenderGeometryError } from "@ifc-lite/geometry";
import { ParquetExporter } from "@ifc-lite/export";
import { IfcParser } from "@ifc-lite/parser";
import type { ModelSession } from "../../core/session";
import { IFCZIP_MIME, zipSingleIfc } from "./archive";

/** Ergebnis eines Exports; `text` ist nur bei Textformaten gesetzt. */
export interface ExportArtifact {
  fileName: string;
  bytes: Uint8Array;
  mime: string;
  /** UTF-8-Dekodierung von `bytes` (nur CSV und JSON-LD). */
  text?: string;
}

/** Modi des CSV-Exporters (Rust-Seite: ifc-lite-export). */
export type CsvMode = "entities" | "properties" | "quantities" | "spatial";

/** Alle über das Exportmenü erreichbaren Formate. */
export type ExportFormat =
  | "ifc"
  | "ifczip"
  | "glb"
  | "csv"
  | "jsonld"
  | "bos";

/** Exportauftrag aus der Oberfläche. */
export type ExportRequest =
  | { format: Exclude<ExportFormat, "csv"> }
  | { format: "csv"; mode: CsvMode };

const UTF8 = new TextDecoder();

/** Basisname der Sitzung ohne IFC-/Archiv-Endung. */
function baseName(session: ModelSession): string {
  return session.fileName.replace(/\.(ifc|ifczip|ifcx|zip|step|stp)$/i, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function failure(format: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${format}-Export fehlgeschlagen: ${detail}`);
}

// ---------------------------------------------------------------------------
// IFC / ifcZIP — ohne WASM, rein aus dem StepExporter der Sitzung
// ---------------------------------------------------------------------------

/** IFC (STEP) — das bestehende Verhalten des Exportieren-Knopfes. */
export function exportIfc(session: ModelSession): ExportArtifact {
  try {
    return {
      fileName: `${baseName(session)}.bearbeitet.ifc`,
      bytes: session.exportStep(),
      mime: "application/x-step",
    };
  } catch (error) {
    throw failure("IFC", error);
  }
}

/** ifcZIP — genau eine .ifc im Archiv (buildingSMART-Konvention). */
export function exportIfcZip(session: ModelSession): ExportArtifact {
  try {
    const name = baseName(session);
    return {
      fileName: `${name}.bearbeitet.ifczip`,
      bytes: zipSingleIfc(`${name}.ifc`, session.exportStep()),
      mime: IFCZIP_MIME,
    };
  } catch (error) {
    throw failure("ifcZIP", error);
  }
}

// ---------------------------------------------------------------------------
// WASM-gestützte Formate
// ---------------------------------------------------------------------------

/**
 * Führt `work` auf einem frisch initialisierten GeometryProcessor aus und gibt
 * das WASM-Handle danach deterministisch frei (Vorgabe von @ifc-lite/geometry).
 */
async function withProcessor<T>(
  work: (processor: GeometryProcessor, bytes: Uint8Array) => T,
  session: ModelSession,
): Promise<T> {
  const processor = new GeometryProcessor();
  try {
    const bytes = session.exportStep();
    await processor.init();
    return work(processor, bytes);
  } finally {
    processor.dispose();
  }
}

/** Ergebnis der Rust-Exporter prüfen: null heißt „Bridge nicht bereit". */
function requireBytes(result: Uint8Array | null, format: string): Uint8Array {
  if (!result || result.length === 0) {
    throw new Error(
      `${format}-Export fehlgeschlagen: Die Geometrie-Bridge lieferte keine Daten.`,
    );
  }
  return result;
}

/** glTF/GLB — binäre Rendergeometrie des aktuellen Sitzungsstands. */
export async function exportGlb(
  session: ModelSession,
): Promise<ExportArtifact> {
  try {
    const bytes = await withProcessor(
      (processor, source) =>
        requireBytes(processor.exportGlb(source, true), "GLB"),
      session,
    );
    return {
      fileName: `${baseName(session)}.glb`,
      bytes,
      mime: "model/gltf-binary",
    };
  } catch (error) {
    if (isNoRenderGeometryError(error)) {
      throw new Error(
        "GLB-Export fehlgeschlagen: Das Modell enthält keine darstellbare Geometrie.",
      );
    }
    throw error instanceof Error && error.message.startsWith("GLB-Export")
      ? error
      : failure("GLB", error);
  }
}

/** Deutsche Beschriftungen der CSV-Modi (Menü und Dateiname). */
export const CSV_MODE_LABELS: Readonly<Record<CsvMode, string>> = {
  entities: "Entitäten",
  properties: "Eigenschaften",
  quantities: "Mengen",
  spatial: "Struktur",
};

/** CSV — je nach Modus Entitäten, Eigenschaften, Mengen oder Struktur. */
export async function exportCsv(
  session: ModelSession,
  mode: CsvMode = "entities",
): Promise<ExportArtifact> {
  try {
    const bytes = await withProcessor(
      (processor, source) =>
        requireBytes(processor.exportCsv(source, mode), "CSV"),
      session,
    );
    return {
      fileName: `${baseName(session)}.${mode}.csv`,
      bytes,
      mime: "text/csv;charset=utf-8",
      text: UTF8.decode(bytes),
    };
  } catch (error) {
    throw error instanceof Error && error.message.startsWith("CSV-Export")
      ? error
      : failure("CSV", error);
  }
}

/** JSON-LD — verlinkte Daten mit Properties und Mengen. */
export async function exportJsonld(
  session: ModelSession,
): Promise<ExportArtifact> {
  try {
    const bytes = await withProcessor(
      (processor, source) =>
        requireBytes(
          processor.exportJsonld(source, undefined, true, true, true),
          "JSON-LD",
        ),
      session,
    );
    return {
      fileName: `${baseName(session)}.jsonld`,
      bytes,
      mime: "application/ld+json",
      text: UTF8.decode(bytes),
    };
  } catch (error) {
    throw error instanceof Error && error.message.startsWith("JSON-LD-Export")
      ? error
      : failure("JSON-LD", error);
  }
}

// ---------------------------------------------------------------------------
// Parquet / BOS
// ---------------------------------------------------------------------------

/**
 * Parquet-Paket im ara3d-BOS-Format (.bos ist ein ZIP mehrerer
 * Parquet-Tabellen). `ParquetExporter` braucht einen `IfcDataStore`, deshalb
 * werden die Exportbytes der Sitzung erneut geparst — nur so enthält das
 * Paket die Sitzungsänderungen.
 */
export async function exportBos(
  session: ModelSession,
): Promise<ExportArtifact> {
  try {
    const store = await new IfcParser().parseColumnar(
      toArrayBuffer(session.exportStep()),
    );
    const bytes = await new ParquetExporter(store).exportBOS();
    return {
      fileName: `${baseName(session)}.bos`,
      bytes,
      mime: "application/zip",
    };
  } catch (error) {
    throw failure("Parquet/BOS", error);
  }
}

// ---------------------------------------------------------------------------
// Verteiler für die Oberfläche
// ---------------------------------------------------------------------------

/** Beschriftungen der Formate im Exportmenü. */
export const FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  ifc: "IFC (STEP)",
  ifczip: "ifcZIP (gepackt)",
  glb: "glTF / GLB",
  csv: "CSV",
  jsonld: "JSON-LD",
  bos: "Parquet / BOS",
};

/** Führt einen Exportauftrag aus. Fehler sind bereits deutsch formuliert. */
export async function runExport(
  session: ModelSession,
  request: ExportRequest,
): Promise<ExportArtifact> {
  switch (request.format) {
    case "ifc":
      return exportIfc(session);
    case "ifczip":
      return exportIfcZip(session);
    case "glb":
      return exportGlb(session);
    case "csv":
      return exportCsv(session, request.mode);
    case "jsonld":
      return exportJsonld(session);
    case "bos":
      return exportBos(session);
  }
}
