import { convertIfcToFragmentsInWorker } from "../../ifc/fragmentConversionWorker";
import { fragmentModelPointToScene } from "../../ifc/fragmentSceneCoordinates";
import type {
  ThatOpenViewerModel,
  ViewerMirrorRequest,
  ViewerMirrorResult,
} from "../that-open-viewer.types";
import type { CoordinateCursor } from "./coordinate-cursor";
import {
  getCameraFitLocalIds,
  readNumericAttribute,
} from "./fragment-attributes";
import {
  createFragmentBodyElement,
  replaceFragmentElementGeometry,
  setFragmentElementVisible,
} from "./fragment-elements";
import type { MoveGizmo } from "./move-gizmo";
import {
  coordinationToMatrix,
  ifcWorldToSceneVector,
  resolveLocalId,
  type LoadedViewerModel,
  type ThreeModule,
  type ViewerRuntimeCallbacks,
} from "./runtime-shared";
import type { ViewerScene } from "./scene-setup";
import {
  formatCoordinate,
  formatFragmentConversionProgress,
  resolvePublicAssetUrl,
  stringifyError,
  toModelId,
} from "./utils";

export type ViewerModelSync = ReturnType<typeof createViewerModelSync>;

export function createViewerModelSync(deps: {
  THREE: ThreeModule;
  callbacks: ViewerRuntimeCallbacks;
  coordinateCursor: CoordinateCursor;
  documentIdByModelId: Map<string, string>;
  fit(): Promise<void>;
  fragments: ViewerScene["fragments"];
  grid: ViewerScene["grid"];
  highlight(
    documentId: string,
    entityId: number,
    options?: { updateGizmo?: boolean },
  ): Promise<void>;
  modelsByDocumentId: Map<string, LoadedViewerModel>;
  moveGizmo: MoveGizmo;
}) {
  const {
    THREE,
    callbacks,
    coordinateCursor,
    documentIdByModelId,
    fit,
    fragments,
    grid,
    highlight,
    modelsByDocumentId,
    moveGizmo,
  } = deps;

  async function updateGrid(documentId: string) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded) {
      grid.three.position.y = 0;
      return;
    }
    const categories = await loaded.model
      .getItemsOfCategories([/BUILDINGSTOREY/])
      .catch(() => ({}));
    const storeyIds = Object.values(categories).flat();
    const storeys = storeyIds.length
      ? await loaded.model.getItemsData(storeyIds).catch(() => [])
      : [];
    const elevations = storeys
      .map((storey) => readNumericAttribute(storey, ["Elevation", "elevation"]))
      .filter((value): value is number => value !== undefined);
    const coordinates = await loaded.model.getCoordinates().catch(() => []);
    const coordinationHeight = Number(coordinates[1] ?? 0);
    const finiteCoordinationHeight = Number.isFinite(coordinationHeight)
      ? coordinationHeight
      : 0;
    let gridElevation: number;
    if (elevations.length) {
      // Elevation is expressed in IFC world coordinates. First convert it to
      // this model's rebased local frame, then include the model.object offset
      // that Fragments applied while coordinating all loaded IFCs.
      const localGridPoint = new THREE.Vector3(
        0,
        Math.min(...elevations) + finiteCoordinationHeight,
        0,
      );
      gridElevation = fragmentModelPointToScene(
        localGridPoint,
        loaded.model.object,
      ).y;
    } else {
      // Some infrastructure IFCs omit IfcBuildingStorey.Elevation. In that
      // case, anchor the grid to the visible model bounds instead of putting
      // it at an unrelated georeferencing origin.
      const gridItems = loaded.fitItems
        ? [...loaded.fitItems]
        : await loaded.model.getLocalIds().catch(() => []);
      const box = gridItems.length
        ? await loaded.model.getMergedBox(gridItems).catch(() => null)
        : null;
      gridElevation = box && !box.isEmpty() ? box.min.y : 0;
    }
    grid.three.position.y = gridElevation;
    callbacks.onLog(
      `viewer.grid({ file: '${loaded.fileName}', elevation: ${formatCoordinate(grid.three.position.y)}, storeys: ${storeyIds.length} });`,
    );
  }

  // Delta-Modelle der Edit-API hängen als eigene Modelle in der Registry und
  // überleben das Dispose ihres Elternmodells. Über die öffentliche
  // parentModelId-Beziehung lassen sie sich ohne Namenskonvention aufräumen.
  async function disposeDeltaModels(baseModelId: string) {
    for (const [modelId, model] of [...fragments.list.entries()]) {
      if (!model.isDeltaModel || model.parentModelId !== baseModelId) {
        continue;
      }
      await fragments.core.disposeModel(modelId).catch(() => undefined);
      callbacks.onLog(
        `viewer.disposeDeltaModel({ modelId: '${modelId}' });`,
      );
    }
  }

  let loadCounter = 0;

  // Serialize reloads: two quick commits would otherwise run syncModels
  // concurrently and can leave an orphaned model instance in the scene.
  let syncQueue: Promise<unknown> = Promise.resolve();

  function syncModels(
    nextModels: ThatOpenViewerModel[],
    options?: { fitAfterLoad?: boolean },
  ) {
    const run = syncQueue.then(
      () => syncModelsInternal(nextModels, options),
      () => syncModelsInternal(nextModels, options),
    );
    syncQueue = run.catch(() => undefined);
    return run;
  }

  async function syncModelsInternal(
    nextModels: ThatOpenViewerModel[],
    options?: { fitAfterLoad?: boolean },
  ) {
    const nextDocumentIds = new Set(
      nextModels.map((model) => model.documentId),
    );
    coordinateCursor.hide();
    // Release any gizmo preview clone before models are disposed/reloaded so
    // no hidden element or orphaned preview mesh survives the reload.
    await moveGizmo.updateSelection(0, null);
    for (const [documentId, loaded] of modelsByDocumentId) {
      if (!nextDocumentIds.has(documentId)) {
        await disposeDeltaModels(loaded.model.modelId);
        await fragments.core
          .disposeModel(loaded.model.modelId)
          .catch(() => undefined);
        modelsByDocumentId.delete(documentId);
        documentIdByModelId.delete(loaded.model.modelId);
      }
    }
    await fragments.resetHighlight().catch(() => undefined);

    for (const nextModel of nextModels) {
      const loadKey = `${nextModel.documentId}:${nextModel.revision}:${nextModel.ifcBytes?.byteLength ?? nextModel.ifcText.length}`;
      const current = modelsByDocumentId.get(nextModel.documentId);
      if (current?.loadKey === loadKey) {
        continue;
      }
      if (current) {
        await disposeDeltaModels(current.model.modelId);
        await fragments.core
          .disposeModel(current.model.modelId)
          .catch(() => undefined);
        modelsByDocumentId.delete(nextModel.documentId);
        documentIdByModelId.delete(current.model.modelId);
      }

      callbacks.onStatus(
        `Converting ${nextModel.fileName} to ThatOpen fragments in worker...`,
      );
      callbacks.onProgress({ fileName: nextModel.fileName, percent: 0 });
      const modelId = `${toModelId(nextModel.fileName)}-${++loadCounter}`;
      const converted = await convertIfcToFragmentsInWorker(
        {
          bytes: nextModel.ifcFile ? null : nextModel.ifcBytes,
          file: nextModel.ifcFile,
          fileName: nextModel.fileName,
          text:
            nextModel.ifcFile || nextModel.ifcBytes ? "" : nextModel.ifcText,
          wasmPath: resolvePublicAssetUrl("wasm/"),
        },
        (progress) => {
          callbacks.onStatus(formatFragmentConversionProgress(progress));
          callbacks.onProgress({
            fileName: nextModel.fileName,
            percent: Math.min(
              99,
              Math.max(0, Math.round(progress.progress * 100)),
            ),
          });
        },
      );
      callbacks.onLog(
        `viewer.convert({ engine: 'worker', file: '${nextModel.fileName}', ms: ${Math.round(converted.elapsedMs)} });`,
      );
      const model = await fragments.core.load(converted.fragments, {
        modelId,
        raw: true,
      });
      // Die Geometrie jedes IFC bleibt für float32-Präzision lokal rebased.
      // Fragments positioniert model.object relativ zum ersten geladenen IFC;
      // die individuelle Welt→Modell-Matrix bleibt für Picks/Schreibpfade.
      const ifcWorldToModel = coordinationToMatrix(
        THREE,
        converted.coordination,
      );
      const modelToIfcWorld = ifcWorldToModel
        ? ifcWorldToModel.clone().invert()
        : null;
      if (modelToIfcWorld) {
        const offset = new THREE.Vector3().setFromMatrixPosition(
          modelToIfcWorld,
        );
        callbacks.onLog(
          `viewer.coordination.detected({ file: '${nextModel.fileName}', originToWorld: { x: ${formatCoordinate(offset.x)}, y: ${formatCoordinate(offset.y)}, z: ${formatCoordinate(offset.z)} } });`,
        );
      }
      const fitModelItems = await getCameraFitLocalIds(model);
      const fitItems =
        fitModelItems.ignored > 0 ? fitModelItems.localIds : undefined;
      if (fitModelItems.ignored > 0) {
        callbacks.onLog(
          `viewer.fit.ignoreOriginMarkers({ file: '${nextModel.fileName}', count: ${fitModelItems.ignored} });`,
        );
      }
      modelsByDocumentId.set(nextModel.documentId, {
        documentId: nextModel.documentId,
        fileName: nextModel.fileName,
        fitItems,
        ifcWorldToModel,
        loadKey,
        mirrorEntityIdByLocalId: new Map(),
        mirrorLocalIdByEntityId: new Map(),
        model,
        modelToIfcWorld,
      });
      documentIdByModelId.set(model.modelId, nextModel.documentId);
      callbacks.onLog(
        `viewer.load({ engine: 'thatopen', file: '${nextModel.fileName}', modelId: '${model.modelId}' });`,
      );
    }
    await fragments.core.update(true);
    await updateGrid(callbacks.getActiveDocumentId());
    callbacks.onProgress(null);
    if (options?.fitAfterLoad ?? true) {
      await fit();
    }
    callbacks.onStatus(
      `ThatOpen loaded ${nextModels.length.toLocaleString()} IFC model(s)`,
    );
    const activeDocumentId = callbacks.getActiveDocumentId();
    await highlight(
      activeDocumentId,
      callbacks.getSelectedId(activeDocumentId),
    );
  }

  // Mirror-Ops laufen durch dieselbe Queue wie die Modell-Reloads: ein Mirror
  // trifft so nie ein gerade neu konvertiertes Modell (das die Änderung schon
  // enthält) und nie ein halb geladenes Modell.
  function applyMirror(request: ViewerMirrorRequest) {
    const run = syncQueue.then(
      () => applyMirrorInternal(request),
      () => applyMirrorInternal(request),
    );
    syncQueue = run.catch(() => undefined);
    return run;
  }

  // Entfernt ein Element aus der Anzeige: konvertierte Elemente werden
  // ausgeblendet (setVisible); per Mirror erzeugte Delta-Elemente reagieren
  // darauf nicht und werden über die Elements-API wieder gelöscht.
  async function removeMirroredElement(
    loaded: LoadedViewerModel,
    entityId: number,
  ) {
    const localId = resolveLocalId(loaded, entityId);
    if (loaded.mirrorLocalIdByEntityId.has(entityId)) {
      const [element] = await fragments.core.editor.getElements(
        loaded.model.modelId,
        [localId],
      );
      if (element) {
        fragments.core.editor.deleteElements(loaded.model.modelId, [element]);
        await fragments.core.editor.applyChanges(loaded.model.modelId);
      }
    } else {
      const [element] = await fragments.core.editor.getElements(
        loaded.model.modelId,
        [localId],
      );
      if (element) {
        await setFragmentElementVisible(
          fragments.core,
          loaded.model,
          element,
          false,
        );
      } else {
        await loaded.model.setVisible([localId], false);
      }
    }
    loaded.mirrorLocalIdByEntityId.delete(entityId);
    loaded.mirrorEntityIdByLocalId.delete(localId);
  }

  async function applyMirrorInternal(
    request: ViewerMirrorRequest,
  ): Promise<ViewerMirrorResult> {
    const finish = (ok: boolean, reason?: string): ViewerMirrorResult => ({
      documentId: request.documentId,
      label: request.label,
      ok,
      pendingKey: request.pendingKey,
      reason,
    });
    const loaded = modelsByDocumentId.get(request.documentId);
    if (!loaded) {
      return finish(false, "model-not-loaded");
    }
    const op = request.op;
    try {
      if (op.kind === "move") {
        const localId = resolveLocalId(loaded, op.entityId);
        const [element] = await fragments.core.editor.getElements(
          loaded.model.modelId,
          [localId],
        );
        if (!element) {
          return finish(false, "no-editable-element");
        }
        const meshes = await element.getMeshes();
        let disposed = false;
        try {
          const sceneDelta = ifcWorldToSceneVector(THREE, loaded, op.delta);
          meshes.position.set(
            meshes.position.x + sceneDelta.x,
            meshes.position.y + sceneDelta.y,
            meshes.position.z + sceneDelta.z,
          );
          meshes.updateMatrixWorld(true);
          await element.setMeshes(meshes);
          element.disposeMeshes(meshes);
          disposed = true;
          const requests = element.getRequests();
          if (requests?.length) {
            await fragments.core.editor.edit(loaded.model.modelId, requests);
          }
          await setFragmentElementVisible(
            fragments.core,
            loaded.model,
            element,
            true,
          );
        } finally {
          if (!disposed) {
            element.disposeMeshes(meshes);
          }
        }
      } else if (op.kind === "remove") {
        await removeMirroredElement(loaded, op.entityId);
      } else if (op.kind === "replace-body") {
        const localId = resolveLocalId(loaded, op.entityId);
        const changed = await replaceFragmentElementGeometry(
          fragments.core,
          loaded.model,
          localId,
          op,
          THREE,
        );
        if (!changed) {
          if (!op.recreate) {
            return finish(false, "no-editable-meshes");
          }
          // Keine editierbaren Meshes (Element ohne Repräsentation oder
          // selbst per Mirror erzeugt): altes Element entfernen und mit den
          // neuen Maßen neu erzeugen.
          await removeMirroredElement(loaded, op.entityId).catch(
            () => undefined,
          );
          const created = await createFragmentBodyElement(
            fragments.core,
            loaded,
            {
              axes: op.recreate.axes,
              category: op.recreate.category,
              depth: op.depth,
              entityId: op.entityId,
              globalId: op.recreate.globalId,
              height: op.height,
              kind: "create-body",
              name: op.recreate.name ?? "",
              position: op.recreate.position,
              profile: op.profile,
              tag: op.recreate.tag,
              width: op.width,
            },
            THREE,
          );
          if (!created) {
            return finish(false, "no-created-element");
          }
          loaded.mirrorEntityIdByLocalId.delete(localId);
          loaded.mirrorLocalIdByEntityId.set(op.entityId, created.localId);
          loaded.mirrorEntityIdByLocalId.set(created.localId, op.entityId);
        }
      } else {
        const created = await createFragmentBodyElement(
          fragments.core,
          loaded,
          op,
          THREE,
        );
        if (!created) {
          return finish(false, "no-created-element");
        }
        // Mapping IMMER setzen — ein Eintrag markiert das Element zugleich
        // als Delta-Element (Sonderbehandlung in Gizmo/Remove/Highlight).
        loaded.mirrorLocalIdByEntityId.set(op.entityId, created.localId);
        loaded.mirrorEntityIdByLocalId.set(created.localId, op.entityId);
      }
      await fragments.core.update(true);
      if (
        request.documentId === callbacks.getActiveDocumentId() &&
        callbacks.getSelectedId(request.documentId) === op.entityId
      ) {
        await highlight(request.documentId, op.entityId).catch(() => undefined);
      }
      callbacks.onLog(
        `viewer.mirror({ kind: '${op.kind}', file: '${loaded.fileName}', id: ${op.entityId} });`,
      );
      return finish(true);
    } catch (reason) {
      return finish(false, stringifyError(reason));
    }
  }

  return {
    applyMirror,
    disposeDeltaModels,
    syncModels,
    updateGrid,
  };
}
