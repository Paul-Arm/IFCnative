/**
 * ZIP-Hülle für IFC-Modelle (M7).
 *
 * Ein ifcZIP ist laut buildingSMART nichts anderes als ein ZIP-Archiv mit
 * genau einer STEP-Datei darin. Gepackt und entpackt wird mit fflate
 * (synchron, ohne Worker) — die Datei bleibt damit auch im Tauri-Kontext
 * ohne zusätzliche Rust-Kommandos benutzbar.
 *
 * Die Entpack-Logik steht bewusst hier und nicht im zustand-Store: so kann
 * `tests/m7-export.test.ts` sie ohne React/zustand direkt prüfen, und
 * `store/documents.ts` bleibt ein dünner Aufrufer.
 */
import { unzipSync, zipSync } from "fflate";

/** MIME-Typ für .ifczip-Downloads. */
export const IFCZIP_MIME = "application/zip";

/** Ein Eintrag aus einem Archiv bzw. die unveränderte Eingabedatei. */
export interface IfcSource {
  fileName: string;
  bytes: Uint8Array;
  /** true, wenn die Bytes aus einem ZIP-Archiv stammen. */
  fromArchive: boolean;
}

/** Endungen, die als IFC-Nutzlast innerhalb eines Archivs gelten. */
const IFC_ENTRY_PATTERN = /\.(ifc|step|stp)$/i;

/** Dateinamen, die auf ein Archiv hindeuten. */
const ARCHIVE_NAME_PATTERN = /\.(ifczip|zip)$/i;

/** ZIP-Signatur „PK\x03\x04" am Dateianfang. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Heißt die Datei nach einem Archiv (.ifczip/.zip)? */
export function isArchiveName(fileName: string): boolean {
  return ARCHIVE_NAME_PATTERN.test(fileName);
}

/**
 * Packt genau eine IFC-Datei in ein ifcZIP-Archiv.
 * Der Eintragsname behält die .ifc-Endung, das Archiv bekommt .ifczip.
 */
export function zipSingleIfc(
  entryName: string,
  bytes: Uint8Array,
): Uint8Array {
  // Kein eigenes mtime: das ZIP-Format kennt nur 1980–2099, fflate wirft
  // sonst („date not in range 1980-2099"). Die aktuelle Zeit ist korrekt.
  return zipSync({ [entryName]: bytes }, { level: 6 });
}

/**
 * Holt die erste IFC-/STEP-Datei aus einem ZIP-Archiv.
 * Wirft eine deutsche Meldung, wenn keine enthalten ist.
 */
export function extractIfcFromArchive(bytes: Uint8Array): IfcSource {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Archiv konnte nicht gelesen werden: ${detail}`);
  }
  // Verzeichnis-Einträge (0 Byte, endend auf „/") und Metadaten-Ordner der
  // Betriebssysteme (__MACOSX) fallen über das Endungsmuster ohnehin heraus.
  for (const [name, content] of Object.entries(entries)) {
    if (IFC_ENTRY_PATTERN.test(name)) {
      return {
        // Der Sitzungsname soll ohne Archiv-Pfad auskommen.
        fileName: name.split("/").pop() ?? name,
        bytes: content,
        fromArchive: true,
      };
    }
  }
  throw new Error("Archiv enthält keine IFC-Datei");
}

/**
 * Normalisiert eine geöffnete Datei: Archive werden ausgepackt, alles
 * andere unverändert durchgereicht. Erkennung über Dateinamen ODER
 * ZIP-Signatur — falsch benannte Archive werden so ebenfalls geöffnet.
 */
export function resolveIfcSource(
  fileName: string,
  bytes: Uint8Array,
): IfcSource {
  if (isArchiveName(fileName) || looksLikeZip(bytes)) {
    return extractIfcFromArchive(bytes);
  }
  return { fileName, bytes, fromArchive: false };
}
