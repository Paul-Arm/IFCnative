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
  "object-info",
  "console",
  "diagnostics",
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

export const MOSAIC_TITLES: Record<MosaicViewId, string> = {
  builder: "Baukasten",
  catalog: "Objektkatalog",
  "catalog-review": "Objektkatalog: Pruefung",
  console: "JS Console",
  diagnostics: "Diagnostics",
  inspector: "Inspector",
  "object-info": "Objektinfo: IDs",
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
  "IFCREAL",
  "IFCINTEGER",
  "IFCBOOLEAN",
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
