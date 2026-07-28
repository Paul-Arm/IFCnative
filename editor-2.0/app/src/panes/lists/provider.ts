/**
 * Brücke IfcDataStore → @ifc-lite/lists. Der Listen-Motor (`executeList`,
 * `discoverColumns`) liest ausschließlich über den `ListDataProvider`-Vertrag,
 * deshalb genügt eine dünne Adapterschicht auf Entity-Tabelle und
 * On-Demand-Extraktoren des Parsers.
 *
 * Instanz-Psets/-Mengen kommen über `session.view` (MutablePropertyView) — das
 * ist genau `extractPropertiesOnDemand`/`extractQuantitiesOnDemand` (in
 * `ModelSession.open` verdrahtet) PLUS dem Mutations-Overlay, damit die Liste
 * bearbeitete Werte zeigt. Typ-geerbte Sets (IfcRelDefinesByType) kommen direkt
 * aus den Extraktoren, denn dafür gibt es kein Overlay.
 *
 * Der Provider cached Psets/Mengen je Entität: `executeList` und
 * `discoverColumns` laufen mehrfach über dieselben Objekte (Spalte hinzufügen,
 * sortieren, gruppieren) und die On-Demand-Extraktion parst jedes Mal neu.
 */
import {
  extractClassificationsOnDemand,
  extractMaterialsOnDemand,
  extractTypePropertiesOnDemand,
  extractTypeQuantitiesOnDemand,
  type IfcDataStore,
  type MaterialInfo,
} from "@ifc-lite/parser";
import { IfcTypeEnumToString } from "@ifc-lite/data";
import type {
  PropertySet,
  PropertyValue,
  PropertyValueType,
  QuantitySet,
  QuantityType,
} from "@ifc-lite/data";
import type {
  ListClassificationRef,
  ListDataProvider,
} from "@ifc-lite/lists";
import { storeyOf } from "../../core/model/spatial";
import type { ModelSession } from "../../core/session";

/**
 * Ab dieser Größe verdrängt ein neuer Eintrag den ältesten (Review-Befund
 * 14a). Früher wurde der ganze Cache geleert — beim Scrollen durch ein Modell
 * knapp über der Grenze fiel dadurch reihum jede Extraktion neu an.
 */
const CACHE_LIMIT = 20000;

/** Rohform der On-Demand-Extraktoren (numerische `type`-Codes statt Enums). */
interface RawPset {
  name: string;
  globalId?: string;
  properties: Array<{
    name: string;
    type: number;
    value: PropertyValue;
    values?: string[];
    dataType?: string;
  }>;
}

interface RawQset {
  name: string;
  quantities: Array<{ name: string; type: number; value: number }>;
}

function toPropertySets(raw: RawPset[]): PropertySet[] {
  return raw.map((set) => ({
    name: set.name,
    globalId: set.globalId ?? "",
    properties: set.properties.map((property) => ({
      name: property.name,
      type: property.type as PropertyValueType,
      value: property.value,
      values: property.values,
      dataType: property.dataType,
    })),
  }));
}

function toQuantitySets(raw: RawQset[]): QuantitySet[] {
  return raw.map((set) => ({
    name: set.name,
    quantities: set.quantities.map((quantity) => ({
      name: quantity.name,
      type: quantity.type as QuantityType,
      value: quantity.value,
    })),
  }));
}

/** Alle Materialnamen einer Zuordnung: Basismaterial + Schichten/Profile/… */
function materialNames(info: MaterialInfo | null): string[] {
  if (!info) return [];
  const names: string[] = [];
  const push = (value: string | undefined): void => {
    if (value && !names.includes(value)) names.push(value);
  };
  push(info.name);
  for (const layer of info.layers ?? []) push(layer.materialName ?? layer.name);
  for (const item of info.constituents ?? []) push(item.materialName ?? item.name);
  for (const item of info.profiles ?? []) push(item.materialName ?? item.name);
  for (const item of info.materials ?? []) push(item.name);
  return names;
}

/** Erster Treffer eines räumlichen Typs, für Projekt-/Gebäude-/Standortnamen. */
function firstOfType(store: IfcDataStore, upperTypeName: string): number | null {
  return store.entityIndex.byType.get(upperTypeName)?.[0] ?? null;
}

export function createListProvider(session: ModelSession): ListDataProvider {
  const store = session.store;
  const table = store.entities;
  const byType = store.entityIndex.byType;

  const psetCache = new Map<number, PropertySet[]>();
  const qsetCache = new Map<number, QuantitySet[]>();
  const typePsetCache = new Map<number, PropertySet[]>();
  const typeQsetCache = new Map<number, QuantitySet[]>();
  const typeNameCache = new Map<number, string>();
  let allIds: number[] | null = null;

  function cached<T>(
    cache: Map<number, T>,
    expressId: number,
    compute: () => T,
  ): T {
    const hit = cache.get(expressId);
    if (hit !== undefined) return hit;
    const value = compute();
    // FIFO-Verdrängung: Map hält Einfügereihenfolge, der erste Key ist der
    // älteste Eintrag.
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(expressId, value);
    return value;
  }

  /** Name des Geschosses/Gebäudes/Standorts über die räumliche Hierarchie. */
  const spatialName = (expressId: number): string => {
    const storey = storeyOf(store, expressId);
    return storey === null ? "" : table.getName(storey) || table.getTypeName(storey);
  };

  const namedSingleton = (upperTypeName: string): string => {
    const id = firstOfType(store, upperTypeName);
    return id === null ? "" : table.getName(id);
  };

  /**
   * Review-Befund 4: gelöschte (tombstonete) Objekte dürfen in keiner Liste
   * mehr auftauchen — sie sind nach dem Export nicht mehr im Modell. Der
   * Filter sitzt an den beiden Einstiegen des Listen-Motors, damit jede
   * Spalte, Gruppierung und Auswertung ihn automatisch mitbekommt.
   */
  const alive = (ids: readonly number[]): number[] =>
    ids.filter((id) => !session.isDeleted(id));

  /** Tombstone-Stand, an dem `allIds` gebaut wurde. */
  let allIdsTombstones = -1;

  return {
    getEntitiesByType(type) {
      const name = IfcTypeEnumToString(type);
      if (name === "Unknown") return [];
      return alive(byType.get(name.toUpperCase()) ?? table.getByType(type));
    },

    getAllEntityIds() {
      const tombstones = session.view.getTombstones().size;
      if (allIds && allIdsTombstones === tombstones) return allIds;
      const ids: number[] = [];
      for (let i = 0; i < table.count; i++) {
        const id = table.expressId[i];
        if (!session.isDeleted(id)) ids.push(id);
      }
      allIds = ids;
      allIdsTombstones = tombstones;
      return ids;
    },

    getEntityName(expressId) {
      return table.getName(expressId);
    },

    getEntityGlobalId(expressId) {
      return table.getGlobalId(expressId);
    },

    getEntityDescription(expressId) {
      return table.getDescription(expressId);
    },

    getEntityObjectType(expressId) {
      return table.getObjectType(expressId);
    },

    getEntityTypeName(expressId) {
      return table.getTypeName(expressId);
    },

    getEntityTag(expressId) {
      return table.getTag?.(expressId) ?? "";
    },

    getEntityPredefinedType(expressId) {
      return table.getPredefinedType?.(expressId) ?? "";
    },

    /** Name des IfcTypeProduct (Spalte „Type"), nicht die IFC-Klasse. */
    getEntityDefiningTypeName(expressId) {
      return cached(
        typeNameCache,
        expressId,
        () => extractTypePropertiesOnDemand(store, expressId)?.typeName ?? "",
      );
    },

    getPropertySets(expressId) {
      return cached(psetCache, expressId, () =>
        session.view.getForEntity(expressId),
      );
    },

    getQuantitySets(expressId) {
      return cached(qsetCache, expressId, () =>
        session.view.getQuantitiesForEntity(expressId),
      );
    },

    getTypePropertySets(expressId) {
      return cached(typePsetCache, expressId, () =>
        toPropertySets(
          (extractTypePropertiesOnDemand(store, expressId)?.properties ??
            []) as RawPset[],
        ),
      );
    },

    getTypeQuantitySets(expressId) {
      return cached(typeQsetCache, expressId, () =>
        toQuantitySets(
          (extractTypeQuantitiesOnDemand(store, expressId)?.quantities ??
            []) as RawQset[],
        ),
      );
    },

    getMaterialNames(expressId) {
      return materialNames(extractMaterialsOnDemand(store, expressId));
    },

    getClassifications(expressId) {
      return extractClassificationsOnDemand(store, expressId).map(
        (entry): ListClassificationRef => ({
          system: entry.system,
          code: entry.identification,
          name: entry.name,
        }),
      );
    },

    getStoreyName(expressId) {
      return spatialName(expressId);
    },

    getContainerName(expressId) {
      return spatialName(expressId);
    },

    getBuildingName() {
      return namedSingleton("IFCBUILDING");
    },

    getSiteName() {
      return namedSingleton("IFCSITE");
    },

    getProjectName() {
      return namedSingleton("IFCPROJECT");
    },

    getModelName() {
      return session.fileName;
    },
  };
}
