import type { SetStateAction } from "react";

import {
  addNativeElement,
  addNativeRelationship,
  getNextNativeEntityId,
  removeNativeRelationship,
  updateNativeRelationship,
} from "@/ifc";

import type { RelationshipFlowClipboardNode } from "../../relationship-flow.types";
import { addToSet, removeFromSet } from "../lib/collections";
import { graphCopyName } from "../lib/entities";
import type { Point } from "../types";
import type { WorkspaceEditContext } from "./context";

/**
 * Beziehungen zwischen Objekten — inklusive der Graph-Interaktionen, die
 * neben dem Dokument auch den Graph-Zustand (Pins, auf-/zugeklappte Knoten,
 * Positionen) der aktiven Session fortschreiben.
 */
export function useRelationshipActions(
  context: WorkspaceEditContext & {
    graphPositions: Map<number, Point>;
    setGraphCollapsed: (action: SetStateAction<Set<number>>) => void;
    setGraphExpanded: (action: SetStateAction<Set<number>>) => void;
    setGraphPinned: (action: SetStateAction<Set<number>>) => void;
  },
) {
  const {
    commitDocument,
    document,
    graphPositions,
    logAction,
    selectedId,
    setGraphCollapsed,
    setGraphExpanded,
    setGraphPinned,
  } = context;

  const addRelationship = (
    type: string,
    sourceId: number,
    targetId: number,
  ) => {
    const next = addNativeRelationship(document, type, sourceId, targetId);
    commitDocument(
      next,
      targetId,
      `Add ${type} from #${sourceId} to #${targetId}`,
      `addRelationship({ class: '${type}', sourceId: ${sourceId}, targetId: ${targetId} });`,
    );
  };

  const editRelationship = (
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ) => {
    const next = updateNativeRelationship(document, relationshipId, {
      sourceId,
      targetId,
      type,
    });
    commitDocument(
      next,
      selectedId,
      `Update relationship #${relationshipId} ${type}`,
      `updateRelationship({ id: ${relationshipId}, class: '${type}' });`,
    );
  };

  const deleteRelationship = (relationshipId: number) => {
    const relationship = document.relationships.find(
      (item) => item.id === relationshipId,
    );
    const nextSelection = relationship?.sourceIds.includes(selectedId)
      ? relationship.targetIds[0]
      : relationship?.sourceIds[0];
    const next = removeNativeRelationship(document, relationshipId);
    commitDocument(
      next,
      nextSelection && next.entityById.has(nextSelection)
        ? nextSelection
        : selectedId,
      `Delete relationship #${relationshipId}${relationship ? ` ${relationship.type}` : ""}`,
      `deleteRelationship({ id: ${relationshipId} });`,
    );
  };

  const addGraphConnectedNode = (
    sourceId: number,
    type: string,
    name: string,
    relationshipType: string,
    position: Point,
  ) => {
    const addedId = getNextNativeEntityId(document);
    const withElement = addNativeElement(document, undefined, type, name);
    const next = addNativeRelationship(
      withElement,
      relationshipType,
      sourceId,
      addedId,
    );
    const nextPositions = new Map(graphPositions);
    nextPositions.set(addedId, position);
    commitDocument(
      next,
      addedId,
      `Create ${type} '${name}' from graph and connect #${sourceId} -> #${addedId}`,
      `graph.addConnectedNode({ sourceId: ${sourceId}, class: '${type}', relationship: '${relationshipType}', targetId: ${addedId} });`,
      nextPositions,
    );
    setGraphPinned((current) => addToSet(addToSet(current, sourceId), addedId));
    setGraphExpanded((current) => addToSet(current, sourceId));
    setGraphCollapsed((current) => removeFromSet(current, sourceId));
  };

  const connectGraphNodes = (
    sourceId: number,
    targetId: number,
    relationshipType: string,
  ) => {
    const next = addNativeRelationship(
      document,
      relationshipType,
      sourceId,
      targetId,
    );
    commitDocument(
      next,
      targetId,
      `Connect graph nodes #${sourceId} -> #${targetId} with ${relationshipType}`,
      `graph.addRelationship({ class: '${relationshipType}', sourceId: ${sourceId}, targetId: ${targetId} });`,
      new Map(graphPositions),
    );
    setGraphPinned((current) =>
      addToSet(addToSet(current, sourceId), targetId),
    );
    setGraphExpanded((current) => addToSet(current, sourceId));
    setGraphCollapsed((current) => removeFromSet(current, sourceId));
  };

  const pasteGraphNodes = (
    sourceId: number,
    relationshipType: string,
    copiedNodes: RelationshipFlowClipboardNode[],
    connect: boolean,
  ) => {
    if (
      (connect && !document.entityById.has(sourceId)) ||
      copiedNodes.length === 0
    ) {
      return;
    }
    const pasteableNodes = copiedNodes.filter(
      (node) => node.type !== "IFCPROJECT",
    );
    if (!pasteableNodes.length) {
      logAction("graph.pasteNodesSkipped({ reason: 'no-pasteable-nodes' });");
      return;
    }

    let next = document;
    const nextPositions = new Map(graphPositions);
    const pastedIds: number[] = [];
    pasteableNodes.forEach((node, index) => {
      const addedId = getNextNativeEntityId(next);
      const withElement = addNativeElement(
        next,
        undefined,
        node.type,
        graphCopyName(node.name, node.type, index),
      );
      next = connect
        ? addNativeRelationship(
            withElement,
            relationshipType,
            sourceId,
            addedId,
          )
        : withElement;
      nextPositions.set(addedId, { x: node.x, y: node.y });
      pastedIds.push(addedId);
    });

    commitDocument(
      next,
      pastedIds[pastedIds.length - 1],
      connect
        ? `Paste ${pastedIds.length.toLocaleString()} graph node${pastedIds.length === 1 ? "" : "s"} under #${sourceId}`
        : `Paste ${pastedIds.length.toLocaleString()} graph node${pastedIds.length === 1 ? "" : "s"} without relationships`,
      `graph.pasteNodesCommit({ sourceId: ${sourceId}, relationship: '${relationshipType}', connect: ${connect}, ids: [${pastedIds.join(", ")}] });`,
      nextPositions,
    );
    setGraphPinned(
      (current) =>
        new Set([...current, ...(connect ? [sourceId] : []), ...pastedIds]),
    );
    if (connect) {
      setGraphExpanded((current) => addToSet(current, sourceId));
      setGraphCollapsed((current) => removeFromSet(current, sourceId));
    }
  };

  return {
    addGraphConnectedNode,
    addRelationship,
    connectGraphNodes,
    deleteRelationship,
    editRelationship,
    pasteGraphNodes,
  };
}
