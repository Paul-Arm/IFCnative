/**
 * Commands für Beziehungen (M2).
 *
 * Anlegen schreibt einen echten STEP-Record über `StoreEditor.addEntity` (die
 * IfcRel*-Instanz landet im Mutations-Overlay und wird beim Export
 * materialisiert) und meldet die Kante zusätzlich am `RelationOverlay` an —
 * der RelationshipGraph des Parsers ist statisch und kennt sie sonst nicht.
 *
 * Löschen unterdrückt geparste Beziehungen im Overlay; Overlay-Beziehungen
 * werden zusätzlich aus dem StoreEditor entfernt.
 */
import { generateIfcGuid } from "@ifc-lite/encoding";
import type { NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../core/session";
import type { OverlayRelation } from "../core/model/relationOverlay";
import {
  ruleForClass,
  type RelationClassRule,
} from "../core/model/relationshipRules";
import type { EditorCommand } from "./pipeline";

/** STEP-Argumentwert, wie ihn `StoreEditor.addEntity` erwartet. */
type StepValue = string | number | boolean | null | StepValue[];

/**
 * Positionale Argumentliste je Beziehungsklasse. Die ersten vier Argumente
 * sind bei allen IfcRelationship-Subtypen gleich (GlobalId, OwnerHistory,
 * Name, Description); danach unterscheidet sich die Reihenfolge von
 * Relating-/Related-Seite je Klasse.
 */
function relationAttributes(
  rule: RelationClassRule,
  globalId: string,
  sourceId: number,
  targetIds: readonly number[],
): StepValue[] {
  const head: StepValue[] = [globalId, null, null, null];
  const source = `#${sourceId}`;
  const targets: StepValue[] = targetIds.map((id) => `#${id}`);
  const first = targets[0] ?? null;
  switch (rule.ifcClass) {
    case "IFCRELAGGREGATES":
      // RelatingObject, RelatedObjects[]
      return [...head, source, targets];
    case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
      // RelatedElements[], RelatingStructure
      return [...head, targets, source];
    case "IFCRELDEFINESBYTYPE":
      // RelatedObjects[], RelatingType
      return [...head, targets, source];
    case "IFCRELASSOCIATESMATERIAL":
      // RelatedObjects[], RelatingMaterial
      return [...head, targets, source];
    case "IFCRELCONNECTSELEMENTS":
      // ConnectionGeometry, RelatingElement, RelatedElement
      return [...head, null, source, first];
    case "IFCRELVOIDSELEMENT":
      // RelatingBuildingElement, RelatedOpeningElement
      return [...head, source, first];
    case "IFCRELFILLSELEMENT":
      // RelatingOpeningElement, RelatedBuildingElement
      return [...head, source, first];
    case "IFCRELASSIGNSTOGROUP":
      // RelatedObjects[], RelatedObjectsType, RelatingGroup
      return [...head, targets, null, source];
    default:
      return [...head, source, targets];
  }
}

/** Beziehung anlegen: STEP-Record + Overlay-Kante, gemeinsam undo-bar. */
export function cmdCreateRelation(
  session: ModelSession,
  relClass: string,
  sourceId: number,
  targetIds: readonly number[],
): EditorCommand {
  const rule = ruleForClass(relClass);
  if (!rule) {
    throw new Error(`Unbekannte Beziehungsklasse: ${relClass}`);
  }
  const ids = rule.multiTarget ? [...targetIds] : targetIds.slice(0, 1);
  if (ids.length === 0) {
    throw new Error("Beziehung ohne Ziel kann nicht angelegt werden.");
  }
  const globalId = generateIfcGuid();
  let created: number | null = null;

  const targetText =
    ids.length === 1 ? `#${ids[0]}` : `${ids.length} Objekte`;

  return {
    label: `Beziehung „${rule.label}" #${sourceId} → ${targetText}`,
    run() {
      const ref = session
        .editor()
        .addEntity(
          rule.entityName,
          relationAttributes(rule, globalId, sourceId, ids),
        );
      created = ref.expressId;
      session.relationOverlay.addRelation({
        relExpressId: created,
        relType: rule.relType,
        ifcClass: rule.ifcClass,
        sourceId,
        targetIds: ids,
      });
    },
    undo() {
      if (created === null) return;
      session.relationOverlay.dropRelation(created);
      session.editor().removeEntity(created);
      created = null;
    },
  };
}

/**
 * Beziehung entfernen.
 *
 * Zwei Ebenen, weil beide nötig sind: im Overlay wird die Kante unterdrückt
 * (der CSR des Parsers ist statisch und lässt sich nicht ändern), und im
 * StoreEditor wird die IfcRel*-Instanz entfernt — Overlay-Entities werden
 * vergessen, geparste bekommen einen Tombstone. Ohne den zweiten Schritt
 * stünde die gelöschte Beziehung nach dem Export wieder in der Datei.
 */
export function cmdDeleteRelation(
  session: ModelSession,
  relId: number,
  description?: string,
): EditorCommand {
  let previous: OverlayRelation | null = null;
  let newEntity: NewEntity | null = null;
  let tombstoned = false;

  return {
    label: `Beziehung ${description ?? `#${relId}`} entfernt`,
    run() {
      newEntity = session.view.getNewEntity(relId);
      previous = session.relationOverlay.removeRelation(relId);
      tombstoned = session.editor().removeEntity(relId) && !newEntity;
    },
    undo() {
      if (newEntity) session.view.restoreNewEntity(newEntity);
      else if (tombstoned) session.view.restoreFromTombstone(relId);
      session.relationOverlay.restoreRelation(relId, previous);
      newEntity = null;
      tombstoned = false;
      previous = null;
    },
  };
}
