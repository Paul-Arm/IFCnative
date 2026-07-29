import { fragmentScenePointToIfcWorld } from "../../ifc/fragmentSceneCoordinates";
import type {
  ViewerCoordinatePick,
  ViewerMirrorResult,
  ViewerMoveDelta,
  ViewerRotationChange,
  ViewerTransformCommitReceipt,
} from "../that-open-viewer.types";

export type ThreeModule = typeof import("three");

export interface ViewerRuntimeCallbacks {
  getActiveDocumentId(): string;
  getSelectedId(documentId?: string): number;
  isCoordinatePickerActive(): boolean;
  onError(message: string): void;
  onCoordinatePickerUsed(): void;
  onLog(line: string): void;
  onMoveSelected(
    entityId: number,
    delta: ViewerMoveDelta,
  ): ViewerTransformCommitReceipt | null;
  onRotateSelected(
    entityId: number,
    rotation: ViewerRotationChange,
  ): ViewerTransformCommitReceipt | null;
  onTransformResult(result: ViewerMirrorResult): void;
  onPickCoordinates(pick: ViewerCoordinatePick): void;
  onProgress(progress: { fileName: string; percent: number } | null): void;
  onSelect(
    id: number,
    source?: string,
    globalId?: string,
    documentId?: string,
  ): void;
  onStatus(message: string): void;
}

export type LoadedViewerModel = {
  documentId: string;
  fileName: string;
  fitItems?: Set<number>;
  loadKey: string;
  /**
   * Id-Mapping für per Mirror ERZEUGTE Elemente: createElements vergibt
   * eigene Fragments-localIds, die nicht der nativen Express-Id
   * entsprechen. Für alle konvertierten Elemente gilt localId == Express-Id.
   * Ein Eintrag bedeutet zugleich: das Element ist ein DELTA-Element der
   * Edit-API (eigenes Delta-Render-Modell, kein setVisible, keine
   * verlässlichen Editor-Klon-Meshes) — bis zur nächsten Rekonversion.
   */
  mirrorEntityIdByLocalId: Map<number, number>;
  mirrorLocalIdByEntityId: Map<number, number>;
  model: import("@thatopen/fragments").FragmentsModel;
  /**
   * Rebase aus der Konvertierung (COORDINATE_TO_ORIGIN): lokaler Modellraum
   * → echte IFC-Welt (Viewer-Achsen, Meter) und Umkehrung. Die zusätzliche
   * model.object-Transformation koordiniert diesen Modellraum in der Szene.
   */
  modelToIfcWorld: import("three").Matrix4 | null;
  ifcWorldToModel: import("three").Matrix4 | null;
};

// Punkt aus dem zentrierten Szenenraum in echte IFC-Weltkoordinaten
// (Viewer-Achsen, Meter) umrechnen.
export const sceneToIfcWorldPoint = (
  THREE: ThreeModule,
  loaded: LoadedViewerModel,
  point: { x: number; y: number; z: number },
) => {
  const vector = new THREE.Vector3(point.x, point.y, point.z);
  return fragmentScenePointToIfcWorld(
    vector,
    loaded.model.object,
    loaded.modelToIfcWorld,
  );
};

export const sceneToIfcWorldVector = (
  THREE: ThreeModule,
  loaded: LoadedViewerModel,
  vector: { x?: number; y?: number; z?: number },
  normalize = false,
) => {
  const result = new THREE.Vector3(
    vector.x ?? 0,
    vector.y ?? 0,
    vector.z ?? 0,
  );
  if (loaded.modelToIfcWorld) {
    result.applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(loaded.modelToIfcWorld),
    );
  }
  return normalize ? result.normalize() : result;
};

export const ifcWorldToSceneVector = (
  THREE: ThreeModule,
  loaded: LoadedViewerModel,
  vector: { x?: number; y?: number; z?: number },
) => {
  const result = new THREE.Vector3(
    vector.x ?? 0,
    vector.y ?? 0,
    vector.z ?? 0,
  );
  if (loaded.ifcWorldToModel) {
    result.applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(loaded.ifcWorldToModel),
    );
  }
  return result;
};

// Native Express-Id → Fragments-localId (nur für per Mirror erzeugte
// Elemente verschieden; sonst identisch). Umkehrung direkt über
// mirrorEntityIdByLocalId.
export const resolveLocalId = (loaded: LoadedViewerModel, entityId: number) =>
  loaded.mirrorLocalIdByEntityId.get(entityId) ?? entityId;

/**
 * Baut aus den 9 gespeicherten Koordinationswerten ([px,py,pz, xAchse, yAchse],
 * Welt → Ursprung in Viewer-Achsen) eine Matrix4. null bei fehlenden Werten
 * oder (näherungsweiser) Identität.
 */
export function coordinationToMatrix(
  THREE: ThreeModule,
  coordination: number[] | null | undefined,
): import("three").Matrix4 | null {
  if (!coordination || coordination.length < 9) {
    return null;
  }
  const [x, y, z, xx, xy, xz, yx, yy, yz] = coordination;
  const xDir = new THREE.Vector3(xx, xy, xz);
  const yDir = new THREE.Vector3(yx, yy, yz);
  if (xDir.lengthSq() < 0.5 || yDir.lengthSq() < 0.5) {
    return null;
  }
  const zDir = new THREE.Vector3().crossVectors(xDir, yDir);
  const matrix = new THREE.Matrix4();
  // Spalten = Achsen, Translation = Position (wie CoordinatesManager).
  matrix.set(
    xDir.x,
    yDir.x,
    zDir.x,
    x,
    xDir.y,
    yDir.y,
    zDir.y,
    y,
    xDir.z,
    yDir.z,
    zDir.z,
    z,
    0,
    0,
    0,
    1,
  );
  const isIdentity =
    Math.abs(x) < 1e-6 &&
    Math.abs(y) < 1e-6 &&
    Math.abs(z) < 1e-6 &&
    Math.abs(xx - 1) < 1e-9 &&
    Math.abs(yy - 1) < 1e-9 &&
    Math.abs(xy) < 1e-9 &&
    Math.abs(xz) < 1e-9 &&
    Math.abs(yx) < 1e-9 &&
    Math.abs(yz) < 1e-9;
  return isIdentity ? null : matrix;
}
