/**
 * Lesebrücke zwischen Inspector und Mutations-Overlay.
 *
 * `parseColumnar()` baut absichtlich leere Property-/Quantity-Tabellen und
 * verweist auf die On-Demand-Extraktoren. Diese Extraktoren hängt
 * `ModelSession.open()` einmalig in die `MutablePropertyView` ein (Befund 11:
 * eine zweite Verdrahtung hier hat das Quantity-Mapping der Sitzung
 * überschrieben). Für die Panes gilt deshalb: Das Overlay ist die einzige
 * Wahrheit für Lesen UND Schreiben — `session.view.getForEntity()` liefert
 * Basisdaten plus Mutationen.
 */
import { extractEntityAttributesOnDemand } from "@ifc-lite/parser";
import type {
  PropertyValue,
  PropertyValueType,
  QuantityType,
} from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";

export interface EditableProperty {
  name: string;
  value: PropertyValue;
  type: PropertyValueType;
  unit?: string;
}

export interface EditablePset {
  name: string;
  properties: EditableProperty[];
}

export interface EditableQuantity {
  name: string;
  value: number;
  type: QuantityType;
  unit?: string;
}

export interface EditableQuantitySet {
  name: string;
  quantities: EditableQuantity[];
}

/** Editierbare IfcRoot-Attribute inklusive Overlay-Änderungen. */
export interface EditableAttributes {
  name: string;
  description: string;
  objectType: string;
}

/** Alle Psets eines Objekts inklusive Overlay-Änderungen. */
export function readPsets(
  session: ModelSession,
  expressId: number,
): EditablePset[] {
  return session.view.getForEntity(expressId).map((pset) => ({
    name: pset.name,
    properties: pset.properties.map((property) => ({
      name: property.name,
      value: property.value,
      type: property.type,
      unit: property.unit,
    })),
  }));
}

/** Alle Mengensätze eines Objekts inklusive Overlay-Änderungen. */
export function readQuantitySets(
  session: ModelSession,
  expressId: number,
): EditableQuantitySet[] {
  return session.view.getQuantitiesForEntity(expressId).map((qset) => ({
    name: qset.name,
    quantities: qset.quantities.map((quantity) => ({
      name: quantity.name,
      value: quantity.value,
      type: quantity.type,
      unit: quantity.unit,
    })),
  }));
}

/**
 * Name/Beschreibung/ObjectType als „was der Nutzer gerade sieht".
 *
 * Basis ist die On-Demand-Extraktion aus dem Quellpuffer — die
 * Entity-Tabelle des Parsers führt Description/ObjectType nur für Gruppen und
 * lieferte sonst leere Strings. Darüber liegen die Attribut-Mutationen des
 * Overlays, damit ein Commit sofort sichtbar bleibt.
 */
export function readAttributes(
  session: ModelSession,
  expressId: number,
): EditableAttributes {
  const identity = session.identityOf(expressId);
  let base: EditableAttributes = {
    name: identity.name,
    description: identity.description,
    objectType: identity.objectType,
  };
  try {
    const raw = extractEntityAttributesOnDemand(session.store, expressId);
    base = {
      name: raw.name || identity.name,
      description: raw.description || identity.description,
      objectType: raw.objectType || identity.objectType,
    };
  } catch {
    // Nicht jede Entity lässt sich nachladen — dann bleibt die Tabellenlesung.
  }

  const result = { ...base };
  for (const mutation of session.view.getAttributeMutationsForEntity(expressId)) {
    if (mutation.name === "Name") result.name = mutation.value;
    else if (mutation.name === "Description") result.description = mutation.value;
    else if (mutation.name === "ObjectType") result.objectType = mutation.value;
  }
  return result;
}
