/**
 * M9-Verifikationstests: Verschiebe-Gizmo und Koordinaten-Pick — reine Logik
 * ohne WebGPU/DOM.
 *
 * Geprüft wird
 *   - `panes/viewer/worldCoords.ts`  (Rahmen-Swap IFC Z-up ↔ Renderer Y-up,
 *                                     RTC-Verschiebung, deutsche Formatierung,
 *                                     Zwischenablage-Format „x; y; z")
 *   - `panes/viewer/pickStore.ts`    (letzter Punkt + Verlauf, Limit 5)
 *   - `panes/viewer/gizmoMath.ts`    (Achsen-Drag-Parameter, Typ-Heuristik)
 *   - Drag-Delta → cmdMoveElement    (die Gizmo-Deltas landen 1:1 als
 *                                     dx/dy/dz-Meter am Placement-Punkt)
 *
 * Der Rahmen-Swap folgt der in @ifc-lite dokumentierten Konstanten
 * SWAP_ZUP_TO_YUP: IFC (x, y, z) → Renderer (x, z, -y); Renderer-Welt ist
 * bereits in Metern (unit_scale angewandt), lengthUnitScale greift erst beim
 * Zurückschreiben (toNative in domain/geometry).
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { ModelSession } from "../src/core/session";
import { useCommands } from "../src/commands/pipeline";
import { cmdMoveElement } from "../src/commands/geometryCommands";
import { findPlacementPoint } from "../src/domain/geometry";
import {
  formatMeter,
  formatPointClipboard,
  formatPointStatus,
  ifcToRendererDelta,
  ifcToRendererPoint,
  rendererToIfcDelta,
  rendererToIfcPoint,
  roundMm,
} from "../src/panes/viewer/worldCoords";
import { PICK_HISTORY_LIMIT, usePickStore } from "../src/panes/viewer/pickStore";
import {
  GIZMO_AXES,
  axisRayParam,
  dragDeltaIfc,
  gizmoArmLength,
  isMovableTypeName,
  isNoticeableDelta,
} from "../src/panes/viewer/gizmoMath";

const NO_SHIFT = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
// worldCoords: Rahmen-Swap + Formatierung
// ---------------------------------------------------------------------------

describe("M9: worldCoords — Swap, RTC-Shift, Formatierung", () => {
  it("wendet den dokumentierten Swap an: IFC (x,y,z) → Renderer (x,z,-y)", () => {
    expect(ifcToRendererPoint({ x: 1, y: 2, z: 3 }, NO_SHIFT)).toEqual({
      x: 1,
      y: 3,
      z: -2,
    });
    expect(rendererToIfcPoint({ x: 1, y: 3, z: -2 }, NO_SHIFT)).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it("Punkt-Roundtrip inkl. RTC-originShift ist verlustfrei", () => {
    const shift = { x: 400000, y: 5300000, z: 12.5 };
    const ifc = { x: 400010.25, y: 5300003.5, z: 15.75 };
    const renderer = ifcToRendererPoint(ifc, shift);
    // Renderer-Rahmen ist RTC-verschoben (kleine Zahlen nahe 0).
    expect(renderer).toEqual({ x: 10.25, y: 3.25, z: -3.5 });
    expect(rendererToIfcPoint(renderer, shift)).toEqual(ifc);
  });

  it("Delta-Varianten sind translationsfrei (kein Shift)", () => {
    expect(ifcToRendererDelta({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 3, z: -2 });
    expect(rendererToIfcDelta({ x: 1, y: 3, z: -2 })).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("formatiert deutsch mit 3 Nachkommastellen, ohne -0,000", () => {
    expect(formatMeter(1.2345)).toBe("1,235");
    expect(formatMeter(-0.0001)).toBe("0,000");
    expect(formatMeter(-2.5)).toBe("-2,500");
    expect(formatPointStatus({ x: 1, y: 2.25, z: 0 })).toBe(
      "1,000 / 2,250 / 0,000 m",
    );
  });

  it("Zwischenablage-Format ist x; y; z (Semikolon-getrennt)", () => {
    expect(formatPointClipboard({ x: 12.5, y: -3.2, z: 0.0004 })).toBe(
      "12,500; -3,200; 0,000",
    );
  });

  it("roundMm rundet auf Millimeter", () => {
    expect(roundMm(1.23456)).toBe(1.235);
    expect(roundMm(-0.0004)).toBe(-0);
  });
});

// ---------------------------------------------------------------------------
// pickStore: letzter Punkt + Verlauf
// ---------------------------------------------------------------------------

describe("M9: pickStore — letzter Punkt und Verlauf (Limit 5)", () => {
  it("hält den jüngsten Punkt vorn und kappt den Verlauf bei 5", () => {
    const store = usePickStore.getState();
    store.clear();
    for (let i = 1; i <= 7; i++) {
      usePickStore.getState().setPoint("doc-a", { x: i, y: 0, z: 0 });
    }
    const state = usePickStore.getState();
    expect(state.last?.x).toBe(7);
    expect(state.history).toHaveLength(PICK_HISTORY_LIMIT);
    expect(state.history[0]).toBe(state.last);
    expect(state.history.map((p) => p.x)).toEqual([7, 6, 5, 4, 3]);
    expect(state.last?.docId).toBe("doc-a");

    usePickStore.getState().clear();
    expect(usePickStore.getState().last).toBeNull();
    expect(usePickStore.getState().history).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// gizmoMath: Achsen-Drag und Heuristiken
// ---------------------------------------------------------------------------

describe("M9: gizmoMath — Achsen-Drag, Typ-Heuristik", () => {
  it("axisRayParam trifft den Parameter des nächsten Achsenpunkts", () => {
    // Achse = Renderer-X durch den Ursprung; Strahl zielt aus +Z senkrecht
    // auf den Punkt (2, 0, 0) → s = 2.
    const s = axisRayParam(
      { origin: { x: 2, y: 0, z: 5 }, direction: { x: 0, y: 0, z: -1 } },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    expect(s).not.toBeNull();
    expect(s!).toBeCloseTo(2, 10);
  });

  it("axisRayParam liefert null bei (fast) parallelem Strahl", () => {
    const s = axisRayParam(
      { origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    expect(s).toBeNull();
  });

  it("dragDeltaIfc übersetzt den Achsenparameter in IFC-Deltas", () => {
    const [ax, ay, az] = GIZMO_AXES;
    const close = (
      got: { x: number; y: number; z: number },
      want: [number, number, number],
    ): void => {
      expect(got.x).toBeCloseTo(want[0], 12);
      expect(got.y).toBeCloseTo(want[1], 12);
      expect(got.z).toBeCloseTo(want[2], 12);
    };
    close(dragDeltaIfc(ax, 1.5), [1.5, 0, 0]);
    // IFC-Y zeigt im Renderer nach -Z; ds entlang des Pfeils bleibt +Y in IFC.
    close(dragDeltaIfc(ay, 0.75), [0, 0.75, 0]);
    close(dragDeltaIfc(az, -2), [0, 0, -2]);
  });

  it("Typname-Heuristik: räumliche Struktur ist unbeweglich", () => {
    expect(isMovableTypeName("IfcWallStandardCase")).toBe(true);
    expect(isMovableTypeName("IfcDoor")).toBe(true);
    expect(isMovableTypeName("IfcBuildingStorey")).toBe(false);
    expect(isMovableTypeName("IFCPROJECT")).toBe(false);
    expect(isMovableTypeName("ifcspace")).toBe(false);
    expect(isMovableTypeName("IfcSite")).toBe(false);
  });

  it("isNoticeableDelta filtert Sub-Millimeter-Drags", () => {
    expect(isNoticeableDelta({ x: 0.0001, y: 0, z: 0 })).toBe(false);
    expect(isNoticeableDelta({ x: 0, y: 0, z: 0.001 })).toBe(true);
  });

  it("gizmoArmLength bleibt zwischen 0,6 m und 4 m", () => {
    expect(gizmoArmLength(0.1)).toBe(0.6);
    expect(gizmoArmLength(4)).toBeCloseTo(1.4, 10);
    expect(gizmoArmLength(100)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Drag-Delta → cmdMoveElement (Integration ohne Renderer)
// ---------------------------------------------------------------------------

function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M9-Gizmo" });
  const storey = creator.addIfcBuildingStorey({ Name: "EG", Elevation: 0 });
  creator.addIfcWall(storey, {
    Name: "Wand",
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.2,
    Height: 3,
  });
  return creator.toIfc().content;
}

async function openSession(text: string): Promise<ModelSession> {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return ModelSession.open("m9.ifc", buffer);
}

describe("M9: Gizmo-Delta läuft 1:1 als cmdMoveElement durch die Pipeline", () => {
  it("verschiebt den Placement-Punkt um das IFC-Delta (Meter) und ist undo-bar", async () => {
    const session = await openSession(createSampleIfc());
    const wallId = (session.store.entityIndex.byType.get("IFCWALL") ??
      session.store.entityIndex.byType.get("IFCWALLSTANDARDCASE") ??
      [])[0];
    expect(wallId, "Fixture ohne Wand").toBeDefined();

    const source = { store: session.store, view: session.view };
    const before = findPlacementPoint(source, wallId)!.coords;

    // Drag entlang der Y-Gizmo-Achse um 0,75 m (Parameterdifferenz).
    const delta = dragDeltaIfc(GIZMO_AXES[1], 0.75);
    const command = cmdMoveElement(session, wallId, delta.x, delta.y, delta.z);
    useCommands.getState().execute("m9-doc", command);

    const after = findPlacementPoint(source, wallId)!.coords;
    expect(after[0]).toBeCloseTo(before[0] + delta.x, 9);
    expect(after[1]).toBeCloseTo(before[1] + delta.y, 9);
    expect(after[2]).toBeCloseTo(before[2] + delta.z, 9);
    expect(command.label).toContain("verschoben");

    useCommands.getState().undo("m9-doc");
    const reverted = findPlacementPoint(source, wallId)!.coords;
    expect(reverted).toEqual(before);
  });
});
