/**
 * Szene-Spiegel für committete Transformationen (M10).
 *
 * Nach einem Gizmo-Commit soll das Objekt in der Szene an der neuen Stelle
 * BLEIBEN (kein Zurückspringen bis zum Voll-Rebuild) — aber auch Undo/Redo
 * darf keinen Geister-Offset hinterlassen. Dafür laufen Move-/Rotate-Commits
 * als GESPIEGELTE Commands durch die Pipeline: `run`/`redo` ziehen die Szene
 * mit, `undo` wendet die Inverse an. Buchführung pro Command: rückgängig
 * gemacht wird nur, was zuvor wirklich angewandt wurde (netto null).
 *
 * Dispose-Sicherheit: Commands überleben Viewer-Instanzen (Rebuild startet
 * den Viewer neu, „Undo" kann Minuten später kommen). Deshalb hält der
 * Command NIE einen Viewer-Zugriff, sondern löst ihn beim Aufruf über diese
 * Registry (docId → aktueller ViewerOverlayAccess) auf. Ohne registrierten
 * Viewer wird nichts gespiegelt — die nächste Neuberechnung exportiert den
 * Sitzungsstand und ist damit von selbst konsistent. Die Spiegelung ist in
 * Positions-/Winkelraum komponierbar: Auch eine NACH einem Rebuild neu
 * registrierte Szene (sie zeigt den committeten Stand) landet durch die
 * Undo-Inverse wieder auf dem zurückgenommenen Stand.
 */
import type { EditorCommand } from "../../commands/pipeline";
import type { ViewerOverlayAccess } from "../../core/viewer";
import {
  ifcToRendererDelta,
  ifcToRendererPoint,
  type WorldVec3,
} from "./worldCoords";

const registry = new Map<string, ViewerOverlayAccess>();

/**
 * Aktuellen Viewer-Zugriff eines Dokuments registrieren (ViewerPane-Effekt).
 * Gibt die Abmeldung zurück; eine neuere Registrierung wird nie überschrieben
 * (Schutz gegen Effekt-Cleanup-Reihenfolge bei Viewer-Neustarts).
 */
export function registerSceneMirror(
  docId: string,
  access: ViewerOverlayAccess,
): () => void {
  registry.set(docId, access);
  return () => {
    if (registry.get(docId) === access) registry.delete(docId);
  };
}

/** Nur für Tests: Registry leeren. */
export function resetSceneMirrorForTests(): void {
  registry.clear();
}

export interface MirroredCommand extends EditorCommand {
  /** true, solange der letzte run/redo die Szene wirklich mitgezogen hat. */
  mirrored(): boolean;
}

/**
 * EditorCommand mit Szene-Spiegel umhüllen. `apply` und `revert` erhalten den
 * beim Aufruf LIVE aufgelösten Zugriff; ihr Rückgabewert meldet, ob die Szene
 * die Operation tragen konnte (farb-gemergte Batches: nein → Badge zeigt den
 * Stand erst nach „Neu berechnen").
 */
function mirroredCommand(
  docId: string,
  command: EditorCommand,
  apply: (access: ViewerOverlayAccess) => boolean,
  revert: (access: ViewerOverlayAccess) => boolean,
): MirroredCommand {
  let applied = false;
  const applyNow = (): void => {
    const access = registry.get(docId);
    applied = access ? apply(access) : false;
  };
  return {
    label: command.label,
    mirrored: () => applied,
    run() {
      command.run();
      applyNow();
    },
    undo() {
      command.undo();
      if (applied) {
        const access = registry.get(docId);
        if (access) revert(access);
        // Auch ohne Viewer zurücksetzen: Die Szene existiert nicht mehr,
        // eine spätere Instanz startet ohnehin vom exportierten Stand.
        applied = false;
      }
    },
    redo() {
      if (command.redo) command.redo();
      else command.run();
      applyNow();
    },
  };
}

/**
 * Verschiebe-Command spiegeln: Delta in IFC-Metern (Z-up); der Rahmen-Swap
 * ist linear und translationsfrei, darf also beim Erzeugen erfolgen.
 */
export function mirroredMoveCommand(
  docId: string,
  command: EditorCommand,
  elementId: number,
  ifcDelta: WorldVec3,
): MirroredCommand {
  const delta = ifcToRendererDelta(ifcDelta);
  const inverse = { x: -delta.x, y: -delta.y, z: -delta.z };
  return mirroredCommand(
    docId,
    command,
    (access) => access.applyCommittedDelta(elementId, delta),
    (access) => access.applyCommittedDelta(elementId, inverse),
  );
}

/**
 * Rotations-Command spiegeln: Yaw um die IFC-Z-Achse (rad) um den Pivot in
 * IFC-Metern. Der Pivot wird erst beim Aufruf mit dem originShift der DANN
 * aktuellen Viewer-Instanz in den Renderer-Rahmen übersetzt (RTC-sicher).
 */
export function mirroredRotateCommand(
  docId: string,
  command: EditorCommand,
  elementId: number,
  yawRad: number,
  ifcPivot: WorldVec3,
): MirroredCommand {
  const pivotOf = (access: ViewerOverlayAccess): WorldVec3 =>
    ifcToRendererPoint(ifcPivot, access.originShift());
  return mirroredCommand(
    docId,
    command,
    (access) => access.applyCommittedRotation(elementId, yawRad, pivotOf(access)),
    (access) =>
      access.applyCommittedRotation(elementId, -yawRad, pivotOf(access)),
  );
}
