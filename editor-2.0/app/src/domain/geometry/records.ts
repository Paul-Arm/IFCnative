/**
 * Lesen und Schreiben einzelner STEP-Records (M5).
 *
 * Geometrie-Records (IfcCartesianPoint, IfcRectangleProfileDef,
 * IfcExtrudedAreaSolid …) haben keine benannten IfcRoot-Attribute — sie werden
 * ausschließlich positional gelesen und geschrieben. Die Quelle eines Records
 * ist dabei nicht einheitlich, deshalb dieselbe Dreistufigkeit wie in
 * `core/model/relationMembers.ts`:
 *   1. Overlay-Entity (`view.getNewEntity`) — in dieser Sitzung erzeugt,
 *   2. positionale Mutation über der Quellzeile,
 *   3. Quellzeile über `store.entityIndex.byId` + `EntityExtractor`.
 *
 * WICHTIG (StepExporter): Overlay-Entities werden aus `NewEntity.attributes`
 * serialisiert — positionale Mutationen ignoriert der Exporter dort. Ein
 * Schreibpfad muss deshalb zwischen Overlay-Record (Attribut direkt setzen)
 * und Quellzeilen-Record (`setPositionalAttribute`) unterscheiden.
 */
import { EntityExtractor, type IfcDataStore } from "@ifc-lite/parser";
import type {
  IfcAttributeValue,
  MutablePropertyView,
} from "@ifc-lite/mutations";

/** Momentaufnahme eines Records mit bereits eingerechneten Mutationen. */
export interface RecordView {
  expressId: number;
  /** STEP-Klasse in Großschreibung, z. B. „IFCEXTRUDEDAREASOLID" */
  type: string;
  attributes: IfcAttributeValue[];
  /** true = Overlay-Entity (kein Quellzeilen-Record) */
  overlay: boolean;
}

/** `#42` oder 42 → 42; alles andere → null. */
export function refOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^#\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim().slice(1), 10);
  }
  return null;
}

/** Zahlenwert eines Attributs (auch als `{ real }`-Marker geschrieben). */
export function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "real" in value &&
    typeof (value as { real: unknown }).real === "number"
  ) {
    return (value as { real: number }).real;
  }
  return null;
}

/** Erste Referenz einer Liste (STEP-Listen kommen als Array an). */
export function firstRefOf(value: unknown): number | null {
  if (!Array.isArray(value)) return refOf(value);
  for (const item of value) {
    const id = refOf(item);
    if (id !== null) return id;
  }
  return null;
}

export function readRecord(
  store: IfcDataStore,
  view: MutablePropertyView,
  expressId: number,
): RecordView | null {
  const overlay = view.getNewEntity(expressId);
  if (overlay) {
    return {
      expressId,
      type: overlay.type.toUpperCase(),
      attributes: [...overlay.attributes],
      overlay: true,
    };
  }
  const ref = store.entityIndex.byId.get(expressId);
  if (!ref) return null;
  const entity = new EntityExtractor(store.source).extractEntity(ref);
  if (!entity) return null;
  const attributes = [...entity.attributes] as IfcAttributeValue[];
  const patches = view.getPositionalMutationsForEntity(expressId);
  if (patches) {
    for (const [index, value] of patches) attributes[index] = value;
  }
  return {
    expressId,
    type: entity.type.toUpperCase(),
    attributes,
    overlay: false,
  };
}

/**
 * Rückgängig-Information einer positionalen Änderung. `previous === undefined`
 * bedeutet bei Quellzeilen-Records „es gab noch keine Mutation" — das Undo
 * entfernt den Override dann vollständig.
 */
export interface PositionalEdit {
  expressId: number;
  index: number;
  overlay: boolean;
  previous: IfcAttributeValue | undefined;
}

/** Positionales Attribut setzen und die Undo-Information zurückgeben. */
export function writePositional(
  view: MutablePropertyView,
  record: RecordView,
  index: number,
  value: IfcAttributeValue,
  skipHistory = false,
): PositionalEdit {
  if (record.overlay) {
    const entity = view.getNewEntity(record.expressId);
    const previous = entity?.attributes[index];
    if (entity) entity.attributes[index] = value;
    return {
      expressId: record.expressId,
      index,
      overlay: true,
      previous,
    };
  }
  const previous = view
    .getPositionalMutationsForEntity(record.expressId)
    ?.get(index);
  view.setPositionalAttribute(record.expressId, index, value, skipHistory);
  return { expressId: record.expressId, index, overlay: false, previous };
}

/** Gegenstück zu `writePositional` — stellt den vorgefundenen Zustand her. */
export function restorePositional(
  view: MutablePropertyView,
  edit: PositionalEdit,
): void {
  if (edit.overlay) {
    const entity = view.getNewEntity(edit.expressId);
    if (entity && edit.previous !== undefined) {
      entity.attributes[edit.index] = edit.previous;
    }
    return;
  }
  if (edit.previous === undefined) {
    view.removePositionalMutation(edit.expressId, edit.index);
  } else {
    view.setPositionalAttribute(edit.expressId, edit.index, edit.previous, true);
  }
}

/**
 * Maßstab des Modells: Meter pro Modelleinheit (1 bei Metern, 0.001 bei
 * Millimetern). Fällt auf 1 zurück, wenn der Parser nichts ermitteln konnte.
 */
export function lengthScaleOf(store: IfcDataStore): number {
  const scale = (store as { lengthUnitScale?: number }).lengthUnitScale;
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0
    ? scale
    : 1;
}

/** Meter → Modelleinheit (auf 9 Nachkommastellen gerundet wie in ifc-lite). */
export function toNative(store: IfcDataStore, metres: number): number {
  return Math.round((metres / lengthScaleOf(store)) * 1e9) / 1e9;
}

/** Modelleinheit → Meter. */
export function toMetres(store: IfcDataStore, native: number): number {
  return native * lengthScaleOf(store);
}
