import { useState, type SetStateAction } from "react";

import {
  planNativeEntityRemoval,
  type NativeEntityRemovalPlan,
  type NativeIfcDocument,
  type NativeIfcEntity,
} from "@/ifc";

import { filterEntitySet, filterGraphPositions } from "../lib/collections";
import { findNextSelectionAfterEntityDelete } from "../lib/entities";
import type { Point } from "../types";
import type { WorkspaceEditContext } from "./context";

export type DeleteEntitySource = "tree" | "graph" | "viewer" | "keyboard";

export interface DeleteEntityRequest {
  documentId: string;
  entity: NativeIfcEntity;
  plan: NativeEntityRemovalPlan;
  sourceDocument: NativeIfcDocument;
  source: DeleteEntitySource;
}

/**
 * Zweistufiges Löschen von Entities: requestDeleteEntity plant die Entfernung
 * und öffnet den Bestätigungs-Dialog, confirmDeleteEntity validiert den Plan
 * gegen den aktuellen Stand und committet ihn (inkl. Graph-Aufräumen).
 */
export function useEntityDeletion(
  context: WorkspaceEditContext & {
    activeSessionId: string;
    graphAnchorId: number;
    graphPositions: Map<number, Point>;
    setGraphAnchorId: (action: SetStateAction<number>) => void;
    setGraphCollapsed: (action: SetStateAction<Set<number>>) => void;
    setGraphExpanded: (action: SetStateAction<Set<number>>) => void;
    setGraphPinned: (action: SetStateAction<Set<number>>) => void;
  },
) {
  const {
    activeSessionId,
    commitDocument,
    document,
    graphAnchorId,
    graphPositions,
    setGraphAnchorId,
    setGraphCollapsed,
    setGraphExpanded,
    setGraphPinned,
  } = context;
  const [deleteRequest, setDeleteRequest] =
    useState<DeleteEntityRequest | null>(null);

  const requestDeleteEntity = (
    entityId: number,
    source: DeleteEntitySource,
  ) => {
    const entity = document.entityById.get(entityId);
    if (!entity || entity.type === "IFCPROJECT") {
      return;
    }
    const plan = planNativeEntityRemoval(document, entityId);
    if (!plan) {
      return;
    }
    setDeleteRequest({
      documentId: activeSessionId,
      entity,
      plan,
      source,
      sourceDocument: document,
    });
  };

  const confirmDeleteEntity = () => {
    const request = deleteRequest;
    if (!request || request.documentId !== activeSessionId) {
      setDeleteRequest(null);
      return;
    }
    const currentEntity = document.entityById.get(request.entity.id);
    const currentPlan =
      request.sourceDocument === document
        ? request.plan
        : planNativeEntityRemoval(document, request.entity.id);
    if (!currentEntity || !currentPlan) {
      setDeleteRequest(null);
      return;
    }
    const entityId = currentEntity.id;
    const next = currentPlan.document;

    const nextSelection = findNextSelectionAfterEntityDelete(
      document,
      next,
      entityId,
    );
    const nextAnchor = next.entityById.has(graphAnchorId)
      ? graphAnchorId
      : next.entityById.has(nextSelection ?? 0)
        ? (nextSelection as number)
        : (next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? graphAnchorId);
    const nextPositions = filterGraphPositions(graphPositions, next);

    setGraphPinned((current) => filterEntitySet(current, next));
    setGraphExpanded((current) => filterEntitySet(current, next));
    setGraphCollapsed((current) => filterEntitySet(current, next));
    setGraphAnchorId(nextAnchor);
    setDeleteRequest(null);

    commitDocument(
      next,
      nextSelection,
      `Delete #${entityId} ${currentEntity.type}`,
      `${request.source}.deleteEntity({ id: ${entityId}, class: '${currentEntity.type}' });`,
      nextPositions,
      {
        pendingKey: `hide:${entityId}`,
        reloadViewer: true,
        viewerMirror: { entityId, kind: "remove" },
      },
    );
  };

  return {
    cancelDeleteEntity: () => setDeleteRequest(null),
    confirmDeleteEntity,
    deleteRequest,
    requestDeleteEntity,
  };
}
