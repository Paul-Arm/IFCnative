/**
 * Kantenauswahl und Tastatursteuerung des Graph-Panes (M2).
 *
 * Eine ausgewählte Kante hat Vorrang vor der Objektauswahl: Entf entfernt
 * dann die Beziehung, sonst öffnet es den Kaskadenplan für das zuletzt
 * ausgewählte Objekt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { EdgeMouseHandler } from "@xyflow/react";
import type { GraphEdgeInfo, Neighborhood } from "./useNeighborhood";
import type { GraphEditing } from "./useGraphEditing";

export interface EdgeSelection {
  selectedEdgeId: string | null;
  selectedEdge: GraphEdgeInfo | null;
  onEdgeClick: EdgeMouseHandler;
  onDeleteRelation(): void;
  onDeleteEntity(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export function useEdgeSelection(
  neighborhood: Neighborhood | null,
  editing: GraphEditing,
  lastSelected: number | null,
): EdgeSelection {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Die Auswahl gilt nur für die aktuell dargestellte Nachbarschaft.
  useEffect(() => {
    setSelectedEdgeId(null);
  }, [neighborhood]);

  const selectedEdge = useMemo(
    () => neighborhood?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [neighborhood, selectedEdgeId],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>((_event, edge) => {
    setSelectedEdgeId((current) => (current === edge.id ? null : edge.id));
  }, []);

  const onDeleteRelation = useCallback(() => {
    if (!selectedEdge?.relId) return;
    editing.deleteRelation(
      selectedEdge.relId,
      `${selectedEdge.label} #${selectedEdge.source} → #${selectedEdge.target}`,
    );
    setSelectedEdgeId(null);
  }, [selectedEdge, editing]);

  const onDeleteEntity = useCallback(() => {
    if (lastSelected === null) return;
    editing.requestRemoval(lastSelected);
  }, [lastSelected, editing]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedEdge) {
        event.preventDefault();
        onDeleteRelation();
      } else if (lastSelected !== null) {
        event.preventDefault();
        onDeleteEntity();
      }
    },
    [selectedEdge, lastSelected, onDeleteRelation, onDeleteEntity],
  );

  return {
    selectedEdgeId,
    selectedEdge,
    onEdgeClick,
    onDeleteRelation,
    onDeleteEntity,
    onKeyDown,
  };
}
