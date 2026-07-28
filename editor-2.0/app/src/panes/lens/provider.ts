/**
 * Brücke IfcDataStore → @ifc-lite/lens. Der Lens-Motor liest ausschließlich
 * über dieses Interface, deshalb genügt eine dünne Adapterschicht.
 *
 * Befund 6: Psets/Mengen kommen über `session.view` (MutablePropertyView) —
 * also `extractPropertiesOnDemand`/`extractQuantitiesOnDemand` (in
 * `ModelSession.open` verdrahtet) PLUS Mutations-Overlay, genau wie im
 * Listen-Provider. Ein direkter Extraktor-Aufruf sähe Sitzungsänderungen nicht,
 * und die Einfärbung wiche von Inspector/Listen/Export ab.
 *
 * Bewertet werden nur Entitäten MIT Geometrie — alles andere kann der Viewer
 * ohnehin nicht einfärben, und die Farb-Map bliebe unnötig groß.
 */
import {
  collectMaterialLeaves,
  extractClassificationsOnDemand,
  extractMaterialsOnDemand,
  resolveMaterialDefId,
  type IfcDataStore,
} from "@ifc-lite/parser";
import type { LensDataProvider, PropertySetInfo } from "@ifc-lite/lens";
import type { ModelSession } from "../../core/session";

/** Ab dieser Größe wird der älteste Cache-Eintrag verdrängt (Speicherschutz). */
const PSET_CACHE_LIMIT = 5000;

/**
 * FIFO statt `clear()` (Befund 14b): Ein kompletter Cache-Wurf ließ jede
 * weitere Entität über der Grenze neu parsen — mit `clear()` fiel die Trefferrate
 * am Limit auf null. Jetzt fliegt nur der älteste Schlüssel.
 */
function putCapped<T>(cache: Map<number, T>, key: number, value: T): T {
  if (cache.size >= PSET_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
}

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
  const qsetCache = new Map<number, QuantitySet[]>();

  const entityIds = (): number[] => (ids ??= collectEntityIds(store));

  const psetsOf = (expressId: number): PropertySetInfo[] => {
    const hit = psetCache.get(expressId);
    if (hit) return hit;
    return putCapped(
      psetCache,
      expressId,
      session.view.getForEntity(expressId).map((pset) => ({
        name: pset.name,
        properties: pset.properties.map((property) => ({
          name: property.name,
          value: property.value as unknown,
        })),
      })),
    );
  };

  const qsetsOf = (expressId: number): QuantitySet[] => {
    const hit = qsetCache.get(expressId);
    if (hit) return hit;
    return putCapped(
      qsetCache,
      expressId,
      session.view.getQuantitiesForEntity(expressId).map((qset) => ({
        name: qset.name,
        quantities: qset.quantities.map((quantity) => ({
          name: quantity.name,
          value: quantity.value as unknown,
        })),
      })),
    );
  };

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
