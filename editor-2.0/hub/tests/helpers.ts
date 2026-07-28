/**
 * Gemeinsame Testbausteine: temporäres Datenverzeichnis und ein kleines,
 * echtes IFC-Modell aus `@ifc-lite/create`.
 *
 * Wichtiger Befund, der die Bauart der Diff-Tests bestimmt: `IfcCreator`
 * vergibt bei **jedem** Lauf frische GlobalIds. Zwei getrennt erzeugte
 * Modelle haben daher keine gemeinsame Identität und ergäben einen Diff aus
 * lauter added/removed. Der realistische Fall — bearbeiten und neu
 * exportieren — hält die GlobalIds stabil (bestätigt in
 * `app/tests/m0-durchstich.test.ts`, Risiko R2). Genau das bildet
 * `withChangedProperty()` nach: ein Modell, eine geänderte Property.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IfcCreator } from "@ifc-lite/create";

/** Property, die zwischen Basis- und Folgestand verändert wird. */
export const FIRE_RATING_BASE = "F90";
export const FIRE_RATING_HEAD = "F60";

/** Name der Wand, die im Folgestand geändert wird. */
export const CHANGED_WALL = "Wand A";
/** Name der Wand, die unverändert bleibt (Gegenprobe). */
export const STABLE_WALL = "Wand B";

/**
 * Baut ein IFC4-Modell mit zwei Wänden; beide tragen `Pset_WallCommon` mit
 * einer `FireRating`-Property. Rückgabe ist der STEP-Text.
 */
export function buildModel(): string {
  const creator = new IfcCreator({ Name: "Hub-Testprojekt" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  const wallA = creator.addIfcWall(storey, {
    Name: CHANGED_WALL,
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.2,
    Height: 3,
  });
  creator.addIfcPropertySet(wallA, {
    Name: "Pset_WallCommon",
    Properties: [
      { Name: "FireRating", NominalValue: FIRE_RATING_BASE },
      { Name: "IsExternal", NominalValue: true },
    ],
  });
  const wallB = creator.addIfcWall(storey, {
    Name: STABLE_WALL,
    Start: [0, 0, 0],
    End: [0, 4, 0],
    Thickness: 0.2,
    Height: 3,
  });
  creator.addIfcPropertySet(wallB, {
    Name: "Pset_WallCommon",
    Properties: [
      { Name: "FireRating", NominalValue: "F30" },
      { Name: "IsExternal", NominalValue: false },
    ],
  });
  return creator.toIfc().content;
}

/**
 * Folgestand desselben Modells: genau eine Property hat einen anderen Wert,
 * alle GlobalIds bleiben identisch — wie nach einem Edit + Re-Export.
 */
export function withChangedProperty(base: string): string {
  const head = base.replace(`'${FIRE_RATING_BASE}'`, `'${FIRE_RATING_HEAD}'`);
  if (head === base) {
    throw new Error(
      `Testmodell enthält '${FIRE_RATING_BASE}' nicht — Helfer anpassen.`,
    );
  }
  return head;
}

export function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Legt ein leeres Datenverzeichnis an und gibt Pfad + Aufräumfunktion zurück. */
export async function tempDataDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ifc-hub-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
