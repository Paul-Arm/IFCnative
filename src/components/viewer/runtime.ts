import type { ViewerTransformCommitReceipt } from "../that-open-viewer.types";
import { createCoordinateCursor } from "./coordinate-cursor";
import { createViewerModelSync } from "./model-sync";
import { createMoveGizmo } from "./move-gizmo";
import {
  sceneToIfcWorldVector,
  type LoadedViewerModel,
  type ViewerRuntimeCallbacks,
} from "./runtime-shared";
import { createViewerScene } from "./scene-setup";
import { createViewerSelection } from "./selection";
import { formatCoordinate } from "./utils";
import { createThatOpenViewCube } from "./view-cube";

export async function createThatOpenRuntime(
  container: HTMLDivElement,
  callbacks: ViewerRuntimeCallbacks,
) {
  const [OBC, THREE, FRAGS, BUI, OBCUI, transformControlsModule] =
    await Promise.all([
      import("@thatopen/components"),
      import("three"),
      import("@thatopen/fragments"),
      import("@thatopen/ui"),
      import("@thatopen/ui-obc"),
      import("three/addons/controls/TransformControls.js"),
    ]);
  BUI.Manager.init();
  OBCUI.Manager.init();

  const {
    canvas,
    components,
    fragments,
    grid,
    handleFragmentMaterialSet,
    handleFragmentModelSet,
    themeObserver,
    updateFragmentsOnCamera,
    world,
  } = await createViewerScene(container, { OBC, THREE });

  const viewCube = createThatOpenViewCube(THREE, container, world.camera);

  const modelsByDocumentId = new Map<string, LoadedViewerModel>();
  const documentIdByModelId = new Map<string, string>();

  const moveGizmo = createMoveGizmo(
    THREE,
    transformControlsModule.TransformControls,
    fragments.core,
    world.scene.three,
    world.camera.three,
    world.camera.controls,
    canvas,
    async (change) => {
      const activeDocumentId = callbacks.getActiveDocumentId();
      const loaded = modelsByDocumentId.get(activeDocumentId);
      if (!loaded || !Number.isFinite(change.localId) || change.localId <= 0) {
        callbacks.onLog(
          `fragments.moveSkipped({ reason: 'no-active-selection' });`,
        );
        return null;
      }
      const entityId =
        loaded.mirrorEntityIdByLocalId.get(change.localId) ?? change.localId;
      if (callbacks.getSelectedId(activeDocumentId) !== entityId) {
        callbacks.onLog(
          `fragments.transformSkipped({ reason: 'selection-changed', id: ${entityId} });`,
        );
        return null;
      }
      let receipt: ViewerTransformCommitReceipt | null = null;
      if (change.mode === "translate" && change.delta) {
        const worldDelta = sceneToIfcWorldVector(THREE, loaded, change.delta);
        receipt = callbacks.onMoveSelected(entityId, {
          x: worldDelta.x,
          y: worldDelta.y,
          z: worldDelta.z,
        });
        callbacks.onLog(
          `fragments.moveCommitted({ file: '${loaded.fileName}', id: ${entityId}, dx: ${formatCoordinate(worldDelta.x)}, dy: ${formatCoordinate(worldDelta.y)}, dz: ${formatCoordinate(worldDelta.z)} });`,
        );
      } else if (change.rotationChange) {
        const worldAxis = sceneToIfcWorldVector(
          THREE,
          loaded,
          change.rotationChange.axis,
          true,
        );
        const worldRefDirection = sceneToIfcWorldVector(
          THREE,
          loaded,
          change.rotationChange.refDirection,
          true,
        );
        receipt = callbacks.onRotateSelected(entityId, {
          ...change.rotationChange,
          axis: { x: worldAxis.x, y: worldAxis.y, z: worldAxis.z },
          refDirection: {
            x: worldRefDirection.x,
            y: worldRefDirection.y,
            z: worldRefDirection.z,
          },
        });
        callbacks.onLog(
          `fragments.rotateCommitted({ file: '${loaded.fileName}', id: ${entityId}, rx: ${formatCoordinate(change.rotation?.x ?? 0)}, ry: ${formatCoordinate(change.rotation?.y ?? 0)}, rz: ${formatCoordinate(change.rotation?.z ?? 0)} });`,
        );
      }
      return receipt
        ? { ...receipt, documentId: activeDocumentId, entityId }
        : null;
    },
    async (change, receipt) => {
      callbacks.onTransformResult({
        documentId: receipt.documentId,
        label: receipt.label,
        ok: change.applied,
        pendingKey: receipt.pendingKey,
        reason: change.applied ? undefined : "fragments-edit-failed",
      });
      await selection
        .highlight(receipt.documentId, receipt.entityId)
        .catch(() => undefined);
      callbacks.onLog(
        `fragments.transformFinished({ id: ${receipt.entityId}, mode: '${change.mode}', applied: ${change.applied} });`,
      );
    },
    (line) => callbacks.onLog(line),
    () => void fragments.core.update(true),
  );
  const coordinateCursor = createCoordinateCursor(THREE);
  world.scene.three.add(coordinateCursor.group, coordinateCursor.rayLine);

  const selection = createViewerSelection({
    FRAGS,
    THREE,
    callbacks,
    canvas,
    coordinateCursor,
    documentIdByModelId,
    fragments,
    modelsByDocumentId,
    moveGizmo,
    world,
  });

  const modelSync = createViewerModelSync({
    THREE,
    callbacks,
    coordinateCursor,
    documentIdByModelId,
    fit: selection.fit,
    fragments,
    grid,
    highlight: selection.highlight,
    modelsByDocumentId,
    moveGizmo,
  });

  const resizeObserver = new ResizeObserver(() => {
    world.renderer?.resize();
  });
  resizeObserver.observe(container);

  canvas.addEventListener("pointerdown", selection.trackPointerDown, {
    capture: true,
  });
  canvas.addEventListener("click", selection.selectFromPointer, {
    capture: true,
  });

  async function dispose() {
    canvas.removeEventListener("pointerdown", selection.trackPointerDown, {
      capture: true,
    });
    canvas.removeEventListener("click", selection.selectFromPointer, {
      capture: true,
    });
    resizeObserver.disconnect();
    themeObserver.disconnect();
    world.camera.controls.removeEventListener("update", updateFragmentsOnCamera);
    fragments.list.onItemSet.remove(handleFragmentModelSet);
    fragments.core.models.materials.list.onItemSet.remove(
      handleFragmentMaterialSet,
    );
    for (const loaded of modelsByDocumentId.values()) {
      await modelSync
        .disposeDeltaModels(loaded.model.modelId)
        .catch(() => undefined);
      await fragments.core
        .disposeModel(loaded.model.modelId)
        .catch(() => undefined);
    }
    modelsByDocumentId.clear();
    documentIdByModelId.clear();
    fragments.dispose();
    moveGizmo.dispose();
    viewCube.dispose();
    coordinateCursor.dispose();
    components.dispose();
  }

  // Erst hier registrieren: wirft eine der Initialisierungen oben, gibt es
  // keinen Runtime-Rückgabewert und damit niemanden, der dispose() (und den
  // Observer-Disconnect) aufrufen könnte — der Observer würde world/GL-Kontext
  // dauerhaft am Leben halten.
  themeObserver.observe(globalThis.document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });

  return {
    dispose,
    applyMirror: modelSync.applyMirror,
    fit: selection.fit,
    focusSelected: selection.focusSelected,
    highlight: selection.highlight,
    hideCoordinateCursor: coordinateCursor.hide,
    resetCamera: selection.resetCamera,
    setMoveGizmoEnabled: moveGizmo.setEnabled,
    setMoveGizmoMode: moveGizmo.setMode,
    syncModels: modelSync.syncModels,
    updateGrid: modelSync.updateGrid,
  };
}
