/**
 * Prüfquelle „Kollisionen" (M6) über @ifc-lite/clash.
 *
 * API-Befund (README + d.ts von @ifc-lite/clash 1.6.3): der Kern ist
 * repräsentationsagnostisch und arbeitet auf `ClashElement[]` mit fertigen
 * Welt-Dreiecken. Für STEP-Modelle liefert der Adapter
 * `@ifc-lite/clash/step` (`elementsFromStep`) diese Elemente — er braucht
 * NEBEN dem `IfcDataStore` zwingend `MeshData[]` aus @ifc-lite/geometry.
 * Ohne Geometrie gibt es also keine Kollisionsprüfung.
 *
 * Deshalb der Ablauf hier:
 *   1. Sitzung nach STEP exportieren (`session.exportStep()`) — so fließen
 *      Sitzungsänderungen, neue Bauteile und Tombstones mit ein,
 *   2. `GeometryProcessor.process()` über genau diese Bytes (WASM; läuft auch
 *      im Node-Test),
 *   3. denselben Byte-Stand parsen, damit Meshes und Store dieselben
 *      expressIds führen (der StepExporter behält die Ids bei, die Befunde
 *      bleiben damit an der Sitzung anwählbar),
 *   4. `elementsFromStep` + `createClashEngine().run()`.
 *
 * Der Adapter schließt Räume, Öffnungen und virtuelle Elemente selbst aus und
 * liefert Paar-Ausschlüsse (Wand ↔ Tür ihrer Öffnung, Bauteile derselben
 * Baugruppe) als `exclusions` mit.
 *
 * Fehlt die Geometrie-Umgebung (kein WASM, kein Speicher), endet der Lauf
 * nicht mit einer Ausnahme, sondern mit einem Hinweis-Befund — das Prüfzentrum
 * bleibt bedienbar.
 */
import { createClashEngine, type Clash, type ClashRule } from "@ifc-lite/clash";
import { elementsFromStep } from "@ifc-lite/clash/step";
import { GeometryProcessor } from "@ifc-lite/geometry";
import { IfcParser } from "@ifc-lite/parser";
import type { ModelSession } from "../../../core/session";
import type { CheckRunResult } from "../types";
import { FindingCollector, formatNumber } from "./shared";

export interface ClashRunOptions {
  /** Eigene Regelmatrix; Vorgabe ist „alles gegen alles" (harte Konflikte). */
  rules?: ClashRule[];
  /** Berührungsband in Metern (Vorgabe der Engine: 2 mm). */
  tolerance?: number;
}

/**
 * Vorgabe-Regel: eine Selbstkollision über alle Bauteile. `a: "*"` ohne `b`
 * ist laut d.ts genau das (Self-Clash innerhalb der Auswahl A).
 */
const DEFAULT_RULES: readonly ClashRule[] = [
  {
    id: "bauteile",
    name: "Bauteile gegen Bauteile",
    a: "*",
    mode: "hard",
  },
];

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Lesbare Bezeichnung eines Kollisionspartners. */
function describe(
  session: ModelSession,
  side: { ref: number; name?: string; tag: string },
): string {
  if (session.store.entityIndex.byId.has(side.ref)) {
    return session.labelOf(side.ref);
  }
  return side.name
    ? `${side.tag} ‚${side.name}' (#${side.ref})`
    : `${side.tag} (#${side.ref})`;
}

/** Distanz in Millimetern, als Durchdringung oder Abstand formuliert. */
function distanceText(clash: Clash): string {
  const millimetres = Math.abs(clash.distance) * 1000;
  return clash.distance < 0
    ? `Durchdringung ${formatNumber(millimetres)} mm`
    : `Abstand ${formatNumber(millimetres)} mm`;
}

/** Kollisionsprüfung über die aktuelle Sitzung ausführen. */
export async function run(
  session: ModelSession,
  options: ClashRunOptions = {},
): Promise<CheckRunResult> {
  const collector = new FindingCollector("clash");
  const processor = new GeometryProcessor();
  try {
    const bytes = session.exportStep();
    await processor.init();
    const geometry = await processor.process(bytes);
    const store = await new IfcParser().parseColumnar(toArrayBuffer(bytes));
    const { elements, exclusions } = elementsFromStep({
      store,
      meshes: geometry.meshes,
      modelId: session.fileName,
    });
    if (elements.length === 0) {
      collector.add({
        kind: "clash-no-geometry",
        severity: "info",
        message:
          "Die Kollisionsprüfung fand keine geometrischen Bauteile im Modell.",
        entityIds: [],
      });
      return collector.result(0);
    }

    const rules = options.rules ?? [...DEFAULT_RULES];
    const result = await createClashEngine({ backend: "auto" }).run(
      elements,
      rules,
      { exclusions, tolerance: options.tolerance },
    );

    for (const clash of result.clashes) {
      collector.add({
        kind: clash.status === "clearance" ? "clearance" : "hard-clash",
        severity: "warning",
        message: `${describe(session, clash.a)} kollidiert mit ${describe(session, clash.b)}`,
        entityIds: [clash.a.ref, clash.b.ref],
        detail: `${distanceText(clash)} · Regel „${clash.rule}" · Einstufung ${clash.severity}`,
      });
    }
    if (result.truncated) {
      collector.add({
        kind: "clash-truncated",
        severity: "info",
        message: `Die Kollisionsprüfung wurde gekürzt: ${result.truncated.droppedPairs} Paarungen wurden nicht geprüft.`,
        entityIds: [],
        detail: result.truncated.reason,
      });
    }
    return collector.result(elements.length);
  } catch (error) {
    collector.add({
      kind: "clash-unavailable",
      severity: "info",
      message: `Die Kollisionsprüfung ist in dieser Umgebung nicht verfügbar: ${
        error instanceof Error ? error.message : String(error)
      }`,
      entityIds: [],
    });
    return collector.result(0);
  } finally {
    // WASM-Handle deterministisch freigeben (Vorgabe von @ifc-lite/geometry).
    processor.dispose();
  }
}
