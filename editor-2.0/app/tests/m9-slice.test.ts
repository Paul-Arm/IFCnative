/**
 * M9-Verifikationstests: Schneiden (Slice) + Clip-Box — reine Logik ohne
 * WebGPU/DOM.
 *
 * Geprüft wird
 *   - `panes/viewer/sliceMath.ts`    (Box-Vereinigung, 10-%-Rand,
 *                                     IFC ↔ Renderer-AABB-Umrechnung inkl.
 *                                     RTC-Verschiebung, Flächen-Patch,
 *                                     Drag-/Rad-Mapping, Ecken/Kanten)
 *   - `panes/viewer/section.ts`      (toSectionPlane trägt `flipped`)
 *   - `panes/viewer/sectionStore.ts` (Position klemmen, Box-Nonce, Reset)
 *
 * Renderer-Fakten hinter den Erwartungen: `RenderOptions.clipBox` ist eine
 * achsparallele Box im Renderer-Weltraum ({min,max,enabled}), unabhängig von
 * der (genau EINEN) `sectionPlane`; der Achsentausch IFC → Renderer ist
 * (x, y, z) → (x, z, −y), eine AABB bleibt also eine AABB, die IFC-Y-Spanne
 * entsteht aus der negierten Renderer-Z-Spanne.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SECTION, toSectionPlane } from "../src/panes/viewer/section";
import { useSectionStore } from "../src/panes/viewer/sectionStore";
import {
  BOX_EDGES,
  boxCorners,
  clampPercent,
  dragPositionDelta,
  expandBox,
  ifcBoxToRenderer,
  patchBoxSide,
  rendererBoxToIfc,
  toClipBox,
  unionBounds,
  wheelPositionStep,
  type AxisBox,
} from "../src/panes/viewer/sliceMath";

const NO_SHIFT = { x: 0, y: 0, z: 0 };

function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): AxisBox {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

describe("sliceMath · Bounds", () => {
  it("vereinigt mehrere Boxen achsweise", () => {
    const u = unionBounds([box(0, 0, 0, 1, 1, 1), box(-2, 0.5, 0.5, 0.5, 3, 0.75)]);
    expect(u).toEqual(box(-2, 0, 0, 1, 3, 1));
  });

  it("liefert null für leere Eingabe", () => {
    expect(unionBounds([])).toBeNull();
  });

  it("weitet um 10 % der Achsenlänge auf", () => {
    const e = expandBox(box(0, 0, 0, 10, 20, 40));
    expect(e.min.x).toBeCloseTo(-1);
    expect(e.max.x).toBeCloseTo(11);
    expect(e.min.y).toBeCloseTo(-2);
    expect(e.max.y).toBeCloseTo(22);
    expect(e.min.z).toBeCloseTo(-4);
    expect(e.max.z).toBeCloseTo(44);
  });

  it("hält bei degenerierten Achsen einen Mindestrand ein", () => {
    const e = expandBox(box(0, 0, 5, 10, 10, 5)); // Platte mit Höhe 0
    expect(e.max.z - e.min.z).toBeGreaterThan(0);
    expect(e.min.z).toBeCloseTo(4.95);
    expect(e.max.z).toBeCloseTo(5.05);
  });
});

describe("sliceMath · Rahmenwechsel IFC ↔ Renderer", () => {
  // IFC (x, y, z) → Renderer (x, z, −y): Die IFC-Y-Spanne [1, 2] liegt im
  // Renderer als Z-Spanne [−2, −1] — min/max müssen dabei neu sortiert werden.
  it("ifcBoxToRenderer sortiert die negierte Y-Spanne", () => {
    const r = ifcBoxToRenderer(box(0, 1, 10, 5, 2, 20), NO_SHIFT);
    expect(r).toEqual(box(0, 10, -2, 5, 20, -1));
  });

  it("Roundtrip mit RTC-Verschiebung ist verlustfrei", () => {
    const shift = { x: 1000, y: -500, z: 42 };
    const ifc = box(1000.5, -499, 42.25, 1004, -495.5, 45);
    const back = rendererBoxToIfc(ifcBoxToRenderer(ifc, shift), shift);
    expect(back.min.x).toBeCloseTo(ifc.min.x);
    expect(back.min.y).toBeCloseTo(ifc.min.y);
    expect(back.min.z).toBeCloseTo(ifc.min.z);
    expect(back.max.x).toBeCloseTo(ifc.max.x);
    expect(back.max.y).toBeCloseTo(ifc.max.y);
    expect(back.max.z).toBeCloseTo(ifc.max.z);
  });

  it("toClipBox liefert min ≤ max je Lane und enabled=true", () => {
    const clip = toClipBox(box(-3, 2, 0, 4, 6, 12), NO_SHIFT);
    expect(clip.enabled).toBe(true);
    for (let lane = 0; lane < 3; lane++)
      expect(clip.min[lane]).toBeLessThanOrEqual(clip.max[lane]);
    // IFC z → Renderer y, IFC y → −Renderer z.
    expect(clip.min[1]).toBeCloseTo(0);
    expect(clip.max[1]).toBeCloseTo(12);
    expect(clip.min[2]).toBeCloseTo(-6);
    expect(clip.max[2]).toBeCloseTo(-2);
  });
});

describe("sliceMath · Flächen-Regler + Overlay-Geometrie", () => {
  it("patchBoxSide lässt min nicht über max laufen (gezogene Seite gewinnt)", () => {
    const b = box(0, 0, 0, 2, 2, 2);
    const pushed = patchBoxSide(b, "x", "min", 3);
    expect(pushed.min.x).toBe(3);
    expect(pushed.max.x).toBe(3);
    const pulled = patchBoxSide(b, "y", "max", -1);
    expect(pulled.max.y).toBe(-1);
    expect(pulled.min.y).toBe(-1);
    // Unbeteiligte Achsen bleiben unangetastet.
    expect(pushed.min.y).toBe(0);
    expect(pushed.max.z).toBe(2);
  });

  it("8 Ecken, 12 Kanten, jede Ecke an 3 Kanten", () => {
    const corners = boxCorners(box(0, 0, 0, 1, 2, 3));
    expect(corners).toHaveLength(8);
    expect(BOX_EDGES).toHaveLength(12);
    const degree = new Array(8).fill(0);
    for (const [a, b] of BOX_EDGES) {
      degree[a]++;
      degree[b]++;
      // Jede Kante ist achsparallel: genau eine Koordinate unterscheidet sich.
      const diffs = (["x", "y", "z"] as const).filter(
        (k) => corners[a][k] !== corners[b][k],
      );
      expect(diffs).toHaveLength(1);
    }
    expect(degree).toEqual(new Array(8).fill(3));
  });
});

describe("sliceMath · Drag-/Rad-Mapping", () => {
  it("voller Zug über die größere Kante = 100 %", () => {
    expect(dragPositionDelta(800, 0, 800, 600)).toBeCloseTo(100);
    expect(dragPositionDelta(0, 800, 800, 600)).toBeCloseTo(-100); // nach unten = weniger
  });

  it("klemmt Position auf 0–100", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(55.5)).toBe(55.5);
  });

  it("Radschritte: 1 % normal, 0,1 % fein, Vorzeichen gegen deltaY", () => {
    expect(wheelPositionStep(120, false)).toBe(-1);
    expect(wheelPositionStep(-120, false)).toBe(1);
    expect(wheelPositionStep(120, true)).toBe(-0.1);
    expect(wheelPositionStep(0, false)).toBe(0);
  });
});

describe("section · toSectionPlane", () => {
  it("trägt flipped an den Renderer durch", () => {
    const plane = toSectionPlane({
      axis: "front",
      position: 25,
      enabled: true,
      flipped: true,
    });
    expect(plane).toEqual({
      axis: "front",
      position: 25,
      enabled: true,
      flipped: true,
    });
  });

  it("liefert null, solange der Schnitt aus ist", () => {
    expect(toSectionPlane(DEFAULT_SECTION)).toBeNull();
  });
});

describe("sectionStore", () => {
  beforeEach(() => {
    useSectionStore.getState().reset();
  });

  it("nudgePosition klemmt auf 0–100", () => {
    const s = useSectionStore.getState();
    s.nudgePosition(70); // 50 → 100 (geklemmt)
    expect(useSectionStore.getState().section.position).toBe(100);
    useSectionStore.getState().nudgePosition(-250);
    expect(useSectionStore.getState().section.position).toBe(0);
  });

  it("setBox schaltet die Box an, setBox(null) wieder aus", () => {
    useSectionStore.getState().setBox(box(0, 0, 0, 1, 1, 1));
    expect(useSectionStore.getState().boxEnabled).toBe(true);
    useSectionStore.getState().setBox(null);
    expect(useSectionStore.getState().boxEnabled).toBe(false);
    expect(useSectionStore.getState().boxIfc).toBeNull();
  });

  it("patchBox wendet den Flächen-Regler an, ohne Box ist er ein No-op", () => {
    useSectionStore.getState().patchBox("x", "min", 5);
    expect(useSectionStore.getState().boxIfc).toBeNull();
    useSectionStore.getState().setBox(box(0, 0, 0, 2, 2, 2));
    useSectionStore.getState().patchBox("x", "min", 0.5);
    expect(useSectionStore.getState().boxIfc?.min.x).toBe(0.5);
  });

  it("requestBoxOnSelection zählt die Nonce hoch; reset räumt Schnitt+Box ab", () => {
    const before = useSectionStore.getState().boxRequest;
    useSectionStore.getState().requestBoxOnSelection();
    expect(useSectionStore.getState().boxRequest).toBe(before + 1);
    useSectionStore.getState().patchSection({ enabled: true, flipped: true });
    useSectionStore.getState().setBox(box(0, 0, 0, 1, 1, 1));
    useSectionStore.getState().reset();
    expect(useSectionStore.getState().section).toEqual(DEFAULT_SECTION);
    expect(useSectionStore.getState().boxIfc).toBeNull();
    expect(useSectionStore.getState().boxEnabled).toBe(false);
  });
});
