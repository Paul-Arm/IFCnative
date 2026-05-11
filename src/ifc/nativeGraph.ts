import type { NativeIfcDocument, NativeIfcRelationship } from './nativeDocument';

export type NativeGraphPreset = 'all' | 'spatial' | 'properties' | 'resources' | 'geometry';

export interface NativeGraphNeighborhoodOptions {
  collapsed?: Set<number>;
  depth: number;
  expanded?: Set<number>;
  maxEdges?: number;
  maxNodes?: number;
  pinned?: Set<number>;
  preset?: NativeGraphPreset;
  relationshipTypes?: Set<string>;
  selectedId: number;
}

export interface NativeGraphEdge {
  rel: number;
  source: number;
  target: number;
  label: string;
  type: string;
}

export interface NativeGraphNeighborhood {
  capped: boolean;
  childCounts: Map<number, number>;
  edges: NativeGraphEdge[];
  levels: Map<number, number>;
  loadedSources: Set<number>;
  nodeIds: number[];
  relationshipTypes: string[];
}

const PRESET_RELATIONSHIPS: Record<NativeGraphPreset, string[] | undefined> = {
  all: undefined,
  geometry: ['IFCPRODUCTDEFINITIONSHAPE', 'IFCSHAPEREPRESENTATION', 'IFCEXTRUDEDAREASOLID', 'IFCLOCALPLACEMENT'],
  properties: ['IFCRELDEFINESBYPROPERTIES', 'IFCRELDEFINESBYTYPE'],
  resources: [
    'IFCRELASSIGNSTOGROUP',
    'IFCRELASSOCIATESMATERIAL',
    'IFCRELASSOCIATESCLASSIFICATION',
    'IFCRELASSOCIATESDOCUMENT',
    'IFCRELASSOCIATESLIBRARY',
  ],
  spatial: [
    'IFCRELAGGREGATES',
    'IFCRELNESTS',
    'IFCRELCONTAINEDINSPATIALSTRUCTURE',
    'IFCRELREFERENCEDINSPATIALSTRUCTURE',
  ],
};

export function relationshipTypesForPreset(preset: NativeGraphPreset) {
  return PRESET_RELATIONSHIPS[preset] ? [...(PRESET_RELATIONSHIPS[preset] as string[])] : [];
}

export function buildNativeGraphNeighborhood(
  document: NativeIfcDocument,
  options: NativeGraphNeighborhoodOptions,
): NativeGraphNeighborhood {
  const collapsed = options.collapsed ?? new Set<number>();
  const expanded = options.expanded ?? new Set<number>();
  const pinned = options.pinned ?? new Set<number>();
  const maxEdges = options.maxEdges ?? 240;
  const maxNodes = options.maxNodes ?? 160;
  const relationshipTypes = effectiveRelationshipTypes(options.preset ?? 'all', options.relationshipTypes);
  const anchors = unique([options.selectedId, ...pinned].filter((id) => document.entityById.has(id)));
  const nodeSet = new Set(anchors);
  const levels = new Map<number, number>(anchors.map((id) => [id, 0]));
  const edges: NativeGraphEdge[] = [];
  const loadedSources = new Set<number>();
  const childCounts = new Map<number, number>();
  let capped = false;

  const addSource = (sourceId: number, level: number) => {
    const relationships = relationshipsForSource(document, sourceId, relationshipTypes);
    const targets = unique(
      relationships.flatMap((relationship) =>
        relationship.sourceIds.includes(sourceId) ? relationship.targetIds : relationship.sourceIds,
      ),
    );
    childCounts.set(sourceId, targets.length);
    if (targets.length) {
      loadedSources.add(sourceId);
    }
    const accepted: number[] = [];
    for (const target of targets) {
      if (nodeSet.size >= maxNodes && !nodeSet.has(target)) {
        capped = true;
        continue;
      }
      nodeSet.add(target);
      if (!levels.has(target)) {
        levels.set(target, level + 1);
      }
      accepted.push(target);
    }
    for (const relationship of relationships) {
      for (const source of relationship.sourceIds) {
        for (const target of relationship.targetIds) {
          if (nodeSet.has(source) && nodeSet.has(target) && edges.length < maxEdges) {
            edges.push({ label: shortType(relationship.type), rel: relationship.id, source, target, type: relationship.type });
          }
        }
      }
    }
    return accepted;
  };

  let frontier = anchors;
  for (let level = 0; level < options.depth; level += 1) {
    const next: number[] = [];
    for (const source of unique(frontier)) {
      if (!collapsed.has(source)) {
        next.push(...addSource(source, level));
      }
    }
    frontier = next;
  }
  for (const source of expanded) {
    if (!collapsed.has(source) && document.entityById.has(source)) {
      addSource(source, levels.get(source) ?? 0);
    }
  }
  for (const id of nodeSet) {
    if (!childCounts.has(id)) {
      childCounts.set(id, directChildCount(document, id, relationshipTypes));
    }
  }

  return {
    capped,
    childCounts,
    edges: uniqueEdges(edges),
    levels,
    loadedSources,
    nodeIds: [...nodeSet].sort((a, b) => (levels.get(a) ?? 0) - (levels.get(b) ?? 0) || a - b),
    relationshipTypes: [...relationshipTypes].sort(),
  };
}

function effectiveRelationshipTypes(preset: NativeGraphPreset, explicit?: Set<string>) {
  if (explicit?.size) {
    return new Set([...explicit].map(normalizeType));
  }
  const presetTypes = relationshipTypesForPreset(preset);
  if (presetTypes.length) {
    return new Set(presetTypes.map(normalizeType));
  }
  return new Set<string>();
}

function relationshipsForSource(document: NativeIfcDocument, sourceId: number, relationshipTypes: Set<string>) {
  return document.relationships.filter(
    (relationship) =>
      relationshipMatches(relationship, relationshipTypes) &&
      (relationship.sourceIds.includes(sourceId) || relationship.targetIds.includes(sourceId)),
  );
}

function relationshipMatches(relationship: NativeIfcRelationship, relationshipTypes: Set<string>) {
  return relationshipTypes.size === 0 || relationshipTypes.has(normalizeType(relationship.type));
}

function directChildCount(document: NativeIfcDocument, id: number, relationshipTypes: Set<string>) {
  return unique(
    document.relationships.flatMap((relationship) => {
      if (!relationshipMatches(relationship, relationshipTypes)) {
        return [];
      }
      return relationship.sourceIds.includes(id)
        ? relationship.targetIds
        : relationship.targetIds.includes(id)
          ? relationship.sourceIds
          : [];
    }),
  ).length;
}

function uniqueEdges(edges: NativeGraphEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.rel}-${edge.source}-${edge.target}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function normalizeType(value: string) {
  return value.trim().toUpperCase();
}

function shortType(type: string) {
  return type.replace(/^IFCREL/i, '').replace(/^IFC/i, '');
}
