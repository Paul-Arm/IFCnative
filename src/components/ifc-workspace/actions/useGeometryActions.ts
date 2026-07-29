import {
  addNativeBodyElement,
  addNativeElement,
  assignNativeBodyRepresentation,
  getNativeLengthUnitScale,
  getNativePlacementWorld,
  getNativePlacementWorldFrame,
  getNextNativeEntityId,
  ifcPlacementPointToViewerWorldPoint,
  nativeWorldDirectionInPlacementParentFrame,
  removeNativeBodyRepresentation,
  splitTopLevel,
  updateNativeEntity,
  updateNativePlacement,
  updateNativePlacementRotation,
  updateNativePlacementWorld,
  viewerWorldDeltaToIfcPlacementDelta,
  viewerWorldDirectionToIfcPlacementDirection,
  viewerWorldPointToIfcPlacementPoint,
  type NativeIfcDocument,
} from "@/ifc";

import type { ViewerRotationChange } from "../../that-open-viewer.types";
import { formatCoordinate, readBodyCoordinate } from "../lib/coordinates";
import type { BodyElementDraft, EntityEditDraft } from "../types";
import type { WorkspaceEditContext } from "./context";

// Geerbte Rotation der Platzierungskette (georeferenzierte/rotierte Sites)
// als Basis der Spiegel-Geometrie in Viewer-Weltrichtungen: Geometrie-X =
// IFC-X, Geometrie-Y (hoch) = IFC-Z, Geometrie-Z = -IFC-Y.
function nativePlacementViewerAxes(doc: NativeIfcDocument, entityId: number) {
  const frame = getNativePlacementWorldFrame(doc, entityId);
  if (!frame) {
    return undefined;
  }
  const yIfc = ifcPlacementPointToViewerWorldPoint(frame.yAxis, 1);
  return {
    x: ifcPlacementPointToViewerWorldPoint(frame.xAxis, 1),
    y: ifcPlacementPointToViewerWorldPoint(frame.zAxis, 1),
    z: { x: -yIfc.x, y: -yIfc.y, z: -yIfc.z },
  };
}

/**
 * Geometrie- und Platzierungs-Aktionen: Entity-Rohbearbeitung, Erzeugen und
 * Zuweisen von Körper-Repräsentationen sowie Verschieben/Rotieren über
 * Inspector-Felder und Viewer-Gizmo (mit Live-Mirror in das Fragments-Modell).
 */
export function useGeometryActions(context: WorkspaceEditContext) {
  const { commitDocument, document, logAction, selectedId } = context;

  const saveSelectedEdit = (draft: EntityEditDraft) => {
    const next = updateNativeEntity(document, selectedId, {
      args: splitTopLevel(draft.rawArgs),
      description: draft.description,
      name: draft.name,
      type: draft.type,
    });
    commitDocument(
      next,
      selectedId,
      `Edit #${selectedId} ${draft.type}`,
      `saveEdit({ id: ${selectedId}, class: '${draft.type}' });`,
      undefined,
      { reloadViewer: true },
    );
  };

  const addChildElement = (parentId: number, type: string, name: string) => {
    if (!document.entityById.has(parentId)) {
      return;
    }
    const addedId = getNextNativeEntityId(document);
    const next = addNativeElement(document, parentId, type, name);
    commitDocument(
      next,
      addedId,
      `Create ${type} '${name}' under #${parentId}`,
      `tree.addChildElement({ parentId: ${parentId}, class: '${type}', name: ${JSON.stringify(name)}, id: ${addedId} });`,
      undefined,
      { reloadViewer: true },
    );
  };

  // Der Viewer stellt die Szene in echten IFC-Weltkoordinaten dar (Meter,
  // Y-up; die Koordinationsmatrix der Fragments-Konvertierung wird beim Laden
  // wieder angewendet). Ein Weltmodus-Punkt ist damit direkt eine
  // IFC-Weltkoordinate: nur Achsen tauschen und in Modell-Einheiten skalieren.
  // Die Projektion in die (georeferenzierte) Platzierungskette des Parents —
  // kleine lokale Koordinaten statt riesiger Absolutwerte — übernimmt
  // addNativeBodyElement.
  const addBodyElement = (options: BodyElementDraft) => {
    const parentId = options.parentId ?? selectedId;
    const addedId = getNextNativeEntityId(document);
    const scale = getNativeLengthUnitScale(document);
    const ifcPoint = viewerWorldPointToIfcPlacementPoint(
      {
        x: readBodyCoordinate(options.x),
        y: readBodyCoordinate(options.y),
        z: readBodyCoordinate(options.z),
      },
      scale,
    );
    const next = addNativeBodyElement(document, {
      ...options,
      parentId,
      positionInModelUnits: true,
      x: formatCoordinate(ifcPoint.x),
      y: formatCoordinate(ifcPoint.y),
      z: formatCoordinate(ifcPoint.z),
    });
    const createdWorld = getNativePlacementWorld(next, addedId);
    const createdViewerPoint = createdWorld
      ? ifcPlacementPointToViewerWorldPoint(
          {
            x: createdWorld.worldX,
            y: createdWorld.worldY,
            z: createdWorld.worldZ,
          },
          scale,
        )
      : null;
    if (!createdViewerPoint) {
      // Ohne Weltposition kein Live-Mirror — die Änderung bleibt als
      // ausstehend markiert ("Modell neu berechnen").
      logAction(
        `builder.createBodyMirrorSkipped({ id: ${addedId}, reason: 'no-world-placement' });`,
      );
    }
    commitDocument(
      next,
      addedId,
      `Create ${options.type} '${options.name}' under #${parentId}`,
      `builder.createBodyElement({ class: '${options.type}', name: ${JSON.stringify(options.name)}, parentId: ${parentId}, id: ${addedId}, profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
      undefined,
      {
        pendingKey: `body:${addedId}`,
        reloadViewer: true,
        viewerMirror: createdViewerPoint
          ? {
              axes: nativePlacementViewerAxes(next, addedId),
              category: options.type,
              depth: options.depth,
              entityId: addedId,
              globalId: next.entityById.get(addedId)?.globalId,
              height: options.height,
              kind: "create-body",
              name: options.name,
              position: createdViewerPoint,
              profile: options.profile,
              tag: options.tag,
              width: options.width,
            }
          : undefined,
      },
    );
    logAction(
      `builder.bodyDiagnostics({ id: ${addedId}, mode: '${options.placementMode ?? "parent"}', unitScale: ${scale}, inputViewer: { x: ${options.x}, y: ${options.y}, z: ${options.z} }, ifcInput: { x: ${formatCoordinate(ifcPoint.x)}, y: ${formatCoordinate(ifcPoint.y)}, z: ${formatCoordinate(ifcPoint.z)} }, ifcWorld: { x: ${createdWorld?.worldX ?? "?"}, y: ${createdWorld?.worldY ?? "?"}, z: ${createdWorld?.worldZ ?? "?"} } });`,
    );
  };

  const removeBodyFromSelected = () => {
    const next = removeNativeBodyRepresentation(document, selectedId);
    if (next === document) {
      logAction(
        `builder.removeBodyRepresentation.skip({ id: ${selectedId}, reason: 'no-representation' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Remove geometry of #${selectedId}`,
      `builder.removeBodyRepresentation({ id: ${selectedId} });`,
      undefined,
      {
        pendingKey: `hide:${selectedId}`,
        reloadViewer: true,
        viewerMirror: { entityId: selectedId, kind: "remove" },
      },
    );
  };

  // Dual-Write statt Fragments-first: die Geometrie wird im nativen Dokument
  // (Source of Truth) zugewiesen und nur zur Anzeige in das Fragments-Modell
  // gespiegelt. Vorher lief dieser Pfad umgekehrt (Fragments-Edit + Rebuild
  // des nativen Dokuments aus den Fragments) und verlor dabei STEP-Details.
  const assignBodyToSelected = (options: BodyElementDraft) => {
    const next = assignNativeBodyRepresentation(document, selectedId, options);
    if (next === document) {
      logAction(
        `builder.assignBodyRepresentation.skip({ id: ${selectedId}, reason: 'not-assignable' });`,
      );
      return;
    }
    // Recreate-Rückfall des Mirrors: Weltposition des Produkts, falls das
    // Fragments-Element keine editierbaren Meshes liefert (z. B. bislang
    // ohne Repräsentation oder selbst per Mirror erzeugt).
    const entity = next.entityById.get(selectedId);
    const world = getNativePlacementWorld(next, selectedId);
    const viewerPoint = world
      ? ifcPlacementPointToViewerWorldPoint(
          { x: world.worldX, y: world.worldY, z: world.worldZ },
          getNativeLengthUnitScale(next),
        )
      : null;
    commitDocument(
      next,
      selectedId,
      `Assign geometry to #${selectedId}`,
      `builder.assignBodyRepresentation({ id: ${selectedId}, profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
      undefined,
      {
        pendingKey: `body:${selectedId}`,
        reloadViewer: true,
        viewerMirror: {
          depth: options.depth,
          entityId: selectedId,
          height: options.height,
          kind: "replace-body",
          profile: options.profile,
          recreate: viewerPoint
            ? {
                axes: nativePlacementViewerAxes(next, selectedId),
                category: entity?.type ?? "IFCBUILDINGELEMENTPROXY",
                globalId: entity?.globalId,
                name: entity?.name,
                position: viewerPoint,
              }
            : undefined,
          width: options.width,
        },
      },
    );
  };

  const moveSelectedPlacement = (x: string, y: string, z: string) => {
    const sourceDocument = document;
    const beforeWorld = getNativePlacementWorld(sourceDocument, selectedId);
    const next = updateNativePlacement(sourceDocument, selectedId, { x, y, z });
    const afterWorld = getNativePlacementWorld(next, selectedId);
    // Live-Mirror: Verschiebung als Szenen-Delta (Viewer-Achsen, Meter).
    const scale = getNativeLengthUnitScale(sourceDocument);
    const viewerDelta =
      beforeWorld && afterWorld
        ? ifcPlacementPointToViewerWorldPoint(
            {
              x: afterWorld.worldX - beforeWorld.worldX,
              y: afterWorld.worldY - beforeWorld.worldY,
              z: afterWorld.worldZ - beforeWorld.worldZ,
            },
            scale,
          )
        : null;
    commitDocument(
      next,
      selectedId,
      `Move #${selectedId} placement to (${x}, ${y}, ${z})`,
      `movePlacement({ id: ${selectedId}, x: ${JSON.stringify(x)}, y: ${JSON.stringify(y)}, z: ${JSON.stringify(z)} });`,
      undefined,
      {
        pendingKey: `transform:${selectedId}`,
        reloadViewer: true,
        viewerMirror: viewerDelta
          ? {
              delta: viewerDelta,
              entityId: selectedId,
              kind: "move",
            }
          : undefined,
      },
    );
  };

  const nudgeSelectedPlacement = (
    entityId: number,
    delta: {
      x?: number;
      y?: number;
      z?: number;
    },
  ) => {
    const failNative = (reason: string) => {
      logAction(
        `fragments.viewerDeltaSkipped({ id: ${entityId}, reason: '${reason}' });`,
      );
    };
    if (entityId !== selectedId || !document.entityById.has(entityId)) {
      failNative("selection-changed");
      return null;
    }
    const placement = getNativePlacementWorld(document, entityId);
    if (!placement) {
      failNative("no-native-placement");
      return null;
    }
    // Gizmo-Deltas kommen in Metern (Viewer-Welt) — in Modelleinheiten
    // umrechnen (mm-Modelle!).
    const ifcDelta = viewerWorldDeltaToIfcPlacementDelta(
      delta,
      getNativeLengthUnitScale(document),
    );
    const next = updateNativePlacementWorld(document, entityId, {
      x: placement.worldX + ifcDelta.x,
      y: placement.worldY + ifcDelta.y,
      z: placement.worldZ + ifcDelta.z,
    });
    if (next === document) {
      failNative("placement-update-failed");
      return null;
    }
    const label = `Move #${entityId} placement by viewer delta`;
    const pendingKey = `transform:${entityId}`;
    commitDocument(
      next,
      entityId,
      label,
      `fragments.viewerDeltaCommit({ id: ${entityId}, dx: ${delta.x ?? 0}, dy: ${delta.y ?? 0}, dz: ${delta.z ?? 0} });`,
      undefined,
      {
        pendingKey,
        reloadViewer: true,
      },
    );
    return { label, pendingKey };
  };

  const rotateSelectedPlacement = (
    entityId: number,
    rotation: ViewerRotationChange,
  ) => {
    if (entityId !== selectedId || !document.entityById.has(entityId)) {
      return null;
    }
    const worldAxis = viewerWorldDirectionToIfcPlacementDirection(rotation.axis);
    const worldRefDirection = viewerWorldDirectionToIfcPlacementDirection(
      rotation.refDirection,
    );
    const axis = nativeWorldDirectionInPlacementParentFrame(
      document,
      entityId,
      worldAxis,
    );
    const refDirection = nativeWorldDirectionInPlacementParentFrame(
      document,
      entityId,
      worldRefDirection,
    );
    if (!axis || !refDirection) {
      return null;
    }
    const next = updateNativePlacementRotation(document, entityId, {
      axis,
      refDirection,
    });
    if (next === document) {
      logAction(
        `fragments.viewerRotateSkipped({ id: ${entityId}, reason: 'placement-update-failed' });`,
      );
      return null;
    }
    const label = `Rotate #${entityId} placement with viewer gizmo`;
    const pendingKey = `transform:${entityId}`;
    commitDocument(
      next,
      entityId,
      label,
      `fragments.viewerRotateCommit({ id: ${entityId}, rx: ${rotation.rotation.x ?? 0}, ry: ${rotation.rotation.y ?? 0}, rz: ${rotation.rotation.z ?? 0} });`,
      undefined,
      {
        pendingKey,
        reloadViewer: true,
      },
    );
    return { label, pendingKey };
  };

  return {
    addBodyElement,
    addChildElement,
    assignBodyToSelected,
    moveSelectedPlacement,
    nudgeSelectedPlacement,
    removeBodyFromSelected,
    rotateSelectedPlacement,
    saveSelectedEdit,
  };
}
