/**
 * Endpunkt-Legalität für Beziehungen (M2).
 *
 * Tabelle je IfcRel*-Klasse: welche IFC-Basistypen dürfen auf der
 * „Relating"-Seite (Quelle) und der „Related"-Seite (Ziel) stehen. Die
 * Richtung entspricht exakt der Kantenrichtung des Parsers
 * (`relatingObject → relatedObject`), damit Overlay- und geparste Kanten im
 * Graphen gleich orientiert sind.
 *
 * Typprüfung über die Vererbungskette aus @ifc-lite/parser
 * (`isKnownEntity` / `getInheritanceChainForEntity`); für dem Schema
 * unbekannte Klassen greift eine pragmatische Namensheuristik.
 */
import { RelationshipType } from "@ifc-lite/data";
import { getInheritanceChainForEntity, isKnownEntity } from "@ifc-lite/parser";

export interface RelationClassRule {
  /** STEP-Klasse in Großschreibung, z. B. „IFCRELAGGREGATES" */
  ifcClass: string;
  /** Kanonischer EXPRESS-Name für `StoreEditor.addEntity` */
  entityName: string;
  relType: RelationshipType;
  /** Deutsche Beschriftung für Menüs und Audit-Log */
  label: string;
  /** Kurzerklärung der Richtung */
  hint: string;
  /** Erlaubte Basistypen der Quelle */
  source: readonly string[];
  /** Ausschlüsse auf der Quellseite (gewinnen gegen `source`) */
  sourceNot?: readonly string[];
  /** Erlaubte Basistypen des Ziels */
  target: readonly string[];
  targetNot?: readonly string[];
  /** true = eine Beziehung darf mehrere Ziele bündeln */
  multiTarget: boolean;
}

export const RELATION_RULES: readonly RelationClassRule[] = [
  {
    ifcClass: "IFCRELAGGREGATES",
    entityName: "IfcRelAggregates",
    relType: RelationshipType.Aggregates,
    label: "Aggregiert",
    hint: "Quelle ist das Ganze, Ziel der Teil",
    source: ["IfcProject", "IfcSpatialElement", "IfcProduct"],
    target: ["IfcProject", "IfcSpatialElement", "IfcProduct"],
    multiTarget: true,
  },
  {
    ifcClass: "IFCRELCONTAINEDINSPATIALSTRUCTURE",
    entityName: "IfcRelContainedInSpatialStructure",
    relType: RelationshipType.ContainsElements,
    label: "Enthält räumlich",
    hint: "Quelle ist die Raumstruktur, Ziel das Bauteil",
    source: ["IfcSpatialElement", "IfcSpatialStructureElement"],
    target: ["IfcElement"],
    multiTarget: true,
  },
  {
    ifcClass: "IFCRELDEFINESBYTYPE",
    entityName: "IfcRelDefinesByType",
    relType: RelationshipType.DefinesByType,
    label: "Typzuweisung",
    hint: "Quelle ist der Typ, Ziel das Objekt",
    source: ["IfcTypeObject"],
    target: ["IfcObject"],
    multiTarget: true,
  },
  {
    ifcClass: "IFCRELASSOCIATESMATERIAL",
    entityName: "IfcRelAssociatesMaterial",
    relType: RelationshipType.AssociatesMaterial,
    label: "Material",
    hint: "Quelle ist das Material, Ziel das Objekt",
    source: [
      "IfcMaterialDefinition",
      "IfcMaterial",
      "IfcMaterialList",
      "IfcMaterialUsageDefinition",
    ],
    target: ["IfcObjectDefinition"],
    multiTarget: true,
  },
  {
    ifcClass: "IFCRELCONNECTSELEMENTS",
    entityName: "IfcRelConnectsElements",
    relType: RelationshipType.ConnectsElements,
    label: "Verbindet",
    hint: "Bauteil an Bauteil",
    source: ["IfcElement"],
    target: ["IfcElement"],
    multiTarget: false,
  },
  {
    ifcClass: "IFCRELVOIDSELEMENT",
    entityName: "IfcRelVoidsElement",
    relType: RelationshipType.VoidsElement,
    label: "Öffnung",
    hint: "Quelle ist das Bauteil, Ziel die Öffnung",
    source: ["IfcElement"],
    sourceNot: ["IfcFeatureElement"],
    target: ["IfcOpeningElement", "IfcFeatureElementSubtraction"],
    multiTarget: false,
  },
  {
    ifcClass: "IFCRELFILLSELEMENT",
    entityName: "IfcRelFillsElement",
    relType: RelationshipType.FillsElement,
    label: "Füllt Öffnung",
    hint: "Quelle ist die Öffnung, Ziel das füllende Bauteil",
    source: ["IfcOpeningElement", "IfcFeatureElementSubtraction"],
    target: ["IfcElement"],
    targetNot: ["IfcFeatureElement"],
    multiTarget: false,
  },
  {
    ifcClass: "IFCRELASSIGNSTOGROUP",
    entityName: "IfcRelAssignsToGroup",
    relType: RelationshipType.AssignsToGroup,
    label: "Gruppe/System",
    hint: "Quelle ist die Gruppe, Ziel das zugeordnete Objekt",
    source: ["IfcGroup"],
    target: ["IfcObjectDefinition"],
    multiTarget: true,
  },
];

export function ruleForClass(ifcClass: string): RelationClassRule | null {
  const key = ifcClass.toUpperCase();
  return RELATION_RULES.find((rule) => rule.ifcClass === key) ?? null;
}

/**
 * Namensheuristik für Klassen, die das mitgelieferte Schema nicht kennt
 * (Vendor-Erweiterungen, ältere Schemata). Bewusst grob — sie soll den
 * Dialog nicht leer laufen lassen, nicht das Schema ersetzen.
 */
function heuristicChain(typeName: string): string[] {
  const upper = typeName.toUpperCase();
  const root = ["IfcRoot", "IfcObjectDefinition"];
  if (upper.endsWith("TYPE")) return [...root, "IfcTypeObject", "IfcTypeProduct"];
  if (upper.includes("MATERIAL")) return ["IfcMaterialDefinition"];
  if (upper.includes("OPENING") || upper.includes("VOID")) {
    return [
      ...root,
      "IfcObject",
      "IfcProduct",
      "IfcElement",
      "IfcFeatureElement",
      "IfcFeatureElementSubtraction",
      "IfcOpeningElement",
    ];
  }
  if (upper.includes("GROUP") || upper.includes("SYSTEM") || upper.includes("ZONE")) {
    return [...root, "IfcObject", "IfcGroup"];
  }
  if (upper === "IFCPROJECT") return [...root, "IfcContext", "IfcProject"];
  if (
    upper === "IFCSITE" ||
    upper === "IFCBUILDING" ||
    upper === "IFCBUILDINGSTOREY" ||
    upper === "IFCSPACE" ||
    upper.includes("SPATIAL")
  ) {
    return [
      ...root,
      "IfcObject",
      "IfcProduct",
      "IfcSpatialElement",
      "IfcSpatialStructureElement",
    ];
  }
  return [...root, "IfcObject", "IfcProduct", "IfcElement"];
}

/** Vererbungskette (Wurzel zuerst, inkl. eigener Klasse). */
export function baseTypesOf(typeName: string): readonly string[] {
  if (!typeName) return [];
  if (isKnownEntity(typeName)) {
    const chain = getInheritanceChainForEntity(typeName);
    if (chain.length > 0) return chain;
  }
  return heuristicChain(typeName);
}

function matches(
  chain: readonly string[],
  allowed: readonly string[],
  denied?: readonly string[],
): boolean {
  const set = new Set(chain.map((name) => name.toLowerCase()));
  if (denied?.some((name) => set.has(name.toLowerCase()))) return false;
  return allowed.some((name) => set.has(name.toLowerCase()));
}

/** Prüft ein konkretes Endpunktpaar gegen eine Regel. */
export function isLegalEndpointPair(
  rule: RelationClassRule,
  sourceType: string,
  targetType: string,
): boolean {
  const sourceChain = baseTypesOf(sourceType);
  const targetChain = baseTypesOf(targetType);
  return (
    matches(sourceChain, rule.source, rule.sourceNot) &&
    matches(targetChain, rule.target, rule.targetNot)
  );
}

/**
 * Alle Beziehungsklassen, die zwischen zwei IFC-Klassen zulässig sind —
 * Grundlage der Auswahl beim Verbinden zweier Knoten im Graphen.
 */
export function allowedRelationClasses(
  sourceType: string,
  targetType: string,
): RelationClassRule[] {
  const sourceChain = baseTypesOf(sourceType);
  const targetChain = baseTypesOf(targetType);
  return RELATION_RULES.filter(
    (rule) =>
      matches(sourceChain, rule.source, rule.sourceNot) &&
      matches(targetChain, rule.target, rule.targetNot),
  );
}
