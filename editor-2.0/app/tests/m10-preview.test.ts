/**
 * M10-Verifikationstests: Live-Vorschau + Szene-Spiegel — reine Logik ohne
 * WebGPU/DOM.
 *
 * Geprüft wird
 *   - `core/viewer.ts` composePreviewMatrix   (Vorschau-Transform: Pivot,
 *                                              Yaw-Konvention, Skalierung)
 *   - `panes/viewer/gizmoMath.ts` snapYawRad  (Raster 5°, Umschalt = 1°)
 *   - `panes/viewer/sceneMirror.ts`           (Delta-Buchführung: apply/revert
 *                                              netto null, dispose-sicher,
 *                                              Rebuild-Szenario)
 *   - `commands/geometryCommands.ts` cmdRotateElement (Winkel → RefDirection,
 *                                              Export → Reparse, Undo/Redo
 *                                              byte-identisch)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { ModelSession } from "../src/core/session";
import { useCommands, type EditorCommand } from "../src/commands/pipeline";
import { cmdRotateElement } from "../src/commands/geometryCommands";
import { planRotation } from "../src/domain/geometry";
import { composePreviewMatrix, type ViewerOverlayAccess } from "../src/core/viewer";
import {
  ROTATE_SNAP_COARSE_RAD,
  ROTATE_SNAP_FINE_RAD,
  snapYawRad,
} from "../src/panes/viewer/gizmoMath";
import {
  mirroredMoveCommand,
  mirroredRotateCommand,
  registerSceneMirror,
  resetSceneMirrorForTests,
} from "../src/panes/viewer/sceneMirror";
import type { WorldVec3 } from "../src/panes/viewer/worldCoords";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// composePreviewMatrix: Vorschau-Transform (Spaltenmajor, Y-up)
// ---------------------------------------------------------------------------

function applyMatrix(m: Float32Array, p: WorldVec3): WorldVec3 {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

function compose(
  pivot: WorldVec3,
  delta: WorldVec3,
  yawRad: number,
  scale: WorldVec3,
): Float32Array {
  const out = new Float32Array(16);
  composePreviewMatrix(out, pivot, delta, yawRad, scale);
  return out;
}

const ONE: WorldVec3 = { x: 1, y: 1, z: 1 };
const ZERO: WorldVec3 = { x: 0, y: 0, z: 0 };

const closeTo = (got: WorldVec3, want: WorldVec3): void => {
  expect(got.x).toBeCloseTo(want.x, 6);
  expect(got.y).toBeCloseTo(want.y, 6);
  expect(got.z).toBeCloseTo(want.z, 6);
};

describe("M10: composePreviewMatrix — Pivot, Yaw-Konvention, Skalierung", () => {
  it("reine Translation: Identität plus Delta in der letzten Spalte", () => {
    const m = compose(ZERO, { x: 1.5, y: -2, z: 0.25 }, 0, ONE);
    closeTo(applyMatrix(m, ZERO), { x: 1.5, y: -2, z: 0.25 });
    closeTo(applyMatrix(m, { x: 1, y: 2, z: 3 }), { x: 2.5, y: 0, z: 3.25 });
  });

  it("Renderer-Yaw um Y entspricht dem IFC-Yaw um Z (+90°: +X → IFC +Y)", () => {
    // IFC +Y liegt im Renderer bei -Z (Swap x,z,-y): Ein Punkt östlich des
    // Pivots muss bei +90° IFC-Drehung nach Norden (Renderer -Z) wandern.
    const m = compose(ZERO, ZERO, 90 * DEG, ONE);
    closeTo(applyMatrix(m, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: -1 });
    // Die Höhe (Renderer-Y) bleibt vom Yaw unberührt.
    closeTo(applyMatrix(m, { x: 0, y: 2, z: 0 }), { x: 0, y: 2, z: 0 });
  });

  it("der Pivot bleibt unter Yaw+Skalierung fix und wandert nur um Delta", () => {
    const pivot: WorldVec3 = { x: 4, y: 1, z: -2 };
    const delta: WorldVec3 = { x: 0.5, y: 0, z: 3 };
    const m = compose(pivot, delta, 37 * DEG, { x: 2, y: 0.5, z: 3 });
    closeTo(applyMatrix(m, pivot), {
      x: pivot.x + delta.x,
      y: pivot.y + delta.y,
      z: pivot.z + delta.z,
    });
  });

  it("skaliert VOR der Drehung (L = R·S)", () => {
    const m = compose(ZERO, ZERO, 90 * DEG, { x: 2, y: 1, z: 1 });
    // (1,0,0) → S → (2,0,0) → R(+90°) → (0,0,-2)
    closeTo(applyMatrix(m, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: -2 });
  });
});

// ---------------------------------------------------------------------------
// snapYawRad: Rotations-Raster
// ---------------------------------------------------------------------------

describe("M10: snapYawRad — Raster 5°, Umschalt = 1°", () => {
  it("rundet auf 5°-Schritte (Standard) bzw. 1°-Schritte (fein)", () => {
    expect(snapYawRad(12.4 * DEG, false)).toBeCloseTo(10 * DEG, 12);
    expect(snapYawRad(12.6 * DEG, false)).toBeCloseTo(15 * DEG, 12);
    expect(snapYawRad(12.4 * DEG, true)).toBeCloseTo(12 * DEG, 12);
    expect(snapYawRad(-7.4 * DEG, false)).toBeCloseTo(-5 * DEG, 12);
    expect(snapYawRad(-7.4 * DEG, true)).toBeCloseTo(-7 * DEG, 12);
    expect(snapYawRad(1 * DEG, false)).toBe(0);
  });

  it("die Rasterkonstanten sind 5° und 1°", () => {
    expect(ROTATE_SNAP_COARSE_RAD).toBeCloseTo(5 * DEG, 12);
    expect(ROTATE_SNAP_FINE_RAD).toBeCloseTo(1 * DEG, 12);
  });
});

// ---------------------------------------------------------------------------
// sceneMirror: Delta-Buchführung (apply/revert netto null, dispose-sicher)
// ---------------------------------------------------------------------------

interface FakeScene {
  /** Netto-Translation, die die „Szene" gesehen hat (Renderer-Rahmen). */
  net: { x: number; y: number; z: number };
  /** Netto-Yaw (rad) und der zuletzt benutzte Pivot. */
  netYaw: number;
  lastPivot: WorldVec3 | null;
  applyCalls: number;
  revertBlocked: boolean;
  access: ViewerOverlayAccess;
}

function fakeScene(options?: {
  applyFails?: boolean;
  originShift?: WorldVec3;
}): FakeScene {
  const state: FakeScene = {
    net: { x: 0, y: 0, z: 0 },
    netYaw: 0,
    lastPivot: null,
    applyCalls: 0,
    revertBlocked: false,
    access: null as unknown as ViewerOverlayAccess,
  };
  state.access = {
    originShift: () => options?.originShift ?? { x: 0, y: 0, z: 0 },
    applyCommittedDelta(_id: number, delta: WorldVec3) {
      state.applyCalls += 1;
      if (options?.applyFails) return false;
      state.net.x += delta.x;
      state.net.y += delta.y;
      state.net.z += delta.z;
      return true;
    },
    applyCommittedRotation(_id: number, yawRad: number, pivot: WorldVec3) {
      state.applyCalls += 1;
      if (options?.applyFails) return false;
      state.netYaw += yawRad;
      state.lastPivot = pivot;
      return true;
    },
  } as unknown as ViewerOverlayAccess;
  return state;
}

/** Basis-Command, der nur Aufrufe zählt (das Modell testet der M5/M9-Teil). */
function countingCommand(): EditorCommand & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    label: "Test",
    run: () => calls.push("run"),
    undo: () => calls.push("undo"),
    redo: () => calls.push("redo"),
  };
}

describe("M10: sceneMirror — Buchführung der angewandten Deltas", () => {
  beforeEach(() => resetSceneMirrorForTests());

  it("run wendet das Renderer-Delta an, undo die Inverse — netto null", () => {
    const scene = fakeScene();
    registerSceneMirror("doc", scene.access);
    const base = countingCommand();
    // IFC (1, 2, 3) → Renderer (1, 3, -2): der dokumentierte Y-up-Swap.
    const cmd = mirroredMoveCommand("doc", base, 7, { x: 1, y: 2, z: 3 });

    cmd.run();
    expect(cmd.mirrored()).toBe(true);
    expect(scene.net).toEqual({ x: 1, y: 3, z: -2 });

    cmd.undo();
    expect(cmd.mirrored()).toBe(false);
    expect(scene.net).toEqual({ x: 0, y: 0, z: 0 });
    expect(base.calls).toEqual(["run", "undo"]);

    cmd.redo!();
    expect(scene.net).toEqual({ x: 1, y: 3, z: -2 });
    expect(base.calls).toEqual(["run", "undo", "redo"]);
    cmd.undo();
    expect(scene.net).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("fehlgeschlagenes apply wird bei undo NICHT invertiert", () => {
    const scene = fakeScene({ applyFails: true });
    registerSceneMirror("doc", scene.access);
    const cmd = mirroredMoveCommand("doc", countingCommand(), 7, {
      x: 1,
      y: 0,
      z: 0,
    });
    cmd.run();
    expect(cmd.mirrored()).toBe(false);
    expect(scene.applyCalls).toBe(1);
    cmd.undo();
    // Kein zweiter Aufruf: revert lief nicht.
    expect(scene.applyCalls).toBe(1);
    expect(scene.net).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("ohne registrierten Viewer läuft der Command gefahrlos ohne Spiegel", () => {
    const base = countingCommand();
    const cmd = mirroredMoveCommand("doc", base, 7, { x: 1, y: 0, z: 0 });
    cmd.run();
    expect(cmd.mirrored()).toBe(false);
    cmd.undo();
    cmd.redo!();
    expect(base.calls).toEqual(["run", "undo", "redo"]);
  });

  it("Rebuild-Szenario: undo trifft die NEU registrierte Instanz", () => {
    const first = fakeScene();
    const unregister = registerSceneMirror("doc", first.access);
    const cmd = mirroredMoveCommand("doc", countingCommand(), 7, {
      x: 2,
      y: 0,
      z: 0,
    });
    cmd.run();
    expect(first.net.x).toBe(2);

    // „Modell neu berechnen": neue Viewer-Instanz (zeigt den Commit-Stand).
    unregister();
    const second = fakeScene();
    registerSceneMirror("doc", second.access);

    cmd.undo();
    // Die Inverse landet in der neuen Szene; die alte bleibt unberührt.
    expect(second.net.x).toBe(-2);
    expect(first.net.x).toBe(2);
  });

  it("Abmeldung löscht nie eine NEUERE Registrierung", () => {
    const first = fakeScene();
    const second = fakeScene();
    const unregisterFirst = registerSceneMirror("doc", first.access);
    registerSceneMirror("doc", second.access);
    unregisterFirst(); // stale Cleanup — darf second nicht treffen
    const cmd = mirroredMoveCommand("doc", countingCommand(), 7, {
      x: 1,
      y: 0,
      z: 0,
    });
    cmd.run();
    expect(cmd.mirrored()).toBe(true);
    expect(second.net.x).toBe(1);
  });

  it("Rotation: Pivot über den LIVE-originShift, undo dreht netto auf null", () => {
    const scene = fakeScene({ originShift: { x: 10, y: 20, z: 0 } });
    registerSceneMirror("doc", scene.access);
    const cmd = mirroredRotateCommand(
      "doc",
      countingCommand(),
      7,
      45 * DEG,
      { x: 12, y: 22, z: 1 },
    );
    cmd.run();
    expect(scene.netYaw).toBeCloseTo(45 * DEG, 12);
    // IFC (12,22,1) − Shift (10,20,0) → Renderer (2, 1, −2).
    closeTo(scene.lastPivot!, { x: 2, y: 1, z: -2 });
    cmd.undo();
    expect(scene.netYaw).toBeCloseTo(0, 12);
  });
});

// ---------------------------------------------------------------------------
// cmdRotateElement: Winkel → RefDirection, Export → Reparse, Undo byte-stabil
// ---------------------------------------------------------------------------

function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M10-Rotation" });
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
  return ModelSession.open("m10.ifc", buffer);
}

const toText = (content: Uint8Array): string => new TextDecoder().decode(content);

function dataSection(text: string): string {
  const start = text.indexOf("DATA;");
  const end = text.indexOf("ENDSEC;", start);
  expect(start, "kein DATA-Abschnitt im Export").toBeGreaterThan(-1);
  return text.slice(start + 5, end);
}

const exportData = (session: ModelSession): string =>
  dataSection(toText(session.exportStep()));

function wallOf(session: ModelSession): number {
  const id = (session.store.entityIndex.byType.get("IFCWALL") ??
    session.store.entityIndex.byType.get("IFCWALLSTANDARDCASE") ??
    [])[0];
  expect(id, "Fixture ohne Wand").toBeDefined();
  return id;
}

describe("M10: cmdRotateElement — RefDirection, Reparse, Undo/Redo byte-stabil", () => {
  it("schreibt den Winkel als RefDirection und übersteht den Reparse", async () => {
    const session = await openSession(createSampleIfc());
    const wallId = wallOf(session);
    const source = { store: session.store, view: session.view };
    const before = exportData(session);
    const start = planRotation(source, wallId).currentRad;

    const command = cmdRotateElement(session, wallId, 90 * DEG);
    useCommands.getState().execute("m10-rot", command);
    expect(command.label).toContain("gedreht");
    expect(command.label).toContain("90");

    // Winkel → RefDirection: planRotation liest cos/sin wieder als Yaw.
    expect(planRotation(source, wallId).currentRad).toBeCloseTo(
      start + 90 * DEG,
      9,
    );

    // Reparse: Nur was den Export übersteht, ist wirklich im Modell.
    const reparsed = await openSession(toText(session.exportStep()));
    const again = planRotation(
      { store: reparsed.store, view: reparsed.view },
      wallOf(reparsed),
    );
    expect(again.currentRad).toBeCloseTo(start + 90 * DEG, 9);

    // Undo: DATA-Sektion byte-identisch zum Ausgangsexport.
    useCommands.getState().undo("m10-rot");
    expect(exportData(session)).toBe(before);
    expect(planRotation(source, wallId).currentRad).toBeCloseTo(start, 12);
  });

  it("Redo stellt denselben Record wieder her (Export byte-identisch)", async () => {
    const session = await openSession(createSampleIfc());
    const wallId = wallOf(session);
    const before = exportData(session);

    useCommands
      .getState()
      .execute("m10-redo", cmdRotateElement(session, wallId, -30 * DEG));
    const afterRun = exportData(session);
    expect(afterRun).not.toBe(before);

    useCommands.getState().undo("m10-redo");
    expect(exportData(session)).toBe(before);

    // Redo nutzt den gesicherten IfcDirection-Record (stabile expressId,
    // skipHistory) — der Export muss dem ersten Stand byte-identisch sein.
    useCommands.getState().redo("m10-redo");
    expect(exportData(session)).toBe(afterRun);

    useCommands.getState().undo("m10-redo");
    expect(exportData(session)).toBe(before);
  });
});
