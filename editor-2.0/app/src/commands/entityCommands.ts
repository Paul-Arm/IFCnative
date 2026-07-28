/**
 * Commands für Objekte (M2): Löschen mit Kaskade und Umklassifizieren.
 *
 * Gelöscht wird ausschließlich im Mutations-Overlay: bestehende Entities
 * bekommen einen Tombstone (`view.deleteEntity`), Overlay-Entities werden
 * vergessen. Beziehungen an gelöschten Objekten würden sonst ins Leere
 * zeigen, deshalb nimmt der Kaskadenplan sie mit.
 */
import { RelationshipType } from "@ifc-lite/data";
import type { NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../core/session";
import type { EditorCommand } from "./pipeline";
import { cmdDeleteRelation } from "./relationCommands";

export interface RemovalPlanItem {
  id: number;
  label: string;
}

export interface RemovalPlan {
  entities: RemovalPlanItem[];
  relations: RemovalPlanItem[];
}

/** Obergrenze gegen zyklische oder absurd große Aggregationsbäume. */
const CASCADE_LIMIT = 5000;

/**
 * Kaskadenplan für das Löschen eines Objekts: das Objekt selbst, rekursiv
 * seine Aggregations-Kinder (forward über IfcRelAggregates) und alle
 * Beziehungen, die an einem dieser Objekte hängen.
 */
export function planEntityRemoval(
  session: ModelSession,
  expressId: number,
): RemovalPlan {
  const seen = new Set<number>();
  const order: number[] = [];
  const queue: number[] = [expressId];

  while (queue.length > 0 && order.length < CASCADE_LIMIT) {
    const current = queue.shift() as number;
    if (seen.has(current)) continue;
    seen.add(current);
    order.push(current);
    for (const row of session.relationsOf(current)) {
      if (row.direction !== "forward") continue;
      if (row.relType !== RelationshipType.Aggregates) continue;
      if (!seen.has(row.otherId)) queue.push(row.otherId);
    }
  }

  const relations = new Map<number, string>();
  for (const id of order) {
    for (const row of session.relationsOf(id)) {
      if (!row.relId) continue;
      if (relations.has(row.relId)) continue;
      relations.set(row.relId, `${row.label} (#${row.relId})`);
    }
  }

  return {
    entities: order.map((id) => ({ id, label: session.labelOf(id) })),
    relations: [...relations.entries()].map(([id, label]) => ({ id, label })),
  };
}

/** Objekt samt Aggregations-Kindern und allen Beziehungen löschen. */
export function cmdDeleteEntityCascade(
  session: ModelSession,
  expressId: number,
): EditorCommand {
  const plan = planEntityRemoval(session, expressId);
  const relationCommands = plan.relations.map((relation) =>
    cmdDeleteRelation(session, relation.id, relation.label),
  );
  let removed: Array<{ id: number; newEntity: NewEntity | null }> = [];

  return {
    label:
      `${session.labelOf(expressId)} gelöscht` +
      ` (${plan.entities.length} Objekte, ${plan.relations.length} Beziehungen)`,
    run() {
      for (const command of relationCommands) command.run();
      removed = [];
      for (const entity of plan.entities) {
        const newEntity = session.view.getNewEntity(entity.id);
        if (session.view.deleteEntity(entity.id)) {
          removed.push({ id: entity.id, newEntity });
        }
      }
    },
    undo() {
      for (const entry of [...removed].reverse()) {
        if (entry.newEntity) session.view.restoreNewEntity(entry.newEntity);
        else session.view.restoreFromTombstone(entry.id);
      }
      removed = [];
      for (const command of [...relationCommands].reverse()) command.undo();
    },
  };
}

/**
 * IFC-Klasse eines Objekts ändern (Reklassifizierung). Die expressId bleibt,
 * damit Geometrie, Verortung und alle IfcRel*-Referenzen erhalten bleiben.
 */
export function cmdReclassEntity(
  session: ModelSession,
  expressId: number,
  newType: string,
  predefinedType: string | null = null,
): EditorCommand {
  const view = session.view;
  const oldType = session.identityOf(expressId).type;
  const previous = view.getEntityTypeMutation(expressId);

  return {
    label: `Klasse #${expressId}: ${oldType} → ${newType}`,
    run() {
      view.setEntityType(expressId, newType, predefinedType, oldType);
    },
    undo() {
      if (previous) {
        view.setEntityType(
          expressId,
          previous.newType,
          previous.predefinedType ?? null,
          previous.oldType,
          true,
        );
      } else {
        view.removeTypeMutation(expressId);
      }
    },
  };
}
