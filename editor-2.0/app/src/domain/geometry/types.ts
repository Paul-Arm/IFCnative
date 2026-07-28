/**
 * Baukasten (M5): Katalog der erzeugbaren Bauteilklassen und Profile.
 *
 * Die Eingaben sind durchgängig METER und beziehen sich auf den gewählten
 * räumlichen Elternknoten (Geschoss, Raum …). Die Umrechnung in die
 * Modelleinheit passiert erst beim Emit (`store.lengthUnitScale`).
 *
 * Die vier Klassen Wand/Decke/Stütze/Träger deckt @ifc-lite/create mit
 * In-Store-Buildern ab; deren Parameterform ist je Klasse unterschiedlich
 * (Achse vs. Position), deshalb hält `hint` die Bedeutung der drei Maße je
 * Klasse in Klartext fest.
 */

export type BuilderClassId = "wall" | "slab" | "column" | "beam" | "proxy";

export interface BuilderClassDef {
  id: BuilderClassId;
  /** Deutsche Beschriftung für das Formular */
  label: string;
  /** Kanonischer EXPRESS-Name für `StoreEditor.addEntity` */
  entityName: string;
  /** STEP-Klasse in Großschreibung (Legalitätsprüfungen, Audit-Log) */
  ifcClass: string;
  /** Bedeutung von Breite/Tiefe/Höhe in dieser Klasse */
  hint: string;
  /** true = @ifc-lite/create liefert einen In-Store-Builder (nur Rechteck) */
  hasInStoreBuilder: boolean;
  /** PredefinedType-Enum für den Eigenbau-Pfad (ab IFC4) */
  predefinedType: string;
}

export const BUILDER_CLASSES: readonly BuilderClassDef[] = [
  {
    id: "wall",
    label: "Wand",
    entityName: "IfcWall",
    ifcClass: "IFCWALL",
    predefinedType: "NOTDEFINED",
    hint: "Breite = Länge entlang X, Tiefe = Wanddicke, Höhe = Wandhöhe",
    hasInStoreBuilder: true,
  },
  {
    id: "slab",
    label: "Decke / Platte",
    entityName: "IfcSlab",
    ifcClass: "IFCSLAB",
    predefinedType: "FLOOR",
    hint: "Breite × Tiefe = Grundriss, Höhe = Plattendicke",
    hasInStoreBuilder: true,
  },
  {
    id: "column",
    label: "Stütze",
    entityName: "IfcColumn",
    ifcClass: "IFCCOLUMN",
    predefinedType: "COLUMN",
    hint: "Breite × Tiefe = Querschnitt, Höhe = Stützenhöhe",
    hasInStoreBuilder: true,
  },
  {
    id: "beam",
    label: "Träger",
    entityName: "IfcBeam",
    ifcClass: "IFCBEAM",
    predefinedType: "BEAM",
    hint: "Breite × Tiefe = Querschnitt, Höhe = Trägerlänge entlang X",
    hasInStoreBuilder: true,
  },
  {
    id: "proxy",
    label: "Allgemeines Bauteil (Proxy)",
    entityName: "IfcBuildingElementProxy",
    ifcClass: "IFCBUILDINGELEMENTPROXY",
    predefinedType: "NOTDEFINED",
    hint: "Breite × Tiefe = Querschnitt, Höhe = Extrusionslänge (+Z)",
    hasInStoreBuilder: false,
  },
];

export function builderClass(id: BuilderClassId): BuilderClassDef {
  const found = BUILDER_CLASSES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unbekannte Bauteilklasse: ${id}`);
  return found;
}

export type ProfileKind = "rechteck" | "kreis";

export const PROFILE_LABELS: Readonly<Record<ProfileKind, string>> = {
  rechteck: "Rechteck (Breite × Tiefe)",
  kreis: "Kreis (Radius)",
};

/** Eingabewerte des Baukasten-Formulars — alle Längen in Metern. */
export interface CreateElementParams {
  klasse: BuilderClassId;
  profil: ProfileKind;
  /** Rechteck: Ausdehnung in Profil-X */
  breite: number;
  /** Rechteck: Ausdehnung in Profil-Y */
  tiefe: number;
  /** Kreis: Radius */
  radius: number;
  /** Extrusionslänge (Bedeutung je Klasse, siehe `hint`) */
  hoehe: number;
  /** Position relativ zum räumlichen Elternknoten */
  x: number;
  y: number;
  z: number;
  name: string;
  tag: string;
}

export const DEFAULT_CREATE_PARAMS: CreateElementParams = {
  klasse: "wall",
  profil: "rechteck",
  breite: 4,
  tiefe: 0.24,
  radius: 0.15,
  hoehe: 2.75,
  x: 0,
  y: 0,
  z: 0,
  name: "",
  tag: "",
};

/** Eingabewerte für eine Öffnung — alle Längen in Metern. */
export interface CreateOpeningParams {
  breite: number;
  hoehe: number;
  /** Durchdringungstiefe quer zum Bauteil */
  tiefe: number;
  /** Position entlang der lokalen X-Achse des Bauteils */
  abstand: number;
  /** Brüstungshöhe über dem Bauteilfuß (lokales Z) */
  bruestung: number;
  name: string;
}

export const DEFAULT_OPENING_PARAMS: CreateOpeningParams = {
  breite: 1,
  hoehe: 2.1,
  tiefe: 1,
  abstand: 1,
  bruestung: 0,
  name: "Öffnung",
};

/** Maßänderungen an einer bestehenden Extrusion — Meter, `null` = unverändert. */
export interface DimensionChange {
  xDim?: number;
  yDim?: number;
  radius?: number;
  depth?: number;
}
