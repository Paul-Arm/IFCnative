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
  "resource-references",
  "resource-controls",
  "object-info",
  "console",
  "diagnostics",
  "recent",
  "notes",
];

export const DEFAULT_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: {
    direction: "column",
    first: "structure",
    second: "builder",
    splitPercentage: 62,
  },
  second: {
    direction: "column",
    first: {
      direction: "row",
      first: "viewer",
      second: "inspector",
      splitPercentage: 66,
    },
    second: {
      direction: "row",
      first: "console",
      second: "diagnostics",
      splitPercentage: 52,
    },
    splitPercentage: 72,
  },
  splitPercentage: 27,
};

export const REVIEW_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: {
    direction: "column",
    first: "viewer",
    second: {
      direction: "row",
      first: "object-info",
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
    second: "structure",
    splitPercentage: 72,
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
  first: {
    direction: "column",
    first: "viewer",
    second: "console",
    splitPercentage: 76,
  },
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
    description: "Viewer, Struktur, Builder, Inspector und Review-Tools.",
    id: DEFAULT_WORKSPACE_ID,
    layout: DEFAULT_MOSAIC_LAYOUT,
    name: "Editor",
  },
  {
    builtIn: true,
    description: "Grosses Modellfenster mit Pruefung und Notizen.",
    id: "builtin:review",
    layout: REVIEW_MOSAIC_LAYOUT,
    name: "Review",
  },
  {
    builtIn: true,
    description: "Pruefung mit Inspector, Ressourcen und Kontrollfreigaben.",
    id: "builtin:inspection",
    layout: INSPECTION_MOSAIC_LAYOUT,
    name: "Pruefung",
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
    description: "Koordination mit Viewer, Baum, Console und Ablage.",
    id: "builtin:coordination",
    layout: COORDINATION_MOSAIC_LAYOUT,
    name: "Koordination",
  },
];

export const MOSAIC_TITLES: Record<MosaicViewId, string> = {
  builder: "Baukasten",
  catalog: "Objektkatalog",
  "catalog-review": "Objektkatalog: Pruefung",
  console: "JS Console",
  diagnostics: "Diagnostik",
  inspector: "Inspector",
  notes: "Notizen",
  "object-info": "Objektinfo: IDs",
  recent: "Kuerzlich verwendet",
  "resource-references": "Klassifikation & Dokumente",
  "resource-controls": "Freigaben & Constraints",
  structure: "Structure",
  viewer: "3D Viewer",
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
  { value: "all", label: "All", detail: "Every indexed relationship type" },
  {
    value: "spatial",
    label: "Spatial",
    detail: "Aggregation, nesting and containment",
  },
  {
    value: "properties",
    label: "Properties",
    detail: "Psets, quantities and type definitions",
  },
  {
    value: "resources",
    label: "Resources",
    detail: "Groups, materials, classification and documents",
  },
  {
    value: "geometry",
    label: "Geometry",
    detail: "Placement and representation references when indexed",
  },
];
