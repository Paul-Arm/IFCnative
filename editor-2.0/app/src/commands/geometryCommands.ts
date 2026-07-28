/**
 * Commands des Baukastens (M5): Bauteile mit Extrusionskörper anlegen, ihre
 * Maße ändern, sie verschieben und Öffnungen hineinschneiden.
 *
 * Anlegen folgt dem Muster von `cmdCreateRelation`: `run` emittiert die
 * STEP-Records in das Mutations-Overlay und meldet die neue Beziehung am
 * `RelationOverlay` an (der CSR des Parsers ist statisch), `undo` entfernt
 * beides wieder, und `redo` stellt die gesicherten `NewEntity`-Records
 * wieder her — sonst vergäbe `run()` neue expressIds und schriebe erneut in
 * die append-only Mutationshistorie (Befund 12).
 *
 * Maß- und Positionsänderungen laufen positional (`setPositionalAttribute`
 * bzw. direkt auf `NewEntity.attributes`, siehe `domain/geometry/records.ts`)
 * und nutzen im Redo den `skipHistory`-Pfad.
 */
import { RelationshipType } from "@ifc-lite/data";
import type { NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../core/session";
import {
  isLegalEndpointPair,
  ruleForClass,
} from "../core/model/relationshipRules";
import {
  AXIS_REFDIRECTION_INDEX,
  buildElement,
  buildOpening,
  builderClass,
  planDimensionEdits,
  planMove,
  planRotation,
  planScale,
  restorePositional,
  writePositional,
  type BuildContext,
  type BuildResult,
  type CreateElementParams,
  type CreateOpeningParams,
  type DimensionChange,
  type PlannedEdit,
  type PositionalEdit,
} from "../domain/geometry";
import type { EditorCommand } from "./pipeline";

/** Command, der die expressId seines Ergebnisses nach `run` bereitstellt. */
export interface CreateGeometryCommand extends EditorCommand {
  /** expressId des angelegten Objekts, solange der Command angewandt ist. */
  createdId(): number | null;
}

function contextOf(session: ModelSession): BuildContext {
  return {
    store: session.store,
    view: session.view,
    editor: session.editor(),
  };
}

/** Zahl kompakt und deutsch formatieren (2,75 statt 2.75). */
function fmt(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
}

/** Geplante Änderung schreiben und die Undo-Information zurückgeben. */
function write(
  session: ModelSession,
  planned: PlannedEdit,
  skipHistory: boolean,
): PositionalEdit {
  return writePositional(
    session.view,
    planned.record,
    planned.index,
    planned.value,
    skipHistory,
  );
}

/**
 * Gemeinsames Gerüst für „Records emittieren + Overlay-Kante melden".
 * `emit` liefert die erzeugten Records, `link` hängt die Beziehung ein.
 */
function overlayCreateCommand(
  session: ModelSession,
  label: string,
  emit: () => BuildResult,
  link: (result: { elementId: number; relId: number }) => void,
): CreateGeometryCommand {
  /** Ergebnis des ersten `run` — überlebt Undo, damit Redo dieselben Ids nutzt. */
  let ids: { elementId: number; relId: number } | null = null;
  /** Für das Redo gesicherte Overlay-Records — halten die expressIds stabil. */
  let snapshot: NewEntity[] = [];
  let applied = false;

  return {
    label,
    createdId: () => (applied ? (ids?.elementId ?? null) : null),
    run() {
      const result = emit();
      ids = { elementId: result.elementId, relId: result.relId };
      snapshot = result.created;
      applied = true;
      link(ids);
    },
    undo() {
      if (!applied || !ids) return;
      session.relationOverlay.dropRelation(ids.relId);
      const editor = session.editor();
      for (const entity of [...snapshot].reverse()) {
        editor.removeEntity(entity.expressId);
      }
      session.invalidateSpatialTree();
      applied = false;
    },
    redo() {
      if (!ids || snapshot.length === 0) {
        this.run();
        return;
      }
      for (const entity of snapshot) session.view.restoreNewEntity(entity);
      applied = true;
      link(ids);
    },
  };
}

/**
 * Bauteil mit Extrusionskörper unterhalb eines räumlichen Knotens anlegen
 * (Records + IfcRelContainedInSpatialStructure).
 */
export function cmdCreateElement(
  session: ModelSession,
  parentId: number,
  params: CreateElementParams,
): CreateGeometryCommand {
  const def = builderClass(params.klasse);
  const name = params.name.trim() || def.label;
  return overlayCreateCommand(
    session,
    `${def.label} „${name}" in ${session.labelOf(parentId)} angelegt`,
    () => buildElement(contextOf(session), parentId, params),
    ({ elementId, relId }) => {
      session.relationOverlay.addRelation({
        relExpressId: relId,
        relType: RelationshipType.ContainsElements,
        ifcClass: "IFCRELCONTAINEDINSPATIALSTRUCTURE",
        sourceId: parentId,
        targetIds: [elementId],
      });
      session.invalidateSpatialTree();
    },
  );
}

/**
 * Öffnung in ein Bauteil schneiden (IfcOpeningElement + IfcRelVoidsElement).
 * Die Endpunkt-Legalität kommt aus derselben Regeltabelle wie im Graphen.
 */
export function cmdCreateOpening(
  session: ModelSession,
  hostId: number,
  params: CreateOpeningParams,
): CreateGeometryCommand {
  const rule = ruleForClass("IFCRELVOIDSELEMENT");
  if (!rule) throw new Error("Regel für IfcRelVoidsElement fehlt.");
  const hostType = session.identityOf(hostId).type;
  if (!isLegalEndpointPair(rule, hostType, "IfcOpeningElement")) {
    throw new Error(
      `${hostType} darf keine Öffnung aufnehmen (Regel „${rule.label}").`,
    );
  }
  const name = params.name.trim() || "Öffnung";
  return overlayCreateCommand(
    session,
    `Öffnung „${name}" in ${session.labelOf(hostId)} (${fmt(params.breite)} × ${fmt(params.hoehe)} m)`,
    () => buildOpening(contextOf(session), hostId, params),
    ({ elementId, relId }) => {
      session.relationOverlay.addRelation({
        relExpressId: relId,
        relType: RelationshipType.VoidsElement,
        ifcClass: "IFCRELVOIDSELEMENT",
        sourceId: hostId,
        targetIds: [elementId],
      });
      session.invalidateSpatialTree();
    },
  );
}

/** Beschriftung der Maßänderung („Breite 5 m, Extrusion 3 m"). */
function dimensionLabel(change: DimensionChange): string {
  const parts: string[] = [];
  if (change.xDim !== undefined) parts.push(`Breite ${fmt(change.xDim)} m`);
  if (change.yDim !== undefined) parts.push(`Tiefe ${fmt(change.yDim)} m`);
  if (change.radius !== undefined) parts.push(`Radius ${fmt(change.radius)} m`);
  if (change.depth !== undefined)
    parts.push(`Extrusion ${fmt(change.depth)} m`);
  return parts.join(", ");
}

/**
 * Maße einer bestehenden Extrusion ändern: XDim/YDim (Rechteck) bzw. Radius
 * (Kreis) am Profil, Depth am IfcExtrudedAreaSolid. Eingaben in Metern.
 */
export function cmdUpdateDimensions(
  session: ModelSession,
  elementId: number,
  change: DimensionChange,
): EditorCommand {
  let edits: PositionalEdit[] = [];

  const apply = (skipHistory: boolean): void => {
    const planned = planDimensionEdits(contextOf(session), elementId, change);
    edits = planned.map((edit) => write(session, edit, skipHistory));
  };

  return {
    label: `Maße ${session.labelOf(elementId)}: ${dimensionLabel(change)}`,
    run() {
      apply(false);
    },
    undo() {
      for (const edit of [...edits].reverse()) {
        restorePositional(session.view, edit);
      }
      edits = [];
    },
    /** Befund 12: Redo schreibt mit skipHistory, damit die Historie nicht wächst. */
    redo() {
      apply(true);
    },
  };
}

/**
 * Bauteil drehen (Yaw um die IFC-Z-Achse): legt eine neue IfcDirection an
 * und setzt sie als RefDirection des IfcAxis2Placement3D der Platzierung.
 * Delta in Radiant, relativ zum aktuellen Winkel.
 */
export function cmdRotateElement(
  session: ModelSession,
  elementId: number,
  deltaRad: number,
): EditorCommand {
  let edit: PositionalEdit | null = null;
  /** Für das Redo gesicherter IfcDirection-Record (stabile expressId). */
  let dirSnapshot: NewEntity | null = null;

  const degrees = Math.round((deltaRad * 180) / Math.PI * 10) / 10;
  const round9 = (value: number): number => Math.round(value * 1e9) / 1e9;

  return {
    label: `${session.labelOf(elementId)} gedreht (${fmt(degrees)}°)`,
    run() {
      const plan = planRotation(contextOf(session), elementId);
      const angle = plan.currentRad + deltaRad;
      const ref = session.editor().addEntity("IfcDirection", [
        [round9(Math.cos(angle)), round9(Math.sin(angle)), 0],
      ]);
      const created = session.view.getNewEntity(ref.expressId);
      dirSnapshot = created
        ? { ...created, attributes: [...created.attributes] }
        : null;
      edit = writePositional(
        session.view,
        plan.axis,
        AXIS_REFDIRECTION_INDEX,
        `#${ref.expressId}`,
        false,
      );
    },
    undo() {
      if (edit) restorePositional(session.view, edit);
      if (dirSnapshot) session.editor().removeEntity(dirSnapshot.expressId);
      edit = null;
    },
    /** Befund 12: Redo stellt den gesicherten Record wieder her. */
    redo() {
      if (!dirSnapshot) {
        this.run();
        return;
      }
      session.view.restoreNewEntity(dirSnapshot);
      const plan = planRotation(contextOf(session), elementId);
      edit = writePositional(
        session.view,
        plan.axis,
        AXIS_REFDIRECTION_INDEX,
        `#${dirSnapshot.expressId}`,
        true,
      );
    },
  };
}

/**
 * Bauteil skalieren: Faktoren wirken als Maßänderung an der parametrischen
 * Extrusion (XDim/YDim bzw. Radius, Depth) — nur für Bauteile mit
 * Rechteck-/Kreisprofil möglich.
 */
export function cmdScaleElement(
  session: ModelSession,
  elementId: number,
  factors: { x: number; y: number; z: number },
): EditorCommand {
  let edits: PositionalEdit[] = [];

  const apply = (skipHistory: boolean): void => {
    const planned = planScale(contextOf(session), elementId, factors);
    edits = planned.map((planEntry) => write(session, planEntry, skipHistory));
  };

  const factorText = [factors.x, factors.y, factors.z]
    .map((value) => `×${fmt(Math.round(value * 100) / 100)}`)
    .join(" / ");

  return {
    label: `${session.labelOf(elementId)} skaliert (${factorText})`,
    run() {
      apply(false);
    },
    undo() {
      for (const edit of [...edits].reverse()) {
        restorePositional(session.view, edit);
      }
      edits = [];
    },
    redo() {
      apply(true);
    },
  };
}

/**
 * Bauteil verschieben: mutiert den IfcCartesianPoint der Location des
 * IfcLocalPlacement. Deltas in Metern, gespeichert wird in Modelleinheiten.
 */
export function cmdMoveElement(
  session: ModelSession,
  elementId: number,
  dx: number,
  dy: number,
  dz: number,
): EditorCommand {
  let edit: PositionalEdit | null = null;

  const apply = (skipHistory: boolean): void => {
    const planned = planMove(contextOf(session), elementId, dx, dy, dz);
    edit = write(session, planned, skipHistory);
  };

  return {
    label: `${session.labelOf(elementId)} verschoben (Δ ${fmt(dx)} / ${fmt(dy)} / ${fmt(dz)} m)`,
    run() {
      apply(false);
    },
    undo() {
      if (edit) restorePositional(session.view, edit);
      edit = null;
    },
    redo() {
      apply(true);
    },
  };
}
