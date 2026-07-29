import type {
  ViewerMoveDelta,
  ViewerRotationChange,
  ViewerTransformCommitReceipt,
} from "../that-open-viewer.types";
import {
  setFragmentElementVisible,
  type EditableFragmentElementLike,
  type EditableFragmentModelLike,
  type EditableFragmentsLike,
} from "./fragment-elements";
import type { ThreeModule } from "./runtime-shared";
import { formatCoordinate } from "./utils";

type TransformControlsConstructor =
  typeof import("three/addons/controls/TransformControls.js").TransformControls;

interface CameraControlsLike {
  enabled: boolean;
}

export type MoveGizmoMode = "translate" | "rotate";

export interface MoveGizmoChange {
  delta?: ViewerMoveDelta;
  localId: number;
  mode: MoveGizmoMode;
  rotation?: ViewerMoveDelta;
  rotationChange?: ViewerRotationChange;
}

export interface MoveGizmoCommit extends MoveGizmoChange {
  /** Der Edit wurde vom Fragments-Worker erfolgreich angewendet. */
  applied: boolean;
}

export interface MoveGizmoCommitReceipt extends ViewerTransformCommitReceipt {
  documentId: string;
  entityId: number;
}

export type MoveGizmo = ReturnType<typeof createMoveGizmo>;

export function createMoveGizmo(
  THREE: ThreeModule,
  TransformControls: TransformControlsConstructor,
  fragments: EditableFragmentsLike,
  scene: import("three").Scene,
  camera: import("three").Camera,
  cameraControls: CameraControlsLike,
  canvas: HTMLCanvasElement,
  onNativeSync: (
    change: MoveGizmoChange,
  ) => Promise<MoveGizmoCommitReceipt | null>,
  onTransformFinished: (
    change: MoveGizmoCommit,
    receipt: MoveGizmoCommitReceipt,
  ) => Promise<void>,
  onLog: (line: string) => void,
  onSceneChange: () => void,
) {
  const controls = new TransformControls(camera, canvas);
  controls.setMode("translate");
  controls.setSpace("world");
  controls.size = 0.85;
  const helper = controls.getHelper();
  helper.name = "IFCnativeMoveGizmo";
  helper.visible = false;
  scene.add(helper);

  let enabled = false;
  let dragging = false;
  let mode: MoveGizmoMode = "translate";
  let selectedLocalId = 0;
  let selectedModel: EditableFragmentModelLike | null = null;
  let editElement: EditableFragmentElementLike | null = null;
  let editMeshes: import("three").Group | null = null;
  const dragStartWorldPosition = new THREE.Vector3();
  const dragStartWorldQuaternion = new THREE.Quaternion();
  const dragStartLocalRotation = new THREE.Euler();

  // Gizmo operations arrive concurrently (reload, fit, highlight, selection
  // effects). Serialize them so overlapping loadEditable/disposeEditable calls
  // cannot orphan a preview clone in the scene (invisible-ghost bug).
  let operationQueue: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = operationQueue.then(task, task);
    operationQueue = run.catch(() => undefined);
    return run;
  };

  const removeOrphanEditMeshes = () => {
    const sweep = (parent: import("three").Object3D | undefined) => {
      if (!parent) {
        return;
      }
      for (const child of [...parent.children]) {
        if (child.name === "IFCnativeEditableElement" && child !== editMeshes) {
          child.removeFromParent();
        }
      }
    };
    sweep(scene);
    sweep(selectedModel?.object);
  };

  const disposeEditable = async (restoreVisible: boolean) => {
    const model = selectedModel;
    const localId = selectedLocalId;
    const element = editElement;
    controls.detach();
    helper.visible = false;
    if (editMeshes) {
      editMeshes.removeFromParent();
      try {
        editElement?.disposeMeshes(editMeshes);
      } catch {
        // The owning model may already be disposed after a reload.
      }
      editMeshes = null;
      editElement = null;
    }
    removeOrphanEditMeshes();
    if (
      restoreVisible &&
      model &&
      element &&
      Number.isFinite(localId) &&
      localId > 0
    ) {
      await setFragmentElementVisible(fragments, model, element, true).catch(
        () => undefined,
      );
      await fragments.update(true).catch(() => undefined);
    }
    onSceneChange();
  };

  const loadEditable = async (
    localId: number,
    model: EditableFragmentModelLike,
  ) => {
    await disposeEditable(false);
    const [element] = await fragments.editor.getElements(model.modelId, [
      localId,
    ]);
    if (!element) {
      onLog(
        `viewer.transformGizmo.selectionSkipped({ id: ${localId}, reason: 'no-editable-element' });`,
      );
      return;
    }
    editElement = element;
    try {
      await setFragmentElementVisible(fragments, model, element, false);
      editMeshes = await element.getMeshes();
      editMeshes.name = "IFCnativeEditableElement";
    } catch (reason) {
      await setFragmentElementVisible(fragments, model, element, true).catch(
        () => undefined,
      );
      editElement = null;
      editMeshes = null;
      throw reason;
    }
    // Parent the preview under the model object so any coordination
    // transform (georeferenced models) applies to the clone as well.
    const previewParent = model.object ?? scene;
    previewParent.add(editMeshes);
    editMeshes.updateWorldMatrix(true, true);
    removeOrphanEditMeshes();
    controls.setMode(mode);
    // Official EditElements workflow: TransformControls operate directly on
    // the group returned by element.getMeshes(). setMeshes() reads this
    // group's local matrix to generate UPDATE_GLOBAL_TRANSFORM requests.
    controls.attach(editMeshes);
    helper.visible = true;
    await fragments.update(true).catch(() => undefined);
    onSceneChange();
  };

  const updateSelectionInternal = async (
    localId: number,
    model: EditableFragmentModelLike | null,
  ) => {
    const selectionChanged =
      localId !== selectedLocalId || model !== selectedModel;
    if (selectionChanged) {
      await disposeEditable(true);
    }
    selectedLocalId = localId;
    selectedModel = model;
    if (!enabled || !model || !Number.isFinite(localId) || localId <= 0) {
      await disposeEditable(true);
      return;
    }
    if (!editMeshes || selectionChanged) {
      await loadEditable(localId, model);
    }
  };

  const updateSelection = (
    localId: number,
    model: EditableFragmentModelLike | null,
  ) => enqueue(() => updateSelectionInternal(localId, model));

  const setEnabled = (nextEnabled: boolean) =>
    enqueue(async () => {
      enabled = nextEnabled;
      if (!enabled) {
        await disposeEditable(true);
        return;
      }
      await updateSelectionInternal(selectedLocalId, selectedModel);
    });

  const setMode = (nextMode: MoveGizmoMode) => {
    mode = nextMode;
    controls.setMode(nextMode);
    onSceneChange();
  };

  const onDraggingChanged = (event: { value: unknown }) => {
    dragging = Boolean(event.value);
    cameraControls.enabled = !dragging;
  };
  const onMouseDown = () => {
    const target = editMeshes;
    if (!target) {
      return;
    }
    target.updateWorldMatrix(true, false);
    target.getWorldPosition(dragStartWorldPosition);
    target.getWorldQuaternion(dragStartWorldQuaternion);
    dragStartLocalRotation.copy(target.rotation);
    onSceneChange();
  };
  const onMouseUp = () => {
    void commitCurrentTransform();
  };

  const commitCurrentTransform = async () => {
    const result = await enqueue(async (): Promise<{
      commit: MoveGizmoCommit;
      receipt: MoveGizmoCommitReceipt;
    } | null> => {
      const target = editMeshes;
      const meshes = editMeshes;
      const element = editElement;
      if (
        !target ||
        !meshes ||
        !element ||
        !selectedModel ||
        selectedLocalId <= 0
      ) {
        onSceneChange();
        return null;
      }
      target.updateWorldMatrix(true, false);
      const endWorldPosition = target.getWorldPosition(new THREE.Vector3());
      const endWorldQuaternion = target.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      const delta = endWorldPosition.sub(dragStartWorldPosition);
      const rotation = {
        x: target.rotation.x - dragStartLocalRotation.x,
        y: target.rotation.y - dragStartLocalRotation.y,
        z: target.rotation.z - dragStartLocalRotation.z,
      };
      const rotationChange = readRotationChange(THREE, target, rotation);
      const changed =
        mode === "translate"
          ? delta.lengthSq() >= 0.000001
          : dragStartWorldQuaternion.angleTo(endWorldQuaternion) >= 0.000001;
      if (!changed) {
        onSceneChange();
        return null;
      }

      const localId = selectedLocalId;
      const model = selectedModel;
      const change: MoveGizmoChange = {
        localId,
        mode,
        ...(mode === "translate"
          ? { delta: { x: delta.x, y: delta.y, z: delta.z } }
          : { rotation, rotationChange }),
      };
      let applied = false;
      try {
        // That Open EditElements commit order:
        // setMeshes -> dispose preview -> getRequests -> editor.edit -> update.
        // No native STEP write happens until this worker-backed edit succeeds.
        await element.setMeshes(meshes);
        controls.detach();
        helper.visible = false;
        element.disposeMeshes(meshes);
        editMeshes = null;
        const requests = element.getRequests();
        if (requests?.length) {
          await fragments.editor.edit(model.modelId, requests);
          applied = true;
        }
      } catch (reason) {
        onLog(
          `viewer.transformGizmo.editError(${JSON.stringify(String(reason))});`,
        );
      }
      controls.detach();
      helper.visible = false;
      if (editMeshes) {
        editMeshes.removeFromParent();
        try {
          element.disposeMeshes(editMeshes);
        } catch {
          // The owning model may already be disposed after a reload.
        }
      }
      editElement = null;
      editMeshes = null;
      removeOrphanEditMeshes();
      // Restore visibility using the tutorial's base/delta rule. After a
      // successful edit the stale base item stays hidden and the delta item
      // becomes visible.
      await setFragmentElementVisible(fragments, model, element, true).catch(
        () => undefined,
      );
      await fragments.update(true).catch(() => undefined);
      if (!applied) {
        onLog(
          `viewer.transformGizmo.reverted({ id: ${localId}, reason: 'fragments-edit-failed' });`,
        );
        return null;
      }
      // Fragments is now authoritative for the completed interaction. Mirror
      // the resulting world transform into the native STEP document so IFC
      // export preserves the same pose.
      let receipt: MoveGizmoCommitReceipt | null = null;
      try {
        receipt = await onNativeSync(change);
      } catch (reason) {
        onLog(
          `viewer.transformGizmo.nativeSyncError(${JSON.stringify(String(reason))});`,
        );
      }
      if (!receipt) {
        onLog(
          `viewer.transformGizmo.nativeSyncRejected({ id: ${localId} });`,
        );
        return null;
      }
      return { commit: { ...change, applied }, receipt };
    });
    if (!result) {
      return;
    }
    await onTransformFinished(result.commit, result.receipt);
    onLog(
      result.commit.mode === "translate"
        ? `viewer.moveGizmo.delta({ dx: ${formatCoordinate(result.commit.delta?.x ?? 0)}, dy: ${formatCoordinate(result.commit.delta?.y ?? 0)}, dz: ${formatCoordinate(result.commit.delta?.z ?? 0)} });`
        : `viewer.rotateGizmo.delta({ rx: ${formatCoordinate(result.commit.rotation?.x ?? 0)}, ry: ${formatCoordinate(result.commit.rotation?.y ?? 0)}, rz: ${formatCoordinate(result.commit.rotation?.z ?? 0)} });`,
    );
    onSceneChange();
  };

  const readRotationChange = (
    THREE: ThreeModule,
    meshes: import("three").Object3D,
    rotation: ViewerMoveDelta,
  ): ViewerRotationChange => {
    meshes.updateWorldMatrix(true, false);
    const worldQuaternion = meshes.getWorldQuaternion(new THREE.Quaternion());
    const axis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(worldQuaternion)
      .normalize();
    const refDirection = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(worldQuaternion)
      .normalize();
    return {
      axis: { x: axis.x, y: axis.y, z: axis.z },
      refDirection: {
        x: refDirection.x,
        y: refDirection.y,
        z: refDirection.z,
      },
      rotation,
    };
  };

  const onChange = () => {
    onSceneChange();
  };

  controls.addEventListener("dragging-changed", onDraggingChanged);
  controls.addEventListener("mouseDown", onMouseDown);
  controls.addEventListener("mouseUp", onMouseUp);
  controls.addEventListener("change", onChange);

  const dispose = () => {
    controls.removeEventListener("dragging-changed", onDraggingChanged);
    controls.removeEventListener("mouseDown", onMouseDown);
    controls.removeEventListener("mouseUp", onMouseUp);
    controls.removeEventListener("change", onChange);
    controls.detach();
    controls.dispose();
    helper.removeFromParent();
    void enqueue(() => disposeEditable(true));
  };

  return {
    dispose,
    isDragging: () => dragging,
    setEnabled,
    setMode,
    updateSelection,
  };
}
