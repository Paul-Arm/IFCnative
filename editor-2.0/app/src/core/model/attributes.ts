/**
 * Identitäts- und Mengen-Informationen eines Objekts (lesend, M1).
 */
import {
  extractQuantitiesOnDemand,
  type IfcDataStore,
} from "@ifc-lite/parser";

export interface EntityIdentity {
  expressId: number;
  type: string;
  globalId: string;
  name: string;
  description: string;
  objectType: string;
}

export interface QuantityView {
  name: string;
  quantities: Array<{ name: string; value: string; unit?: string }>;
}

export function identityOf(
  store: IfcDataStore,
  expressId: number,
): EntityIdentity {
  const e = store.entities;
  return {
    expressId,
    type: e.getTypeName(expressId),
    globalId: e.getGlobalId(expressId),
    name: e.getName(expressId),
    description: e.getDescription(expressId),
    objectType: e.getObjectType(expressId),
  };
}

export function quantitiesOf(
  store: IfcDataStore,
  expressId: number,
): QuantityView[] {
  const sets = extractQuantitiesOnDemand(store, expressId) as Array<{
    name: string;
    quantities: Array<{ name: string; value: unknown; unit?: string }>;
  }>;
  return sets.map((set) => ({
    name: set.name,
    quantities: set.quantities.map((q) => ({
      name: q.name,
      value: q.value === null || q.value === undefined ? "" : String(q.value),
      unit: q.unit,
    })),
  }));
}

/** Kurzlabel „IfcWall ‚Name' (#42)" für Listen, Tabs und Graph-Knoten. */
export function entityLabel(store: IfcDataStore, expressId: number): string {
  const type = store.entities.getTypeName(expressId);
  const name = store.entities.getName(expressId);
  return name ? `${type} ‚${name}' (#${expressId})` : `${type} (#${expressId})`;
}
