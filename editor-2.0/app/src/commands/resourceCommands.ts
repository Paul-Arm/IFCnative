/**
 * Commands für Ressourcen-Zuordnungen (M9): Material, Materialschichten,
 * Klassifikation, Dokument, Gruppe/Zone/System, Typ, SI-Einheiten und
 * räumliche Kinder für das Baum-Kontextmenü.
 *
 * Das gemeinsame run/undo/redo-Gerüst (Records + Overlay-Kante, Undo über
 * removeEntity, Redo über restoreNewEntity mit stabilen expressIds) liegt in
 * `domain/resources/assign.ts`; die Record-Layouts in `emit.ts`/`objects.ts`.
 */
import { RelationshipType } from "@ifc-lite/data";
import type { NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../core/session";
import type { EditorCommand } from "./pipeline";
import { cmdCreateRelation } from "./relationCommands";
import { countText, resourceAssignCommand } from "../domain/resources/assign";
import {
  emitClassificationReference,
  emitDocumentReference,
  emitLayerSetUsage,
  emitMaterial,
  enumOf,
  stepRefs,
  type ClassificationParams,
  type DocumentParams,
  type LayerUsageParams,
  type StepValue,
} from "../domain/resources/emit";
import {
  emitGroup,
  emitSpatialElement,
  emitTypeObject,
  spatialClassDef,
  typeClassDef,
  type GroupClass,
} from "../domain/resources/objects";
import { unitAssignmentOf } from "../domain/resources/read";

/** IFCMATERIAL (neu oder vorhandenes wählen) + IFCRELASSOCIATESMATERIAL. */
export function cmdAssignMaterial(
  session: ModelSession,
  targetIds: readonly number[],
  params: { materialId?: number | null; name: string; category?: string },
): EditorCommand {
  return resourceAssignCommand(session, {
    label: `Material „${params.name || `#${params.materialId}`}" → ${countText(targetIds)}`,
    relType: RelationshipType.AssociatesMaterial,
    ifcClass: "IFCRELASSOCIATESMATERIAL",
    relName: "Material",
    targetIds,
    resource: (out) =>
      params.materialId ??
      emitMaterial(session, out, params.name, params.category ?? ""),
  });
}

/** LayerSet + LayerSetUsage (Richtung/Offset) + IFCRELASSOCIATESMATERIAL. */
export function cmdAssignMaterialLayers(
  session: ModelSession,
  targetIds: readonly number[],
  params: LayerUsageParams,
): EditorCommand {
  if (params.layers.length === 0) {
    throw new Error("Schichtaufbau ohne Schichten kann nicht angelegt werden.");
  }
  return resourceAssignCommand(session, {
    label: `Materialschichten „${params.setName}" → ${countText(targetIds)}`,
    relType: RelationshipType.AssociatesMaterial,
    ifcClass: "IFCRELASSOCIATESMATERIAL",
    relName: "Material Layer Set Usage",
    targetIds,
    resource: (out) => emitLayerSetUsage(session, out, params),
  });
}

/** IFCCLASSIFICATION (einmalig je Quelle) + REFERENCE + IFCRELASSOCIATES…. */
export function cmdAssignClassification(
  session: ModelSession,
  targetIds: readonly number[],
  params: ClassificationParams,
): EditorCommand {
  return resourceAssignCommand(session, {
    label: `Klassifikation „${params.identification}" (${params.system}) → ${countText(targetIds)}`,
    relType: RelationshipType.AssociatesClassification,
    ifcClass: "IFCRELASSOCIATESCLASSIFICATION",
    relName: "Classification",
    targetIds,
    resource: (out) => emitClassificationReference(session, out, params),
  });
}

/** IFCDOCUMENTINFORMATION + IFCDOCUMENTREFERENCE + IFCRELASSOCIATESDOCUMENT. */
export function cmdAssignDocument(
  session: ModelSession,
  targetIds: readonly number[],
  params: DocumentParams,
): EditorCommand {
  return resourceAssignCommand(session, {
    label: `Dokument „${params.name || params.identification}" → ${countText(targetIds)}`,
    relType: RelationshipType.AssociatesDocument,
    ifcClass: "IFCRELASSOCIATESDOCUMENT",
    relName: "Document",
    targetIds,
    resource: (out) => emitDocumentReference(session, out, params),
  });
}

/**
 * IFCGROUP/IFCZONE/IFCSYSTEM (neu oder vorhanden) + IFCRELASSIGNSTOGROUP —
 * Achtung Argumentreihenfolge: RelatedObjects-LISTE, RelatedObjectsType,
 * RelatingGroup (behandelt `emitAssociation` klassenspezifisch).
 */
export function cmdAssignToGroup(
  session: ModelSession,
  targetIds: readonly number[],
  params: {
    groupId?: number | null;
    groupClass: GroupClass;
    name: string;
    longName?: string;
  },
): EditorCommand {
  return resourceAssignCommand(session, {
    label: `Gruppe „${params.name || `#${params.groupId}`}" ← ${countText(targetIds)}`,
    relType: RelationshipType.AssignsToGroup,
    ifcClass: "IFCRELASSIGNSTOGROUP",
    relName: params.name || "Gruppenzuordnung",
    targetIds,
    resource: (out) =>
      params.groupId ??
      emitGroup(session, out, params.groupClass, params.name, params.longName ?? ""),
  });
}

/** Typ-Objekt (z. B. IFCWALLTYPE, neu oder vorhanden) + IFCRELDEFINESBYTYPE. */
export function cmdAssignType(
  session: ModelSession,
  targetIds: readonly number[],
  params: { typeId?: number | null; typeClass: string; name: string; tag?: string },
): EditorCommand {
  const def = typeClassDef(params.typeClass);
  if (params.typeId == null && !def) {
    throw new Error(`Unbekannte Typklasse: ${params.typeClass}`);
  }
  return resourceAssignCommand(session, {
    label: `Typ „${params.name || `#${params.typeId}`}" → ${countText(targetIds)}`,
    relType: RelationshipType.DefinesByType,
    ifcClass: "IFCRELDEFINESBYTYPE",
    relName: "Type",
    targetIds,
    resource: (out) =>
      params.typeId ??
      emitTypeObject(session, out, def as NonNullable<typeof def>, params.name, params.tag ?? ""),
  });
}

/**
 * IFCSIUNIT anlegen und positional an die Units-Liste der IFCUNITASSIGNMENT
 * hängen (Muster relationMembers.ts: Overlay-Record + positionale Mutation).
 * Das Undo entfernt die Mutation wieder vollständig → Export byte-identisch.
 */
export function cmdAddSiUnit(
  session: ModelSession,
  params: { unitType: string; prefix?: string | null; name: string },
): EditorCommand {
  const assignment = unitAssignmentOf(session);
  if (!assignment) {
    throw new Error("Keine IfcUnitAssignment im Modell — Einheit nicht anlegbar.");
  }
  let created: NewEntity | null = null;
  let previous: StepValue | undefined;
  let hadMutation = false;
  let extendedList: StepValue[] = [];

  return {
    label: `SI-Einheit ${params.prefix ? `${params.prefix} ` : ""}${params.name} (${params.unitType}) ergänzt`,
    run() {
      const mutations = session.view.getPositionalMutationsForEntity(
        assignment.assignmentId,
      );
      hadMutation = mutations?.has(0) ?? false;
      previous = hadMutation ? mutations?.get(0) : undefined;
      // IfcSIUnit(Dimensions `*`, UnitType, Prefix, Name)
      const ref = session.editor().addEntity("IfcSIUnit", [
        "*",
        enumOf(params.unitType),
        params.prefix ? enumOf(params.prefix) : null,
        enumOf(params.name),
      ]);
      created = session.view.getNewEntity(ref.expressId);
      const current = unitAssignmentOf(session);
      extendedList = [...(current?.tokens ?? []), ...stepRefs([ref.expressId])];
      session.view.setPositionalAttribute(
        assignment.assignmentId,
        0,
        extendedList,
        false,
      );
    },
    undo() {
      if (created) session.editor().removeEntity(created.expressId);
      if (hadMutation && previous !== undefined) {
        session.view.setPositionalAttribute(
          assignment.assignmentId,
          0,
          previous,
          true,
        );
      } else {
        session.view.removePositionalMutation(assignment.assignmentId, 0);
      }
    },
    /** Befund 12: Redo mit skipHistory und stabiler expressId. */
    redo() {
      if (!created) {
        this.run();
        return;
      }
      session.view.restoreNewEntity(created);
      session.view.setPositionalAttribute(
        assignment.assignmentId,
        0,
        extendedList,
        true,
      );
    },
  };
}

/**
 * Räumliches Kind (Site/Building/Storey/Space) anlegen: Objekt-Record über
 * den StoreEditor plus IfcRelAggregates als Komposition mit
 * `cmdCreateRelation` — ein gemeinsamer Undo-Schritt für das Kontextmenü.
 */
export function cmdCreateSpatialChild(
  session: ModelSession,
  parentId: number,
  ifcClass: string,
  name: string,
): EditorCommand {
  const def = spatialClassDef(ifcClass);
  if (!def) throw new Error(`Keine räumliche Kindklasse: ${ifcClass}`);
  let created: NewEntity | null = null;
  let inner: EditorCommand | null = null;

  return {
    label: `${def.label} „${name.trim() || def.label}" unter ${session.labelOf(parentId)} angelegt`,
    run() {
      const out: NewEntity[] = [];
      const childId = emitSpatialElement(session, out, def, name);
      created = out[0] ?? null;
      inner = cmdCreateRelation(session, "IFCRELAGGREGATES", parentId, [childId]);
      inner.run();
    },
    undo() {
      inner?.undo();
      if (created) session.editor().removeEntity(created.expressId);
      session.invalidateSpatialTree();
    },
    redo() {
      if (!created || !inner) {
        this.run();
        return;
      }
      session.view.restoreNewEntity(created);
      if (inner.redo) inner.redo();
      else inner.run();
    },
  };
}
