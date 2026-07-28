/**
 * IFC-legale Kindklassen je Parent-Typ für das Baum-Kontextmenü (M9).
 *
 * Referenz: 1.x `structureChildGroupsForParent` in
 * src/components/ifc-workspace/constants.ts — Project→Site/Building,
 * Site→Building/Storey, Building→Storey, Storey→Space, dazu Bauteile für
 * Site/Building/Storey/Space. Räumliche Kinder laufen als Objekt +
 * IfcRelAggregates (`cmdCreateSpatialChild`), Bauteil-Kinder über
 * `cmdCreateElement` aus dem Baukasten (Default-Maße, inkl. Containment).
 */
import type { BuilderClassId } from "../../domain/geometry";

export interface ChildOption {
  label: string;
  /** räumlich: STEP-Klasse; Element: Baukasten-Klasse */
  kind: "spatial" | "element";
  ifcClass: string;
  builderId?: BuilderClassId;
}

export interface ChildGroup {
  label: string;
  options: ChildOption[];
}

const spatial = (label: string, ifcClass: string): ChildOption => ({
  label,
  kind: "spatial",
  ifcClass,
});

const SITE = spatial("Gelände (Site)", "IFCSITE");
const BUILDING = spatial("Gebäude (Building)", "IFCBUILDING");
const STOREY = spatial("Geschoss (Storey)", "IFCBUILDINGSTOREY");
const SPACE = spatial("Raum (Space)", "IFCSPACE");

/** Bauteil-Kinder = die Klassen, die der Baukasten (M5) emittieren kann. */
const ELEMENT_OPTIONS: ChildOption[] = [
  { label: "Wand", kind: "element", ifcClass: "IFCWALL", builderId: "wall" },
  { label: "Decke / Platte", kind: "element", ifcClass: "IFCSLAB", builderId: "slab" },
  { label: "Stütze", kind: "element", ifcClass: "IFCCOLUMN", builderId: "column" },
  { label: "Träger", kind: "element", ifcClass: "IFCBEAM", builderId: "beam" },
  { label: "Platte (Plate)", kind: "element", ifcClass: "IFCPLATE", builderId: "plate" },
  { label: "Stab (Member)", kind: "element", ifcClass: "IFCMEMBER", builderId: "member" },
  { label: "Fundament", kind: "element", ifcClass: "IFCFOOTING", builderId: "footing" },
  { label: "Geländer", kind: "element", ifcClass: "IFCRAILING", builderId: "railing" },
  { label: "Bekleidung (Covering)", kind: "element", ifcClass: "IFCCOVERING", builderId: "covering" },
  {
    label: "Element-Proxy",
    kind: "element",
    ifcClass: "IFCBUILDINGELEMENTPROXY",
    builderId: "proxy",
  },
];

const ELEMENT_GROUP: ChildGroup = { label: "Bauteile", options: ELEMENT_OPTIONS };

/** Kindklassen-Gruppen je Parent-Typ; leer für Bauteil-Zeilen. */
export function childGroupsForParent(parentType: string): ChildGroup[] {
  switch (parentType.trim().toUpperCase()) {
    case "IFCPROJECT":
      return [{ label: "Räumliche Struktur", options: [SITE, BUILDING] }];
    case "IFCSITE":
      return [
        { label: "Räumliche Struktur", options: [BUILDING, STOREY] },
        ELEMENT_GROUP,
      ];
    case "IFCBUILDING":
      return [
        { label: "Räumliche Struktur", options: [STOREY] },
        ELEMENT_GROUP,
      ];
    case "IFCBUILDINGSTOREY":
      return [
        { label: "Räumliche Struktur", options: [SPACE] },
        ELEMENT_GROUP,
      ];
    case "IFCSPACE":
      return [ELEMENT_GROUP];
    default:
      return [];
  }
}

/** IfcProject ist löschgeschützt (wie in 1.x planNativeEntityRemoval). */
export function isDeleteProtected(type: string): boolean {
  return type.trim().toUpperCase() === "IFCPROJECT";
}
