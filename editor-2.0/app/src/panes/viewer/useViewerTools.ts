/**
 * Werkzeug-Zustand des Viewers (M9): exklusiver Modus „Verschieben" /
 * „Koordinaten picken", Tastatur (W-Toggle, Esc), Koordinaten-Pick über
 * raycastScene inklusive Zwischenablage, und die Gizmo-Zielbestimmung
 * (genau EIN bewegliches Bauteil, Typname-Heuristik).
 *
 * Aus dem ViewerPane ausgelagert, damit das Pane unter der
 * 300-Zeilen-Grenze bleibt und die Werkzeuglogik an einer Stelle liegt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import type { DocumentEntry } from "../../store/documents";
import type { ViewerTool } from "./ViewerToolbar";
import { usePickStore, type PickPoint } from "./pickStore";
import { isMovableTypeName } from "./gizmoMath";
import {
  formatPointClipboard,
  formatPointStatus,
  rendererToIfcPoint,
  type WorldVec3,
} from "./worldCoords";

export interface ViewerTools {
  tool: ViewerTool;
  /** Toolbar-/Tastatur-Umschaltung (gleiches Werkzeug erneut = aus). */
  selectTool(next: ViewerTool): void;
  /** expressId für das Gizmo oder null (kein/ungeeignetes Ziel). */
  moveTarget: number | null;
  setMoveDelta(delta: WorldVec3 | null): void;
  /** Klick im Pick-Modus: Weltpunkt ermitteln, ablegen, kopieren. */
  performPick(x: number, y: number): void;
  /** Werkzeug-Anzeigen für die Statuszeile. */
  extraParts: string[];
  pickPoint: PickPoint | null;
}

export function useViewerTools(
  access: ViewerOverlayAccess | null,
  doc: DocumentEntry | null,
  docId: string | null,
  selection: readonly number[],
  hiddenIds: ReadonlySet<number>,
  isolated: ReadonlySet<number> | null,
  setNote: (note: string | null) => void,
): ViewerTools {
  const [tool, setTool] = useState<ViewerTool>("none");
  const [moveDelta, setMoveDelta] = useState<WorldVec3 | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number>(0);
  const pickPoint = usePickStore((s) => s.last);

  // Dokumentwechsel: Werkzeug aus.
  useEffect(() => {
    setTool("none");
    setMoveDelta(null);
  }, [docId]);

  const selectTool = useCallback(
    (next: ViewerTool): void => {
      setTool((current) => (current === next ? "none" : next));
      setMoveDelta(null);
      setNote(null);
    },
    [setNote],
  );

  // — Tastatur: W toggelt Verschieben, Esc schaltet das Werkzeug aus —
  useEffect(() => {
    if (!access) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (
        (event.key === "w" || event.key === "W") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        selectTool("move");
      } else if (event.key === "Escape") {
        // Ein laufender Gizmo-Drag fängt Esc selbst ab (capture-Phase).
        setTool("none");
        setMoveDelta(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [access, selectTool]);

  // — Koordinaten-Pick: raycastScene → IFC-Weltpunkt in Metern —
  const performPick = useCallback(
    (x: number, y: number): void => {
      if (!access || !docId) return;
      const hit = access.renderer.raycastScene(x, y, {
        hiddenIds: new Set(hiddenIds),
        isolatedIds: isolated ? new Set(isolated) : null,
        isStreaming: access.isStreaming(),
      });
      if (!hit) {
        setNote("Kein Treffer — zum Picken auf Geometrie klicken.");
        return;
      }
      const point = rendererToIfcPoint(
        hit.intersection.point,
        access.originShift(),
      );
      usePickStore.getState().setPoint(docId, point);
      setNote(null);
      window.clearTimeout(copyTimer.current);
      setCopied(false);
      navigator.clipboard
        ?.writeText(formatPointClipboard(point))
        .then(() => {
          setCopied(true);
          copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => setCopied(false));
    },
    [access, docId, hiddenIds, isolated, setNote],
  );
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // — Gizmo-Ziel: genau EIN bewegliches Bauteil (Typname-Heuristik) —
  const moveTarget = useMemo(() => {
    if (tool !== "move" || !doc || selection.length !== 1) return null;
    const id = selection[0];
    if (doc.session.isDeleted(id)) return null;
    return isMovableTypeName(doc.session.identityOf(id).type) ? id : null;
  }, [tool, doc, selection]);

  // — Werkzeug-Anzeigen der Statuszeile —
  const extraParts: string[] = [];
  if (tool === "move") {
    if (moveDelta)
      extraParts.push(`Verschieben Δ ${formatPointStatus(moveDelta)}`);
    else if (moveTarget !== null)
      extraParts.push("Verschieben: Achsenpfeil ziehen, Esc bricht ab");
    else extraParts.push("Verschieben: genau EIN bewegliches Bauteil wählen");
  }
  if (tool === "pick" && !pickPoint) {
    extraParts.push("Koordinaten picken: Klick auf Geometrie");
  }
  if (pickPoint && pickPoint.docId === docId) {
    extraParts.push(
      `Pick: ${formatPointStatus(pickPoint)}${copied ? " — kopiert" : ""}`,
    );
  }

  return {
    tool,
    selectTool,
    moveTarget,
    setMoveDelta,
    performPick,
    extraParts,
    pickPoint,
  };
}
