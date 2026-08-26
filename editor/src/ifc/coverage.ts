export type CapabilityStatus = 'implemented' | 'partial' | 'planned';

export interface CapabilityItem {
  title: string;
  status: CapabilityStatus;
  detail: string;
}

export const IFC_CAPABILITY_MATRIX: CapabilityItem[] = [
  {
    title: 'STEP frame, header, schema',
    status: 'implemented',
    detail: 'Preflight checks ISO-10303-21 frame, HEADER/DATA sections, FILE_NAME, FILE_DESCRIPTION and FILE_SCHEMA.',
  },
  {
    title: 'Typed entity loading',
    status: 'implemented',
    detail: 'web-ifc loads IFC2X3, IFC4 and IFC4X3 family entities and exposes typed lines by express ID.',
  },
  {
    title: 'Relationship graph',
    status: 'implemented',
    detail: 'Indexes aggregates, containment, types, groups/zones/systems, materials, classifications, documents, libraries, constraints, approvals and common relationship families using per-entity relationship lookups.',
  },
  {
    title: 'Spatial and containment trees',
    status: 'implemented',
    detail: 'Builds separate aggregate and containment trees from explicit IFC relationships.',
  },
  {
    title: 'Properties and quantities',
    status: 'implemented',
    detail: 'Reads and authors IfcPropertySet, IfcElementQuantity, single/list/enumerated/bounded/table simple properties and type-level HasPropertySets when available.',
  },
  {
    title: 'Geometry streaming',
    status: 'implemented',
    detail: 'Streams meshes through web-ifc and converts vertex/index buffers for Three.js.',
  },
  {
    title: 'Writer/export',
    status: 'partial',
    detail: 'Exports loaded models via SaveModel and authors IFC4X3_ADD2 project, spatial structure, products, geometry, Psets, QTOs, simple materials, material properties, material visual styles via material definition representations, material layer/profile/constituent sets, occurrence-specific layer/profile set usages, groups/zones/systems via IfcRelAssignsToGroup, classifications, documents, libraries, approvals and objective constraints.',
  },
  {
    title: 'IDS/MVD validation',
    status: 'planned',
    detail: 'Schema, IDS and MVD diagnostics are kept as separate future reporting layers.',
  },
  {
    title: 'ifcZIP/ifcXML',
    status: 'planned',
    detail: 'Initial version focuses on IFC-SPF .ifc files.',
  },
  {
    title: 'Monitoring and diagnostics domain objects',
    status: 'planned',
    detail: 'Sensors, PerformanceHistory, conditions, inspections and risks remain authored in a later builder pass.',
  },
  {
    title: 'Structural analysis coupling',
    status: 'planned',
    detail: 'IfcStructuralAnalysisModel and result groups are detected as entities but not deeply authored yet.',
  },
];
