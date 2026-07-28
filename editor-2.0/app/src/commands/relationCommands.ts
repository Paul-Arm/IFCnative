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
import type { IfcAttributeValue, NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../core/session";
import type { OverlayRelation } from "../core/model/relationOverlay";
import {
  readRelationMembers,
  restoreRelationMembers,
  writeRelationMembers,
  type RelationMembers,
} from "../core/model/relationMembers";
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
  /** Für das Redo gesicherter Overlay-Record — hält die expressId stabil. */
  let snapshot: NewEntity | null = null;

  const targetText =
    ids.length === 1 ? `#${ids[0]}` : `${ids.length} Objekte`;

  const link = (relId: number): void => {
    session.relationOverlay.addRelation({
      relExpressId: relId,
      relType: rule.relType,
      ifcClass: rule.ifcClass,
      sourceId,
      targetIds: ids,
    });
    session.invalidateSpatialTree();
  };

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
      link(created);
    },
    undo() {
      if (created === null) return;
      snapshot = session.view.getNewEntity(created);
      session.relationOverlay.dropRelation(created);
      session.editor().removeEntity(created);
      session.invalidateSpatialTree();
      created = null;
    },
    /**
     * Befund 12: `run()` würde über `addEntity` eine NEUE expressId vergeben
     * (und erneut CREATE_ENTITY in die append-only Historie schreiben). Das
     * Redo stellt stattdessen exakt den gesicherten Record wieder her.
     */
    redo() {
      if (!snapshot) {
        this.run();
        return;
      }
      session.view.restoreNewEntity(snapshot);
      created = snapshot.expressId;
      snapshot = null;
      link(created);
    },
  };
}

/**
 * Ein einzelnes Mitglied aus der Related-Liste einer Multi-Target-Beziehung
 * entfernen (Review-Befund 1) — ohne den Record zu tombstonen. Gibt `null`
 * zurück, wenn das nicht möglich ist (Einzel-Target-Klasse, unbekannter
 * Record, oder die Liste wäre danach leer); der Aufrufer löscht dann die
 * ganze Beziehung.
 */
function planMemberRemoval(
  session: ModelSession,
  relId: number,
  memberIds: readonly number[],
): { slot: RelationMembers; remaining: number[] } | null {
  const slot = readRelationMembers(session.store, session.view, relId);
  if (!slot) return null;
  const drop = new Set(memberIds);
  const remaining = slot.members.filter((id) => !drop.has(id));
  if (remaining.length === slot.members.length) return null;
  if (remaining.length === 0) return null;
  return { slot, remaining };
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
  /**
   * Befund 1: Objekte, die NUR aus der Related-Liste fallen sollen. Bleibt
   * danach mindestens ein Mitglied übrig, wird der Record gekürzt statt
   * tombstoned — sonst verlieren die übrigen Mitglieder einer
   * Multi-Target-Beziehung ihre Zuordnung im Export.
   */
  memberIds: readonly number[] = [],
): EditorCommand {
  let previous: OverlayRelation | null = null;
  let newEntity: NewEntity | null = null;
  let tombstoned = false;
  /** gesetzt, wenn nur Mitglieder entfernt wurden */
  let trimmed: {
    slot: RelationMembers;
    removed: number[];
    previousValue: IfcAttributeValue | undefined;
  } | null = null;

  const label =
    memberIds.length > 0
      ? `Beziehung ${description ?? `#${relId}`}: ${memberIds.length} Mitglied(er) entfernt`
      : `Beziehung ${description ?? `#${relId}`} entfernt`;

  const apply = (skipHistory: boolean): void => {
    const plan = memberIds.length > 0
      ? planMemberRemoval(session, relId, memberIds)
      : null;
    if (plan) {
      const removed = plan.slot.members.filter((id) => memberIds.includes(id));
      const previousValue = plan.slot.overlay
        ? (session.view.getNewEntity(relId)?.attributes[plan.slot.index])
        : session.view.getPositionalMutationsForEntity(relId)?.get(plan.slot.index);
      writeRelationMembers(
        session.view,
        relId,
        plan.slot,
        plan.remaining,
        skipHistory,
      );
      for (const id of removed) session.relationOverlay.suppressMember(relId, id);
      trimmed = { slot: plan.slot, removed, previousValue };
    } else {
      newEntity = session.view.getNewEntity(relId);
      previous = session.relationOverlay.removeRelation(relId);
      tombstoned = session.editor().removeEntity(relId) && !newEntity;
    }
    session.invalidateSpatialTree();
  };

  return {
    label,
    run() {
      apply(false);
    },
    undo() {
      if (trimmed) {
        restoreRelationMembers(
          session.view,
          relId,
          trimmed.slot,
          trimmed.previousValue,
          trimmed.previousValue,
        );
        for (const id of trimmed.removed) {
          session.relationOverlay.unsuppressMember(relId, id);
        }
        trimmed = null;
      } else {
        if (newEntity) session.view.restoreNewEntity(newEntity);
        else if (tombstoned) session.view.restoreFromTombstone(relId);
        session.relationOverlay.restoreRelation(relId, previous);
        newEntity = null;
        tombstoned = false;
        previous = null;
      }
      session.invalidateSpatialTree();
    },
    /**
     * Befund 12: Der Kürzungspfad schreibt beim Redo mit `skipHistory`, damit
     * die append-only Mutationsliste nicht bei jedem Redo wächst. Der
     * Tombstone-Pfad hat kein skipHistory-Gegenstück (`deleteEntity` kennt
     * keines) — dort ist `run()` der einzige korrekte Weg.
     */
    redo() {
      apply(true);
    },
  };
}
