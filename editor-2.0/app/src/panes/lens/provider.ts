/**
 * Brücke IfcDataStore → @ifc-lite/lens. Der Lens-Motor liest ausschließlich
 * über dieses Interface, deshalb genügt eine dünne Adapterschicht auf die
 * On-Demand-Extraktoren des Parsers.
 *
 * Bewertet werden nur Entitäten MIT Geometrie — alles andere kann der Viewer
 * ohnehin nicht einfärben, und die Farb-Map bliebe unnötig groß.
 */
import {
  collectMaterialLeaves,
  extractClassificationsOnDemand,
  extractMaterialsOnDemand,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  resolveMaterialDefId,
  type IfcDataStore,
} from "@ifc-lite/parser";
import type { LensDataProvider, PropertySetInfo } from "@ifc-lite/lens";
import type { ModelSession } from "../../core/session";

/** Ab dieser Größe wird der Pset-Cache verworfen (Speicherschutz). */
const PSET_CACHE_LIMIT = 5000;

function collectEntityIds(store: IfcDataStore): number[] {
  const table = store.entities;
  const geometric: number[] = [];
  for (let i = 0; i < table.count; i++) {
    const expressId = table.expressId[i];
    if (table.hasGeometry(expressId)) geometric.push(expressId);
  }
  if (geometric.length > 0) return geometric;
  const all: number[] = [];
  for (let i = 0; i < table.count; i++) all.push(table.expressId[i]);
  return all;
}

interface QuantitySet {
  name: string;
  quantities: Array<{ name: string; value: unknown }>;
}

export function createLensProvider(
  docId: string,
  session: ModelSession,
): LensDataProvider {
  const store = session.store;
  let ids: number[] | null = null;
  const psetCache = new Map<number, PropertySetInfo[]>();

  const entityIds = (): number[] => (ids ??= collectEntityIds(store));

  const psetsOf = (expressId: number): PropertySetInfo[] => {
    const cached = psetCache.get(expressId);
    if (cached) return cached;
    const sets = extractPropertiesOnDemand(store, expressId).map((pset) => ({
      name: pset.name,
      properties: pset.properties.map((property) => ({
        name: property.name,
        value: property.value as unknown,
      })),
    }));
    if (psetCache.size >= PSET_CACHE_LIMIT) psetCache.clear();
    psetCache.set(expressId, sets);
    return sets;
  };

  const qsetsOf = (expressId: number): QuantitySet[] =>
    extractQuantitiesOnDemand(store, expressId) as QuantitySet[];

  return {
    getEntityCount() {
      return entityIds().length;
    },

    forEachEntity(callback) {
      for (const expressId of entityIds()) callback(expressId, docId);
    },

    getEntityType(expressId) {
      return store.entities.getTypeName(expressId) || undefined;
    },

    getPropertyValue(expressId, propertySetName, propertyName) {
      const set = psetsOf(expressId).find((s) => s.name === propertySetName);
      return set?.properties.find((p) => p.name === propertyName)?.value;
    },

    getPropertySets(expressId) {
      return psetsOf(expressId);
    },

    getEntityAttribute(expressId, attrName) {
      const table = store.entities;
      switch (attrName) {
        case "Name":
          return table.getName(expressId) || undefined;
        case "Description":
          return table.getDescription(expressId) || undefined;
        case "ObjectType":
          return table.getObjectType(expressId) || undefined;
        case "Tag":
          return table.getTag?.(expressId) || undefined;
        case "PredefinedType":
          return table.getPredefinedType?.(expressId) || undefined;
        default:
          return undefined;
      }
    },

    getQuantityValue(expressId, qsetName, quantName) {
      const set = qsetsOf(expressId).find((s) => s.name === qsetName);
      const value = set?.quantities.find((q) => q.name === quantName)?.value;
      if (typeof value === "number" || typeof value === "string") return value;
      return undefined;
    },

    getQuantitySets(expressId) {
      return qsetsOf(expressId).map((set) => ({
        name: set.name,
        quantities: set.quantities.map((q) => ({ name: q.name })),
      }));
    },

    getClassifications(expressId) {
      return extractClassificationsOnDemand(store, expressId).map((entry) => ({
        system: entry.system,
        identification: entry.identification,
        name: entry.name,
      }));
    },

    getMaterialName(expressId) {
      const info = extractMaterialsOnDemand(store, expressId);
      if (!info) return undefined;
      return (
        info.name ??
        info.layers?.[0]?.materialName ??
        info.constituents?.[0]?.materialName ??
        info.profiles?.[0]?.materialName ??
        info.materials?.[0]?.name
      );
    },

    getMaterialNames(expressId) {
      const defId = resolveMaterialDefId(store, expressId);
      if (defId === undefined) return [];
      const names: string[] = [];
      for (const leaf of collectMaterialLeaves(store, defId)) {
        if (leaf.name && !names.includes(leaf.name)) names.push(leaf.name);
      }
      return names;
    },

    getModelId() {
      return docId;
    },

    getModelName() {
      return session.fileName;
    },
  };
}
