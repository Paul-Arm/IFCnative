import type { MosaicNode } from "react-mosaic-component";

import type { NativeGraphPreset } from "@/ifc/nativeGraph";

import type { MosaicViewId } from "./types";

export const MOSAIC_VIEW_IDS: MosaicViewId[] = [
  "structure",
  "viewer",
  "inspector",
  "builder",
  "catalog",
  "catalog-review",
  "attribution",
  "pset-batch",
  "resource-references",
  "resource-controls",
  "check",
  "diagnostics",
  "recent",
  "notes",
  "portal",
  "vcs",
];

// Der Diagnostik-Assistent und der Körper-Builder sind bewusst NICHT im
// Standard-Layout — die häufigen Builder-Aktionen (Körper anlegen,
// Duplizieren, Zerteilen, Kombinieren, Löschen) laufen über das Rotary-Menü
// im Viewer; beide Panels bleiben über das "Fenster"-Menü und die
// Build-/Review-Workspaces erreichbar.
export const DEFAULT_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: "structure",
  second: {
    direction: "row",
    first: "viewer",
    second: "inspector",
    splitPercentage: 66,
  },
  splitPercentage: 24,
};

export const REVIEW_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: {
    direction: "column",
    first: "viewer",
    second: {
      direction: "row",
      first: "check",
      second: "diagnostics",
      splitPercentage: 52,
    },
    splitPercentage: 70,
  },
  second: {
    direction: "column",
    first: "inspector",
    second: "notes",
    splitPercentage: 58,
  },
  splitPercentage: 68,
};

export const INSPECTION_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: {
    direction: "column",
    first: "viewer",
    second: {
      direction: "row",
      first: "structure",
      second: "check",
      splitPercentage: 45,
    },
    splitPercentage: 66,
  },
  second: {
    direction: "column",
    first: "inspector",
    second: {
      direction: "row",
      first: "resource-references",
      second: "resource-controls",
      splitPercentage: 50,
    },
    splitPercentage: 42,
  },
  splitPercentage: 54,
};

export const BUILD_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: {
    direction: "column",
    first: "structure",
    second: "recent",
    splitPercentage: 68,
  },
  second: {
    direction: "row",
    first: "builder",
    second: {
      direction: "column",
      first: "inspector",
      second: "notes",
      splitPercentage: 64,
    },
    splitPercentage: 47,
  },
  splitPercentage: 28,
};

export const COORDINATION_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: "viewer",
  second: {
    direction: "column",
    first: "structure",
    second: {
      direction: "row",
      first: "recent",
      second: "notes",
      splitPercentage: 50,
    },
    splitPercentage: 58,
  },
  splitPercentage: 64,
};

export interface WorkspaceDefinition {
  builtIn?: boolean;
  description: string;
  id: string;
  layout: MosaicNode<MosaicViewId> | null;
  name: string;
  updatedAt?: string;
}

export const DEFAULT_WORKSPACE_ID = "builtin:editor";

export const BUILT_IN_WORKSPACES: WorkspaceDefinition[] = [
  {
    builtIn: true,
    description:
      "Viewer, Struktur und Inspector — Bauen per Rechtsklick im Viewer.",
    id: DEFAULT_WORKSPACE_ID,
    layout: DEFAULT_MOSAIC_LAYOUT,
    name: "Editor",
  },
  {
    builtIn: true,
    description: "Großes Modellfenster mit Prüfung und Notizen.",
    id: "builtin:review",
    layout: REVIEW_MOSAIC_LAYOUT,
    name: "Review",
  },
  {
    builtIn: true,
    description: "Prüfung mit IDS, Inspector, Ressourcen und Freigaben.",
    id: "builtin:inspection",
    layout: INSPECTION_MOSAIC_LAYOUT,
    name: "Prüfung",
  },
  {
    builtIn: true,
    description: "Bauen, Strukturieren und zuletzt genutzte IFCs.",
    id: "builtin:build",
    layout: BUILD_MOSAIC_LAYOUT,
    name: "Build",
  },
  {
    builtIn: true,
    description: "Koordination mit Viewer, Baum und Ablage.",
    id: "builtin:coordination",
    layout: COORDINATION_MOSAIC_LAYOUT,
    name: "Koordination",
  },
];

export const MOSAIC_TITLES: Record<MosaicViewId, string> = {
  builder: "Baukasten",
  catalog: "Objektkatalog",
  "catalog-review": "Objektkatalog: Prüfung",
  attribution: "IFC-Attribuierung",
  check: "Prüfen",
  diagnostics: "Diagnostik",
  inspector: "Inspector",
  notes: "Notizen",
  portal: "MKP Portal",
  "pset-batch": "Pset Batch",
  recent: "Kürzlich verwendet",
  "resource-references": "Klassifikation & Dokumente",
  "resource-controls": "Freigaben & Constraints",
  structure: "Struktur",
  vcs: "IFC Hub",
  viewer: "3D-Viewer",
};

export const ENTITY_TYPES = [
  "IFCBUILDINGELEMENTPROXY",
  "IFCBUILTELEMENT",
  "IFCWALL",
  "IFCSLAB",
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCDOOR",
  "IFCWINDOW",
  "IFCSPACE",
  "IFCSENSOR",
  "IFCACTUATOR",
  "IFCTASK",
  "IFCEVENT",
  "IFCPROCEDURE",
  "IFCGROUP",
  "IFCSYSTEM",
  "IFCZONE",
  "IFCASSET",
  "IFCBUILDINGSTOREY",
  "IFCBUILDING",
  "IFCSITE",
];

export interface StructureChildOption {
  label: string;
  value: string;
}

export interface StructureChildGroup {
  label: string;
  options: StructureChildOption[];
}

const STRUCTURE_SPATIAL_OPTIONS: Record<string, StructureChildOption[]> = {
  IFCBUILDING: [{ label: "Geschoss (Storey)", value: "IFCBUILDINGSTOREY" }],
  IFCBUILDINGSTOREY: [{ label: "Raum (Space)", value: "IFCSPACE" }],
  IFCPROJECT: [
    { label: "Gelände (Site)", value: "IFCSITE" },
    { label: "Gebäude (Building)", value: "IFCBUILDING" },
  ],
  IFCSITE: [
    { label: "Gebäude (Building)", value: "IFCBUILDING" },
    { label: "Teilgelände (Site)", value: "IFCSITE" },
  ],
};

const STRUCTURE_BUILDING_ELEMENT_OPTIONS: StructureChildOption[] = [
  { label: "Wand", value: "IFCWALL" },
  { label: "Decke / Platte", value: "IFCSLAB" },
  { label: "Träger", value: "IFCBEAM" },
  { label: "Stütze", value: "IFCCOLUMN" },
  { label: "Tür", value: "IFCDOOR" },
  { label: "Fenster", value: "IFCWINDOW" },
  { label: "Bauelement (generisch)", value: "IFCBUILTELEMENT" },
  { label: "Element-Proxy", value: "IFCBUILDINGELEMENTPROXY" },
];

const STRUCTURE_TECHNICAL_OPTIONS: StructureChildOption[] = [
  { label: "Sensor", value: "IFCSENSOR" },
  { label: "Aktor", value: "IFCACTUATOR" },
];

const STRUCTURE_ELEMENT_PART_OPTIONS: StructureChildOption[] = [
  { label: "Teil-Element (generisch)", value: "IFCBUILTELEMENT" },
  { label: "Element-Proxy", value: "IFCBUILDINGELEMENTPROXY" },
  { label: "Träger", value: "IFCBEAM" },
  { label: "Stütze", value: "IFCCOLUMN" },
];

const STRUCTURE_ELEMENT_PARENT_TYPES = new Set([
  "IFCBEAM",
  "IFCBUILDINGELEMENTPROXY",
  "IFCBUILTELEMENT",
  "IFCCOLUMN",
  "IFCDOOR",
  "IFCSLAB",
  "IFCWALL",
  "IFCWINDOW",
]);

/**
 * Valid child element types that can be created under a tree node,
 * grouped for the structure tree context menu. Follows the IFC spatial
 * decomposition rules (Project -> Site -> Building -> Storey -> Space,
 * elements contained in spatial structures, parts aggregated in elements).
 */
/**
 * Objekt-Typen für "Neues freies Objekt" im virtuellen Ordner "Freie
 * Objekte" des Strukturbaums: Objekte ohne räumliche Zuordnung sind nach
 * IFC-Schema zulässig und entstehen hier bewusst ohne Parent-Beziehung.
 */
export function structureFreeObjectGroups(): StructureChildGroup[] {
  return [
    { label: "Bauteile", options: STRUCTURE_BUILDING_ELEMENT_OPTIONS },
    { label: "Technik", options: STRUCTURE_TECHNICAL_OPTIONS },
  ];
}

export function structureChildGroupsForParent(
  parentType: string,
): StructureChildGroup[] {
  const type = parentType.trim().toUpperCase();
  if (type === "IFCPROJECT") {
    return [
      {
        label: "Räumliche Struktur",
        options: STRUCTURE_SPATIAL_OPTIONS.IFCPROJECT,
      },
    ];
  }
  if (type === "IFCSITE" || type === "IFCBUILDING") {
    return [
      { label: "Räumliche Struktur", options: STRUCTURE_SPATIAL_OPTIONS[type] },
      { label: "Bauteile", options: STRUCTURE_BUILDING_ELEMENT_OPTIONS },
    ];
  }
  if (type === "IFCBUILDINGSTOREY") {
    return [
      { label: "Räumliche Struktur", options: STRUCTURE_SPATIAL_OPTIONS[type] },
      { label: "Bauteile", options: STRUCTURE_BUILDING_ELEMENT_OPTIONS },
      { label: "Technik", options: STRUCTURE_TECHNICAL_OPTIONS },
    ];
  }
  if (type === "IFCSPACE") {
    return [
      { label: "Bauteile", options: STRUCTURE_BUILDING_ELEMENT_OPTIONS },
      { label: "Technik", options: STRUCTURE_TECHNICAL_OPTIONS },
    ];
  }
  if (STRUCTURE_ELEMENT_PARENT_TYPES.has(type)) {
    return [
      {
        label: "Teil-Elemente (Aggregation)",
        options: STRUCTURE_ELEMENT_PART_OPTIONS,
      },
    ];
  }
  return [];
}

export const RELATION_TYPES = [
  "IFCRELAGGREGATES",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  "IFCRELDEFINESBYPROPERTIES",
  "IFCRELDEFINESBYTYPE",
  "IFCRELREFERENCEDINSPATIALSTRUCTURE",
  "IFCRELASSOCIATESMATERIAL",
  "IFCRELASSOCIATESCLASSIFICATION",
  "IFCRELASSOCIATESDOCUMENT",
  "IFCRELASSOCIATESLIBRARY",
  "IFCRELASSOCIATESCONSTRAINT",
  "IFCRELASSOCIATESAPPROVAL",
  "IFCRELASSIGNSTOGROUP",
  "IFCRELASSIGNSTOPROCESS",
  "IFCRELASSIGNSTOCONTROL",
  "IFCRELASSIGNSTOPRODUCT",
  "IFCRELCONNECTSELEMENTS",
  "IFCRELCONNECTSPORTS",
  "IFCRELCONNECTSPORTTOELEMENT",
  "IFCRELVOIDSELEMENT",
  "IFCRELFILLSELEMENT",
  "IFCRELSEQUENCE",
  "IFCRELSERVICESBUILDINGS",
];

export const UNIT_TYPES = [
  "LENGTHUNIT",
  "AREAUNIT",
  "VOLUMEUNIT",
  "MASSUNIT",
  "TIMEUNIT",
];

export const UNIT_NAMES = [
  "METRE",
  "SQUARE_METRE",
  "CUBIC_METRE",
  "GRAM",
  "SECOND",
];

export const PROPERTY_VALUE_TYPES = [
  "IFCLABEL",
  "IFCTEXT",
  "IFCIDENTIFIER",
  "IFCREAL",
  "IFCINTEGER",
  "IFCBOOLEAN",
  "IFCDATE",
  "IFCDATETIME",
  "IFCPROPERTYLISTVALUE:IFCLABEL",
  "IFCPROPERTYENUMERATEDVALUE:IFCLABEL",
  "IFCPROPERTYBOUNDEDVALUE:IFCREAL",
  "IFCPROPERTYTABLEVALUE:IFCREAL:IFCREAL",
];

export const QUANTITY_TYPES = [
  "IFCQUANTITYLENGTH",
  "IFCQUANTITYAREA",
  "IFCQUANTITYVOLUME",
  "IFCQUANTITYCOUNT",
  "IFCQUANTITYWEIGHT",
  "IFCQUANTITYTIME",
];

export const TYPE_CLASSES = [
  "IFCTYPEOBJECT",
  "IFCELEMENTTYPE",
  "IFCBUILDINGELEMENTPROXYTYPE",
  "IFCWALLTYPE",
  "IFCSLABTYPE",
  "IFCDOORTYPE",
  "IFCWINDOWTYPE",
  "IFCBEAMTYPE",
  "IFCCOLUMNTYPE",
];

export const GROUP_TYPES = ["IFCGROUP", "IFCSYSTEM", "IFCZONE", "IFCASSET"];

/**
 * Gruppenartige IFC-Klassen (IfcGroup-Zweig) für die Gruppen-Ansicht und den
 * Gruppen-Dialog, gegliedert für die oberste Baumebene.
 */
export const GROUP_VIEW_CATEGORIES: { label: string; types: string[] }[] = [
  {
    label: "Systeme",
    types: [
      "IFCSYSTEM",
      "IFCBUILDINGSYSTEM",
      "IFCBUILTSYSTEM",
      "IFCDISTRIBUTIONSYSTEM",
      "IFCDISTRIBUTIONCIRCUIT",
    ],
  },
  { label: "Zonen", types: ["IFCZONE"] },
  {
    label: "Gruppen",
    // IFCCONDITION/-CRITERION: IFC2x3-Altlasten (in IFC4 entfernt) — nur
    // für die Anzeige alter Dateien, nicht zum Anlegen anbieten.
    types: ["IFCGROUP", "IFCCONDITION", "IFCCONDITIONCRITERION"],
  },
  { label: "Anlagen & Inventar", types: ["IFCASSET", "IFCINVENTORY"] },
  {
    label: "Tragwerk",
    types: [
      "IFCSTRUCTURALANALYSISMODEL",
      "IFCSTRUCTURALLOADGROUP",
      "IFCSTRUCTURALLOADCASE",
      "IFCSTRUCTURALRESULTGROUP",
    ],
  },
];

export const GROUP_ENTITY_TYPES = new Set(
  GROUP_VIEW_CATEGORIES.flatMap((category) => category.types),
);

export const CONSTRAINT_GRADES = [
  "HARD",
  "SOFT",
  "ADVISORY",
  "USERDEFINED",
  "NOTDEFINED",
];

export const OBJECTIVE_QUALIFIERS = [
  "REQUIREMENT",
  "SPECIFICATION",
  "CODECOMPLIANCE",
  "HEALTHANDSAFETY",
  "DESIGNINTENT",
  "TRIGGERCONDITION",
  "MODELVIEW",
  "USERDEFINED",
  "NOTDEFINED",
];

export const GRAPH_PRESETS: Array<{
  value: NativeGraphPreset;
  label: string;
  detail: string;
}> = [
  {
    value: "all",
    label: "Übersicht",
    detail: "Alle semantischen Beziehungen; Psets und Qtos sind eingebettet",
  },
  {
    value: "spatial",
    label: "Räumlich",
    detail: "Aggregation, Verschachtelung und räumliche Zuordnung",
  },
  {
    value: "properties",
    label: "Eigenschaften",
    detail: "Eingebettete Psets und Qtos sowie Typdefinitionen",
  },
  {
    value: "resources",
    label: "Ressourcen",
    detail:
      "Gruppen, Bibliotheken und Prüfressourcen; Material, Klassifikation und Dokumente sind eingebettet",
  },
  {
    value: "geometry",
    label: "Geometrie",
    detail: "Platzierungs- und Repräsentationsreferenzen",
  },
];
