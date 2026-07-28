/**
 * M7-Verifikationstests: Exportformate und ifcZIP-Öffnen.
 *
 * Geprüft wird `src/domain/export/**`:
 *   - `archive.ts` — ifcZIP packen/entpacken und die Erkennung, die
 *     `store/documents.ts` vor dem Parsen benutzt (`resolveIfcSource`),
 *   - `formats.ts` — IFC, ifcZIP, CSV, JSON-LD, glTF/GLB, Parquet/BOS.
 *
 * Referenzkriterium ist wie in M2/M5 der Reparse: ein Format gilt erst als
 * korrekt, wenn der Weg Sitzung → Export → (Entpacken) → Parser dieselbe
 * Entitätenzahl liefert.
 *
 * BEFUND (Kernfrage): ALLE sechs Formate laufen im reinen Node-Kontext von
 * vitest durch — auch die WASM-gestützten (GLB, CSV, JSON-LD) über
 * `GeometryProcessor`, so wie es die Kollisionsquelle in
 * `src/domain/checks/sources/clash.ts` vormacht, und `ParquetExporter`
 * (parquet-wasm) für das BOS-Paket. Ein Skip ist an keiner Stelle nötig; die
 * Skip-Zweige unten dokumentieren nur, woran ein Ausfall läge.
 */
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { IfcCreator } from "@ifc-lite/create";
import { ModelSession } from "../src/core/session";
import {
  extractIfcFromArchive,
  isArchiveName,
  looksLikeZip,
  resolveIfcSource,
  zipSingleIfc,
} from "../src/domain/export/archive";
import {
  exportBos,
  exportCsv,
  exportGlb,
  exportIfc,
  exportIfcZip,
  exportJsonld,
  runExport,
} from "../src/domain/export/formats";

// ---------------------------------------------------------------------------
// Fixture & Helfer
// ---------------------------------------------------------------------------

/** Ein Geschoss mit drei Wänden — genug für Geometrie, Mengen und Struktur. */
function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M7-Export" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  for (let i = 0; i < 3; i++) {
    creator.addIfcWall(storey, {
      Name: `Wand ${i + 1}`,
      Start: [0, i * 3, 0],
      End: [4, i * 3, 0],
      Thickness: 0.24,
      Height: 3,
    });
  }
  return creator.toIfc().content;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function openSession(
  text: string,
  fileName = "m7.ifc",
): Promise<ModelSession> {
  return ModelSession.open(fileName, toBuffer(new TextEncoder().encode(text)));
}

/** Sitzung aus beliebigen Modellbytes (z. B. einem Archiv-Eintrag). */
async function openBytes(
  fileName: string,
  bytes: Uint8Array,
): Promise<ModelSession> {
  return ModelSession.open(fileName, toBuffer(bytes));
}

const TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// ifcZIP: packen, entpacken, reparsen
// ---------------------------------------------------------------------------

describe("ifcZIP-Export", () => {
  it("Roundtrip IFC → ifcZIP → entpacken → reparsen erhält die Entitätenzahl", async () => {
    const session = await openSession(createSampleIfc());
    const before = session.info().entityCount;

    const artifact = exportIfcZip(session);
    expect(artifact.fileName.endsWith(".ifczip")).toBe(true);
    expect(artifact.mime).toBe("application/zip");
    expect(looksLikeZip(artifact.bytes)).toBe(true);

    // Genau ein Eintrag, und der trägt die .ifc-Endung.
    const entries = Object.keys(unzipSync(artifact.bytes));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/\.ifc$/i);

    const extracted = extractIfcFromArchive(artifact.bytes);
    expect(extracted.fromArchive).toBe(true);
    // Der entpackte Inhalt ist byte-identisch zum direkten IFC-Export.
    expect(extracted.bytes).toEqual(exportIfc(session).bytes);

    const reparsed = await openBytes(extracted.fileName, extracted.bytes);
    expect(reparsed.info().entityCount).toBe(before);
  });

  it("meldet ein Archiv ohne IFC-Datei auf Deutsch", () => {
    const archive = zipSingleIfc("liesmich.txt", new TextEncoder().encode("x"));
    expect(() => extractIfcFromArchive(archive)).toThrow(
      "Archiv enthält keine IFC-Datei",
    );
  });
});

// ---------------------------------------------------------------------------
// Öffnen-Pfad: die Logik, die openDocument vor dem Parsen ausführt
// ---------------------------------------------------------------------------

describe("ifcZIP öffnen (resolveIfcSource, wie in store/documents.ts)", () => {
  it("gezippte Bytes ergeben eine Sitzung mit korrektem entityCount", async () => {
    const original = await openSession(createSampleIfc(), "quelle.ifc");
    const expected = original.info().entityCount;
    const archive = zipSingleIfc("modell.ifc", original.exportStep());

    const source = resolveIfcSource("modell.ifczip", archive);
    expect(source.fromArchive).toBe(true);
    // Der Eintragsname wird zum Sitzungsnamen, nicht der Archivname.
    expect(source.fileName).toBe("modell.ifc");

    const session = await openBytes(source.fileName, source.bytes);
    expect(session.info().entityCount).toBe(expected);
    expect(session.fileName).toBe("modell.ifc");
  });

  it("erkennt Archive auch an der PK-Signatur bei falscher Endung", async () => {
    const original = await openSession(createSampleIfc());
    const archive = zipSingleIfc("modell.ifc", original.exportStep());

    expect(isArchiveName("falsch.ifc")).toBe(false);
    const source = resolveIfcSource("falsch.ifc", archive);
    expect(source.fromArchive).toBe(true);

    const session = await openBytes(source.fileName, source.bytes);
    expect(session.info().entityCount).toBe(original.info().entityCount);
  });

  it("reicht gewöhnliche IFC-Bytes unverändert durch", () => {
    const bytes = new TextEncoder().encode("ISO-10303-21;");
    const source = resolveIfcSource("modell.ifc", bytes);
    expect(source.fromArchive).toBe(false);
    expect(source.fileName).toBe("modell.ifc");
    expect(source.bytes).toBe(bytes);
  });
});

// ---------------------------------------------------------------------------
// Datenformate
// ---------------------------------------------------------------------------

describe("Datenexporte", () => {
  it(
    "CSV liefert je Modus eine Kopfzeile",
    async () => {
      const session = await openSession(createSampleIfc());
      const modes = ["entities", "properties", "quantities", "spatial"] as const;
      for (const mode of modes) {
        const artifact = await exportCsv(session, mode);
        expect(artifact.fileName).toBe(`m7.${mode}.csv`);
        expect(artifact.mime).toMatch(/^text\/csv/);
        const header = (artifact.text ?? "").split("\n")[0];
        // Kopfzeile: mindestens zwei durch Komma getrennte Spalten.
        expect(header.split(",").length).toBeGreaterThan(1);
        expect(header).toMatch(/^[A-Za-z]/);
      }
      // Der Entitäten-Modus führt die Bauteile auch inhaltlich.
      const entities = await exportCsv(session, "entities");
      expect(entities.text).toContain("IfcWall");
    },
    TIMEOUT_MS,
  );

  it(
    "JSON-LD ist gültiges JSON mit @context",
    async () => {
      const session = await openSession(createSampleIfc());
      const artifact = await exportJsonld(session);
      expect(artifact.fileName).toBe("m7.jsonld");
      expect(artifact.mime).toBe("application/ld+json");
      const parsed = JSON.parse(artifact.text ?? "") as Record<string, unknown>;
      expect(parsed["@context"]).toBeDefined();
    },
    TIMEOUT_MS,
  );

  it(
    "Parquet/BOS liefert ein ZIP-Paket mit Inhalt",
    async () => {
      const session = await openSession(createSampleIfc());
      const artifact = await exportBos(session);
      expect(artifact.fileName).toBe("m7.bos");
      expect(artifact.bytes.length).toBeGreaterThan(0);
      // .bos ist laut @ifc-lite/export ein ZIP mehrerer Parquet-Tabellen.
      expect(looksLikeZip(artifact.bytes)).toBe(true);
      expect(Object.keys(unzipSync(artifact.bytes)).length).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it(
    "glTF/GLB liefert einen gültigen GLB-Container",
    async () => {
      const session = await openSession(createSampleIfc());
      const artifact = await exportGlb(session);
      expect(artifact.fileName).toBe("m7.glb");
      expect(artifact.mime).toBe("model/gltf-binary");
      // GLB-Magic „glTF" + Version 2 im Header.
      const header = new DataView(toBuffer(artifact.bytes));
      expect(header.getUint32(0, true)).toBe(0x46546c67);
      expect(header.getUint32(4, true)).toBe(2);
      expect(header.getUint32(8, true)).toBe(artifact.bytes.length);
    },
    TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Verteiler
// ---------------------------------------------------------------------------

describe("runExport", () => {
  it(
    "bedient jedes Format des Exportmenüs",
    async () => {
      const session = await openSession(createSampleIfc());
      const artifacts = await Promise.all([
        runExport(session, { format: "ifc" }),
        runExport(session, { format: "ifczip" }),
        runExport(session, { format: "csv", mode: "spatial" }),
        runExport(session, { format: "jsonld" }),
        runExport(session, { format: "glb" }),
        runExport(session, { format: "bos" }),
      ]);
      for (const artifact of artifacts) {
        expect(artifact.bytes.length).toBeGreaterThan(0);
        expect(artifact.fileName.startsWith("m7.")).toBe(true);
        expect(artifact.mime.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS,
  );

  it("Fehlermeldungen sind deutsch formuliert", async () => {
    const session = await openSession(createSampleIfc());
    // Ein kaputter StepExporter-Lauf ist nicht erzwingbar; geprüft wird die
    // Formulierung der Hülle, die jede Formatfunktion benutzt.
    const broken = {
      exportStep() {
        throw new Error("Testfehler");
      },
      fileName: session.fileName,
    } as unknown as ModelSession;
    expect(() => exportIfc(broken)).toThrow(
      "IFC-Export fehlgeschlagen: Testfehler",
    );
    await expect(exportBos(broken)).rejects.toThrow(
      "Parquet/BOS-Export fehlgeschlagen: Testfehler",
    );
  });
});
