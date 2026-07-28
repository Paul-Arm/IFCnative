/**
 * Geometrie-Beschaffung für die 2D-Ableitung.
 *
 * @ifc-lite/drawing-2d schneidet `MeshData[]` aus @ifc-lite/geometry — es gibt
 * keinen Store-Pfad. Beschafft wird die Geometrie wie in
 * `domain/checks/sources/clash.ts`: `session.exportStep()` liefert die Bytes
 * des SITZUNGSSTANDS (inkl. Edits und Tombstones), `GeometryProcessor.process`
 * tesselliert daraus. Der Pass ist teuer, deshalb läuft er nur auf Klick und
 * das Ergebnis wird im Pane je Dokument-Revision gehalten.
 *
 * Koordinaten: die Meshes liegen in der Y-up-Welt des Renderers in Metern und
 * sind ggf. RTC-verschoben (große Landeskoordinaten). Deshalb wird die
 * Schnitthöhe NICHT direkt aus dem IFC-Attribut `Elevation` gebildet, sondern
 * aus der Geometrie der Geschosselemente: `storeyLevel()` nimmt das
 * 25-%-Quantil der Mesh-Unterkanten des Geschosses. Das ist einheiten- und
 * RTC-fest; einzelne tiefer liegende Bauteile (Fundamente, Unterzüge) ziehen
 * den Bezug nicht nach unten. Erst wenn ein Geschoss gar keine Geometrie hat,
 * greift `Elevation` als Rückfallwert.
 */
import { GeometryProcessor, type MeshData } from "@ifc-lite/geometry";
import type { ModelSession } from "../../core/session";

export interface MeshBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface MeshSource {
  meshes: MeshData[];
  bounds: MeshBounds;
  /** Dokument-Revision, aus der diese Meshes stammen. */
  revision: number;
}

const EMPTY_BOUNDS: MeshBounds = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minZ: 0,
  maxZ: 0,
};

/** Achsenparallele Hülle aller Meshes (Renderer-Koordinaten, Meter). */
export function meshBounds(meshes: readonly MeshData[]): MeshBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      if (p[i] < minX) minX = p[i];
      if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 1] > maxY) maxY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2];
      if (p[i + 2] > maxZ) maxZ = p[i + 2];
    }
  }
  return Number.isFinite(minX)
    ? { minX, maxX, minY, maxY, minZ, maxZ }
    : { ...EMPTY_BOUNDS };
}

/** Sitzungsstand nach STEP exportieren und tessellieren. */
export async function loadMeshes(
  session: ModelSession,
  revision: number,
): Promise<MeshSource> {
  const processor = new GeometryProcessor();
  try {
    await processor.init();
    const result = await processor.process(session.exportStep());
    // Die Meshes sind reine JS-Arrays (die Bridge kopiert sie beim Extrahieren
    // aus dem WASM-Speicher), sie überleben `dispose()` also gefahrlos.
    return {
      meshes: result.meshes,
      bounds: meshBounds(result.meshes),
      revision,
    };
  } finally {
    processor.dispose();
  }
}

/**
 * Bezugshöhe eines Geschosses in Mesh-Koordinaten (Y, Meter).
 * `fallback` ist die IFC-Höhenlage; sie greift nur ohne Geschossgeometrie.
 */
export function storeyLevel(
  meshes: readonly MeshData[],
  elementIds: readonly number[],
  fallback: number,
): number {
  const wanted = new Set(elementIds);
  const lows: number[] = [];
  for (const mesh of meshes) {
    if (!wanted.has(mesh.expressId)) continue;
    const p = mesh.positions;
    let low = Infinity;
    for (let i = 1; i < p.length; i += 3) if (p[i] < low) low = p[i];
    if (Number.isFinite(low)) lows.push(low);
  }
  if (lows.length === 0) return fallback;
  lows.sort((a, b) => a - b);
  return lows[Math.floor(lows.length * 0.25)];
}
