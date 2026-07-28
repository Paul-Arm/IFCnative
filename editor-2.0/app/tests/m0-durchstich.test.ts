/**
 * M0-Verifikationstests (Roadmap M0):
 *  - Erzeugen: IfcCreator baut Projekt mit Wand + Tür-Öffnung (Element-Builder-Probe)
 *  - Roundtrip: parse → setProperty → Export mit applyMutations → Reparse → Wert korrekt
 *  - R2: bleiben unveränderte Entities beim Export byte-stabil? (Befund für 05-risiken)
 *  - R3: Umlaute/\X2\-Kodierung über @ifc-lite/encoding und im STEP-Roundtrip
 *  - GUID-Stabilität: Re-Export ändert keine GlobalIds (Basis der Hub-Versionierung)
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import {
  IfcParser,
  extractPropertiesOnDemand,
  type IfcDataStore,
} from "@ifc-lite/parser";
import { MutablePropertyView } from "@ifc-lite/mutations";
import { StepExporter } from "@ifc-lite/export";
import { decodeIfcString, encodeIfcString } from "@ifc-lite/encoding";
import { PropertyValueType } from "@ifc-lite/data";

const UMLAUT_NAME = "Überführung Straße 7 – Prüfkörper";

function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: UMLAUT_NAME });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  const wall = creator.addIfcWall(storey, {
    Name: "Wand A",
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.2,
    Height: 3,
  });
  creator.addIfcWallDoor(wall, {
    Name: "Tür 1",
    Position: [1.0, 0, 0],
    Width: 1.01,
    Height: 2.11,
  });
  return creator.toIfc().content;
}

async function parseText(text: string | Uint8Array): Promise<IfcDataStore> {
  const bytes =
    typeof text === "string" ? new TextEncoder().encode(text) : text;
  const parser = new IfcParser();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return parser.parseColumnar(buffer);
}

function toText(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

function firstIdOfType(store: IfcDataStore, type: string): number {
  const ids = store.entityIndex.byType.get(type) ?? [];
  expect(ids.length, `Modell enthält kein ${type}`).toBeGreaterThan(0);
  return ids[0];
}

function readProperty(
  store: IfcDataStore,
  entityId: number,
  psetName: string,
  propName: string,
): unknown {
  const psets = extractPropertiesOnDemand(store, entityId);
  const pset = psets.find((p) => p.name === psetName);
  return pset?.properties.find((p) => p.name === propName)?.value;
}

function dataLines(text: string): string[] {
  const start = text.indexOf("DATA;");
  const end = text.indexOf("ENDSEC;", start);
  return text
    .slice(start + 5, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe("M0: Erzeugen (Element-Builder-Probe)", () => {
  it("IfcCreator baut Projekt mit Wand und Tür-Öffnung", async () => {
    const text = createSampleIfc();
    expect(text).toContain("ISO-10303-21");
    const store = await parseText(text);
    expect(store.entityCount).toBeGreaterThan(0);
    firstIdOfType(store, "IFCWALL");
    firstIdOfType(store, "IFCDOOR");
    // Tür muss die Wand real durchdringen: Öffnung + Voids-/Fills-Beziehungen
    firstIdOfType(store, "IFCOPENINGELEMENT");
    firstIdOfType(store, "IFCRELVOIDSELEMENT");
    firstIdOfType(store, "IFCRELFILLSELEMENT");
  });
});

describe("M0: Mutations-Roundtrip", () => {
  it("setProperty → Export(applyMutations) → Reparse liefert den neuen Wert", async () => {
    const store = await parseText(createSampleIfc());
    const wallId = firstIdOfType(store, "IFCWALL");

    const view = new MutablePropertyView(store.properties, "m0");
    view.setProperty(
      wallId,
      "Pset_WallCommon",
      "FireRating",
      "REI 120",
      PropertyValueType.Label,
    );
    expect(view.getModifiedEntityCount()).toBe(1);

    const exported = new StepExporter(store, view).export({
      schema: "IFC4",
      applyMutations: true,
    });
    const reparsed = await parseText(toText(exported.content));
    const wallId2 = firstIdOfType(reparsed, "IFCWALL");
    expect(readProperty(reparsed, wallId2, "Pset_WallCommon", "FireRating")).toBe(
      "REI 120",
    );
  });

  it("Umlaut-Property überlebt den Roundtrip (R3)", async () => {
    const store = await parseText(createSampleIfc());
    const wallId = firstIdOfType(store, "IFCWALL");
    const view = new MutablePropertyView(store.properties, "m0");
    view.setProperty(
      wallId,
      "ePset_Objektinformation",
      "_Bezeichnung",
      UMLAUT_NAME,
      PropertyValueType.Label,
    );
    const exported = new StepExporter(store, view).export({
      schema: "IFC4",
      applyMutations: true,
    });
    const reparsed = await parseText(toText(exported.content));
    const wallId2 = firstIdOfType(reparsed, "IFCWALL");
    expect(
      readProperty(reparsed, wallId2, "ePset_Objektinformation", "_Bezeichnung"),
    ).toBe(UMLAUT_NAME);
  });
});

describe("M0: R3 — STEP-String-Kodierung (@ifc-lite/encoding)", () => {
  it("encode/decode ist verlustfrei für deutsche Sonderzeichen", () => {
    for (const s of [UMLAUT_NAME, "äöüÄÖÜß", "100 µm — „Test“"]) {
      expect(decodeIfcString(encodeIfcString(s))).toBe(s);
    }
  });

  it("Nicht-ASCII wird als STEP-Escape kodiert (kein rohes UTF-8 im STEP)", () => {
    const encoded = encodeIfcString("Ü");
    expect(encoded).not.toContain("Ü");
    expect(encoded).toMatch(/\\X2?\\/);
  });
});

describe("M0: R2 — Stabilität unveränderter Entities beim Export", () => {
  it("GlobalIds bleiben beim Re-Export identisch (Versionierungs-Basis)", async () => {
    const original = createSampleIfc();
    const store = await parseText(original);
    const exported = new StepExporter(store).export({ schema: "IFC4" });
    const guids = (t: string) =>
      [...t.matchAll(/'([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]).sort();
    expect(guids(toText(exported.content))).toEqual(guids(original));
  });

  it("Befund: Anteil byte-identischer DATA-Zeilen beim mutationsfreien Re-Export", async () => {
    const original = createSampleIfc();
    const store = await parseText(original);
    const exported = new StepExporter(store).export({ schema: "IFC4" });

    const before = new Set(dataLines(original));
    const after = dataLines(toText(exported.content));
    const identical = after.filter((l) => before.has(l)).length;
    const ratio = identical / after.length;
    // Befund wird geloggt und in 05-risiken-entscheidungen.md (R2) übernommen.
    console.info(
      `[R2] Re-Export: ${identical}/${after.length} DATA-Zeilen byte-identisch (${(ratio * 100).toFixed(1)} %)`,
    );
    // Harte Untergrenze: der Export darf das Modell nicht komplett neu formen.
    expect(ratio).toBeGreaterThan(0.5);
    // Semantik muss exakt erhalten bleiben:
    const reparsed = await parseText(toText(exported.content));
    expect(reparsed.entityCount).toBe(store.entityCount);
  });
});
