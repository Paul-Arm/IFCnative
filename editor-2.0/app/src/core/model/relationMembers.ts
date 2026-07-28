/**
 * Mitglieder-Listen von Multi-Target-Beziehungen (Review-Befund 1).
 *
 * Eine IfcRelContainedInSpatialStructure bündelt ALLE Bauteile eines
 * Geschosses in EINER Related-Liste. Wird ein einzelnes Bauteil gelöscht,
 * darf der Record deshalb nicht als Ganzes tombstoned werden — sonst
 * verlieren die übrigen Mitglieder ihre räumliche Zuordnung im Export.
 * Dieses Modul liest die positionale Related-Liste eines IfcRel*-Records und
 * schreibt eine verkürzte Fassung zurück.
 *
 * Gelesen wird in drei Stufen (erste Quelle gewinnt):
 *   1. Overlay-Entity (`view.getNewEntity`) — selbst angelegte Beziehungen,
 *   2. bereits vorhandene positionale Mutation (frühere Kürzung),
 *   3. Quellzeile über `store.entityIndex.byId` + `EntityExtractor`.
 */
import { EntityExtractor, type IfcDataStore } from "@ifc-lite/parser";
import type { IfcAttributeValue, MutablePropertyView } from "@ifc-lite/mutations";

/**
 * Nullbasierter Index der „Related"-Liste je IfcRel*-Klasse. Die ersten vier
 * Argumente sind bei allen IfcRelationship-Subtypen gleich (GlobalId,
 * OwnerHistory, Name, Description); IfcRelAggregates/IfcRelNests führen danach
 * zuerst die Relating-Seite, alle übrigen zuerst die Related-Liste.
 */
const RELATED_LIST_INDEX: Readonly<Record<string, number>> = {
  IFCRELAGGREGATES: 5,
  IFCRELNESTS: 5,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 4,
  IFCRELREFERENCEDINSPATIALSTRUCTURE: 4,
  IFCRELDEFINESBYTYPE: 4,
  IFCRELDEFINESBYPROPERTIES: 4,
  IFCRELASSOCIATESMATERIAL: 4,
  IFCRELASSOCIATESCLASSIFICATION: 4,
  IFCRELASSOCIATESDOCUMENT: 4,
  IFCRELASSOCIATESLIBRARY: 4,
  IFCRELASSOCIATESAPPROVAL: 4,
  IFCRELASSIGNSTOGROUP: 4,
  IFCRELASSIGNSTOGROUPBYFACTOR: 4,
  IFCRELASSIGNSTOPRODUCT: 4,
  IFCRELASSIGNSTOPROCESS: 4,
  IFCRELASSIGNSTOACTOR: 4,
  IFCRELASSIGNSTOCONTROL: 4,
  IFCRELASSIGNSTORESOURCE: 4,
};

/** Momentaufnahme der Related-Liste eines Beziehungs-Records. */
export interface RelationMembers {
  /** STEP-Klasse in Großschreibung */
  ifcClass: string;
  /** Positionaler Index der Liste im Record */
  index: number;
  /** Aktuelle Mitglieder als expressIds */
  members: number[];
  /** true = Record liegt als Overlay-Entity vor (kein Quellzeilen-Record) */
  overlay: boolean;
}

/** `#42` oder 42 → 42; alles andere → null. */
function toExpressId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^#\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim().slice(1), 10);
  }
  return null;
}

function asIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  for (const item of value) {
    const id = toExpressId(item);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

/** STEP-Klasse eines Records (Overlay zuerst, sonst Quellindex). */
function classOf(
  store: IfcDataStore,
  view: MutablePropertyView,
  relId: number,
): string | null {
  const overlay = view.getNewEntity(relId);
  if (overlay) return overlay.type.toUpperCase();
  const ref = store.entityIndex.byId.get(relId);
  return ref ? ref.type.toUpperCase() : null;
}

/**
 * Related-Liste eines Beziehungs-Records lesen. `null`, wenn die Klasse keine
 * Multi-Target-Liste führt oder der Record nicht auflösbar ist — Aufrufer
 * fallen dann auf das vollständige Löschen zurück.
 */
export function readRelationMembers(
  store: IfcDataStore,
  view: MutablePropertyView,
  relId: number,
): RelationMembers | null {
  const ifcClass = classOf(store, view, relId);
  if (!ifcClass) return null;
  const index = RELATED_LIST_INDEX[ifcClass];
  if (index === undefined) return null;

  const overlayEntity = view.getNewEntity(relId);
  if (overlayEntity) {
    const members = asIdList(overlayEntity.attributes[index]);
    return members ? { ifcClass, index, members, overlay: true } : null;
  }

  const patched = view.getPositionalMutationsForEntity(relId)?.get(index);
  if (patched !== undefined) {
    const members = asIdList(patched);
    return members ? { ifcClass, index, members, overlay: false } : null;
  }

  const ref = store.entityIndex.byId.get(relId);
  if (!ref) return null;
  const entity = new EntityExtractor(store.source).extractEntity(ref);
  if (!entity) return null;
  const members = asIdList(entity.attributes[index]);
  return members ? { ifcClass, index, members, overlay: false } : null;
}

/** Mitglieder-Ids in die STEP-Referenzform bringen (`42` → `"#42"`). */
export function toStepRefs(ids: readonly number[]): IfcAttributeValue[] {
  return ids.map((id) => `#${id}`);
}

/**
 * Verkürzte Related-Liste in den Record schreiben. Overlay-Records werden
 * direkt bearbeitet (der Exporter serialisiert `NewEntity.attributes` und
 * kennt keine positionalen Overrides für Overlay-Entities), Quellzeilen-
 * Records über eine positionale Mutation.
 */
export function writeRelationMembers(
  view: MutablePropertyView,
  relId: number,
  slot: RelationMembers,
  members: readonly number[],
  skipHistory = false,
): void {
  const value = toStepRefs(members);
  if (slot.overlay) {
    const entity = view.getNewEntity(relId);
    if (entity) entity.attributes[slot.index] = value;
    return;
  }
  view.setPositionalAttribute(relId, slot.index, value, skipHistory);
}

/**
 * Related-Liste auf den Stand vor einer Kürzung zurücksetzen. `previous`
 * ist der Wert, den `getPositionalMutationsForEntity` vorher lieferte —
 * `undefined` bedeutet „es gab keine Mutation", die Kürzung wird also
 * vollständig entfernt.
 */
export function restoreRelationMembers(
  view: MutablePropertyView,
  relId: number,
  slot: RelationMembers,
  previous: IfcAttributeValue | undefined,
  overlayPrevious: IfcAttributeValue | undefined,
): void {
  if (slot.overlay) {
    const entity = view.getNewEntity(relId);
    if (entity && overlayPrevious !== undefined) {
      entity.attributes[slot.index] = overlayPrevious;
    }
    return;
  }
  if (previous === undefined) {
    view.removePositionalMutation(relId, slot.index);
  } else {
    view.setPositionalAttribute(relId, slot.index, previous, true);
  }
}
