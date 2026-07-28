/**
 * Ressourcen-Emitter, Teil 2 (M9): Gruppen/Zonen/Systeme, Typ-Objekte,
 * räumliche Elemente und die IfcRel*-Zuordnungs-Records.
 * Sammel- und Undo-/Redo-Konventionen wie in `emit.ts`.
 */
import { generateIfcGuid } from "@ifc-lite/encoding";
import type { NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../../core/session";
import { addRecord, enumOf, stepRefs, type StepValue } from "./emit";

// — Gruppe / Zone / System ————————————————————————————————————————————————

export type GroupClass = "IFCGROUP" | "IFCZONE" | "IFCSYSTEM";

export const GROUP_CLASSES: ReadonlyArray<{ value: GroupClass; label: string }> = [
  { value: "IFCGROUP", label: "Gruppe" },
  { value: "IFCZONE", label: "Zone" },
  { value: "IFCSYSTEM", label: "System" },
];

const GROUP_ENTITY: Record<GroupClass, string> = {
  IFCGROUP: "IfcGroup",
  IFCZONE: "IfcZone",
  IFCSYSTEM: "IfcSystem",
};

/** IfcGroup/IfcSystem (5 Attribute) bzw. IfcZone (+LongName, IFC4). */
export function emitGroup(
  session: ModelSession,
  out: NewEntity[],
  groupClass: GroupClass,
  name: string,
  longName = "",
): number {
  const cleanName = name.trim() || "Gruppe";
  const attributes: StepValue[] = [
    generateIfcGuid(),
    null,
    cleanName,
    null,
    null,
  ];
  if (groupClass === "IFCZONE") attributes.push(longName.trim() || cleanName);
  return addRecord(session, out, GROUP_ENTITY[groupClass], attributes);
}

// — Typ-Objekt ————————————————————————————————————————————————————————————

export interface TypeClassDef {
  ifcClass: string;
  entityName: string;
  label: string;
  /** Attribute nach Tag (ElementType, PredefinedType, …) */
  tail: readonly StepValue[];
}

const ELEMENT_TAIL: readonly StepValue[] = [null, enumOf("NOTDEFINED")];

/** Angebotene Typklassen (Referenz: 1.x TYPE_CLASSES in constants.ts). */
export const TYPE_CLASSES: readonly TypeClassDef[] = [
  { ifcClass: "IFCTYPEOBJECT", entityName: "IfcTypeObject", label: "Allgemeiner Typ", tail: [] },
  { ifcClass: "IFCWALLTYPE", entityName: "IfcWallType", label: "Wandtyp", tail: ELEMENT_TAIL },
  { ifcClass: "IFCSLABTYPE", entityName: "IfcSlabType", label: "Deckentyp", tail: ELEMENT_TAIL },
  { ifcClass: "IFCBEAMTYPE", entityName: "IfcBeamType", label: "Trägertyp", tail: ELEMENT_TAIL },
  { ifcClass: "IFCCOLUMNTYPE", entityName: "IfcColumnType", label: "Stützentyp", tail: ELEMENT_TAIL },
  {
    ifcClass: "IFCBUILDINGELEMENTPROXYTYPE",
    entityName: "IfcBuildingElementProxyType",
    label: "Proxy-Typ",
    tail: ELEMENT_TAIL,
  },
];

export function typeClassDef(ifcClass: string): TypeClassDef | null {
  const key = ifcClass.toUpperCase();
  return TYPE_CLASSES.find((def) => def.ifcClass === key) ?? null;
}

/** IfcTypeObject-Subtyp: GlobalId..Tag + klassenspezifischer Schwanz. */
export function emitTypeObject(
  session: ModelSession,
  out: NewEntity[],
  def: TypeClassDef,
  name: string,
  tag = "",
): number {
  const cleanName = name.trim() || def.label;
  return addRecord(session, out, def.entityName, [
    generateIfcGuid(),
    null,
    cleanName,
    null,
    null,
    null,
    null,
    tag.trim() || cleanName,
    ...def.tail,
  ]);
}

// — Beziehungs-Records ————————————————————————————————————————————————————

const ASSOCIATION_ENTITY: Record<string, string> = {
  IFCRELASSOCIATESMATERIAL: "IfcRelAssociatesMaterial",
  IFCRELASSOCIATESCLASSIFICATION: "IfcRelAssociatesClassification",
  IFCRELASSOCIATESDOCUMENT: "IfcRelAssociatesDocument",
  IFCRELASSIGNSTOGROUP: "IfcRelAssignsToGroup",
  IFCRELDEFINESBYTYPE: "IfcRelDefinesByType",
};

/**
 * IfcRel*-Record der Zuordnung. Alle Klassen führen die RelatedObjects-LISTE
 * vor der Relating-Seite; IfcRelAssignsToGroup hat dazwischen zusätzlich
 * RelatedObjectsType (Achtung Argumentreihenfolge — wie relationCommands.ts).
 */
export function emitAssociation(
  session: ModelSession,
  out: NewEntity[],
  relClass: string,
  relName: string,
  targetIds: readonly number[],
  resourceId: number,
): number {
  const key = relClass.toUpperCase();
  const entityName = ASSOCIATION_ENTITY[key];
  if (!entityName) throw new Error(`Unbekannte Zuordnungsklasse: ${relClass}`);
  const head: StepValue[] = [generateIfcGuid(), null, relName || null, null];
  const targets = stepRefs(targetIds);
  const attributes =
    key === "IFCRELASSIGNSTOGROUP"
      ? [...head, targets, null, `#${resourceId}`]
      : [...head, targets, `#${resourceId}`];
  return addRecord(session, out, entityName, attributes);
}

// — Räumliche Kinder (Baum-Kontextmenü) ————————————————————————————————————

export interface SpatialClassDef {
  ifcClass: string;
  entityName: string;
  label: string;
  /** Attribute nach CompositionType (IFC4-Arity) */
  tail: readonly StepValue[];
}

/** IFC4-Layouts: GlobalId..Representation, LongName, CompositionType, Rest. */
export const SPATIAL_CLASSES: readonly SpatialClassDef[] = [
  { ifcClass: "IFCSITE", entityName: "IfcSite", label: "Gelände (Site)", tail: [null, null, null, null, null] },
  { ifcClass: "IFCBUILDING", entityName: "IfcBuilding", label: "Gebäude (Building)", tail: [null, null, null] },
  { ifcClass: "IFCBUILDINGSTOREY", entityName: "IfcBuildingStorey", label: "Geschoss (Storey)", tail: [null] },
  { ifcClass: "IFCSPACE", entityName: "IfcSpace", label: "Raum (Space)", tail: [enumOf("NOTDEFINED"), null] },
];

export function spatialClassDef(ifcClass: string): SpatialClassDef | null {
  const key = ifcClass.toUpperCase();
  return SPATIAL_CLASSES.find((def) => def.ifcClass === key) ?? null;
}

/** Räumliches Element ohne Placement/Repräsentation (nur Semantik). */
export function emitSpatialElement(
  session: ModelSession,
  out: NewEntity[],
  def: SpatialClassDef,
  name: string,
): number {
  return addRecord(session, out, def.entityName, [
    generateIfcGuid(),
    null,
    name.trim() || def.label,
    null,
    null,
    null,
    null,
    null,
    enumOf("ELEMENT"),
    ...def.tail,
  ]);
}
