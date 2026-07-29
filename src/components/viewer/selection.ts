import {
  readItemData,
  readNumericAttribute,
  readStringAttribute,
} from "./fragment-attributes";
import type { CoordinateCursor } from "./coordinate-cursor";
import type { MoveGizmo } from "./move-gizmo";
import {
  resolveLocalId,
  sceneToIfcWorldPoint,
  type LoadedViewerModel,
  type ThreeModule,
  type ViewerRuntimeCallbacks,
} from "./runtime-shared";
import type { ViewerScene } from "./scene-setup";
import { formatCoordinate } from "./utils";

export type ViewerSelection = ReturnType<typeof createViewerSelection>;

export function createViewerSelection(deps: {
  FRAGS: typeof import("@thatopen/fragments");
  THREE: ThreeModule;
  callbacks: ViewerRuntimeCallbacks;
  canvas: HTMLCanvasElement;
  coordinateCursor: CoordinateCursor;
  documentIdByModelId: Map<string, string>;
  fragments: ViewerScene["fragments"];
  modelsByDocumentId: Map<string, LoadedViewerModel>;
  moveGizmo: MoveGizmo;
  world: ViewerScene["world"];
}) {
  const {
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
  } = deps;

  const selectionMaterial = {
    color: new THREE.Color(0xffb703),
    customId: "ifcnative-selection",
    opacity: 0.95,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    transparent: false,
  };

  let pointerDown: { x: number; y: number } | null = null;

  const trackPointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  };

  const selectFromPointer = async (event: MouseEvent) => {
    if (!modelsByDocumentId.size || !world.renderer) {
      return;
    }
    if (moveGizmo.isDragging()) {
      return;
    }
    if (pointerDown) {
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      pointerDown = null;
      if (Math.hypot(dx, dy) > 4) {
        return;
      }
    }
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }
    const mouse = new THREE.Vector2(event.clientX, event.clientY);
    const result = await fragments.raycast({
      camera: world.camera.three,
      dom: canvas,
      mouse,
    });
    const localId = result?.localId;
    if (!localId || !Number.isFinite(localId)) {
      callbacks.onLog("viewer.selectMiss({ engine: 'thatopen' });");
      return;
    }
    // Per Edit-API erzeugte/bearbeitete Elemente rendern in einem separaten
    // Delta-Modell. Für Auswahl/Daten dessen öffentliche Elternbeziehung
    // verwenden.
    const hitModel = fragments.list.get(result.fragments.modelId);
    const modelId = hitModel?.parentModelId ?? result.fragments.modelId;
    const documentId = documentIdByModelId.get(modelId);
    const loadedModel = documentId
      ? modelsByDocumentId.get(documentId)
      : undefined;
    if (!documentId || !loadedModel) {
      callbacks.onLog(
        `viewer.selectUnknownModel({ engine: 'thatopen', modelId: '${modelId}' });`,
      );
      return;
    }
    const itemData = await readItemData(fragments, modelId, localId);
    const entityId = readNumericAttribute(itemData, [
      "expressID",
      "ExpressID",
      "expressId",
      "_localId",
      "localId",
    ]);
    const globalId = readStringAttribute(itemData, [
      "GlobalId",
      "GlobalID",
      "globalId",
      "guid",
    ]);
    // Per Mirror erzeugte Elemente tragen eine Fragments-eigene localId — das
    // Id-Mapping hat Vorrang: ihre Attribut-Ids (_localId) sind Fragments-Ids,
    // keine nativen Express-Ids.
    const mappedEntityId = loadedModel.mirrorEntityIdByLocalId.get(localId);
    const resolvedEntityId = mappedEntityId ?? entityId ?? localId;
    if (callbacks.isCoordinatePickerActive()) {
      coordinateCursor.show(
        result.point,
        result.ray?.origin ?? world.camera.three.position,
        world.camera.three.position.distanceTo(result.point),
      );
      callbacks.onCoordinatePickerUsed();
      // Der Szenenraum ist bei georeferenzierten Modellen zum Ursprung
      // rebased (float32-Präzision). Für Builder/Clipboard wird der Pick
      // explizit in echte IFC-Weltkoordinaten (Viewer-Achsen) umgerechnet.
      const ifcPoint = sceneToIfcWorldPoint(THREE, loadedModel, result.point);
      callbacks.onPickCoordinates({
        documentId,
        entityId: resolvedEntityId,
        fileName: loadedModel.fileName,
        globalId,
        localId,
        modelId,
        source: "thatopen",
        x: ifcPoint.x,
        y: ifcPoint.y,
        z: ifcPoint.z,
      });
      callbacks.onLog(
        `viewer.coordinates.pick({ file: '${loadedModel.fileName}', scene: { x: ${formatCoordinate(result.point.x)}, y: ${formatCoordinate(result.point.y)}, z: ${formatCoordinate(result.point.z)} }, ifcWorld: { x: ${formatCoordinate(ifcPoint.x)}, y: ${formatCoordinate(ifcPoint.y)}, z: ${formatCoordinate(ifcPoint.z)} }, localId: ${localId} });`,
      );
      await fragments.core.update(true);
    }
    callbacks.onSelect(resolvedEntityId, "thatopen", globalId, documentId);
    callbacks.onLog(
      `viewer.select({ engine: 'thatopen', file: '${loadedModel.fileName}', localId: ${localId}, entityId: ${resolvedEntityId}${globalId ? `, globalId: '${globalId}'` : ""} });`,
    );
    if (documentId === callbacks.getActiveDocumentId()) {
      await highlight(documentId, resolvedEntityId);
    }
  };

  let highlightRequest = 0;
  let highlightQueue: Promise<unknown> = Promise.resolve();

  function highlight(
    documentId: string,
    entityId: number,
    options?: { updateGizmo?: boolean },
  ) {
    const request = ++highlightRequest;
    const run = highlightQueue.then(async () => {
      if (request !== highlightRequest) {
        return;
      }
      await highlightInternal(documentId, entityId, options);
    });
    highlightQueue = run.catch(() => undefined);
    return run;
  }

  async function highlightInternal(
    documentId: string,
    entityId: number,
    options?: { updateGizmo?: boolean },
  ) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(entityId) || entityId <= 0) {
      return;
    }
    const localId = resolveLocalId(loaded, entityId);
    // Auch die Delta-Modelle des Elternmodells einfärben — per Edit-API
    // erzeugte/verschobene Elemente rendern dort, nicht im Basismodell.
    const targets: Record<string, Set<number>> = {};
    for (const [modelId, model] of fragments.list) {
      if (
        modelId === loaded.model.modelId ||
        (model.isDeltaModel && model.parentModelId === loaded.model.modelId)
      ) {
        targets[modelId] = new Set([localId]);
      }
    }
    await fragments.resetHighlight();
    await fragments.highlight(selectionMaterial, targets);
    await fragments.core.update(true);
    if (options?.updateGizmo ?? true) {
      await moveGizmo.updateSelection(localId, loaded.model);
    }
  }

  async function fit() {
    if (!modelsByDocumentId.size) {
      return;
    }
    const activeDocumentId = callbacks.getActiveDocumentId();
    const activeModel = modelsByDocumentId.get(activeDocumentId);
    if (activeModel) {
      await moveGizmo.updateSelection(
        resolveLocalId(activeModel, callbacks.getSelectedId(activeDocumentId)),
        activeModel.model,
      );
    }
    await world.camera.fitToItems(getFitItems());
  }

  async function focusSelected(documentId: string, entityId: number) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(entityId) || entityId <= 0) {
      return;
    }
    const localId = resolveLocalId(loaded, entityId);
    await highlight(documentId, entityId).catch(() => undefined);
    await world.camera
      .fitToItems({
        [loaded.model.modelId]: new Set([localId]),
      })
      .catch(() => fit());
    callbacks.onLog(
      `viewer.camera.center({ file: '${loaded.fileName}', id: ${entityId} });`,
    );
  }

  async function resetCamera() {
    await world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0, true);
    if (modelsByDocumentId.size) {
      await fragments.core.update(true);
      const activeDocumentId = callbacks.getActiveDocumentId();
      await highlight(
        activeDocumentId,
        callbacks.getSelectedId(activeDocumentId),
      );
    }
  }

  function getFitItems() {
    const entries = [...modelsByDocumentId.values()].flatMap((loaded) =>
      loaded.fitItems ? [[loaded.model.modelId, loaded.fitItems] as const] : [],
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  return {
    fit,
    focusSelected,
    highlight,
    resetCamera,
    selectFromPointer,
    trackPointerDown,
  };
}
