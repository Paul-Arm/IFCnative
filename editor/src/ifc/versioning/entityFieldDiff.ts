import {
  getNativeBodyRepresentation,
  getNativePlacement,
  type NativeIfcDocument,
  type NativeIfcEntity,
  type NativeIfcPropertySet,
} from "../nativeDocument";

/**
 * Field-level "what changed" diff for a single entity, keyed by IFC GlobalId.
 *
 * The manifest diff in `entityDiffByGuid.ts` only reports *that* an entity
 * changed (its content hash differs). This drills into a single GlobalId and
 * explains *what* changed, by comparing the human-meaningful fields of the
 * entity in two parsed documents:
 *
 *  - direct attributes (type, name, description),
 *  - placement coordinates (X / Y / Z) for located products,
 *  - swept-solid geometry summary (profile, width, depth, height, radius),
 *  - every attached property set / quantity set value.
 *
 * GUID-less support geometry and property values fold into the owning rooted
 * entity's hash, so a moved point or a changed property value surfaces here as
 * a Placement / Geometry / Pset field change on its owning product.
 */

export type FieldChangeStatus = "added" | "removed" | "modified";

export interface EntityFieldChange {
  /** Logical grouping: "Attributes", "Placement", "Geometry", or a Pset/Qto name. */
  group: string;
  field: string;
  before: string | null;
  after: string | null;
  status: FieldChangeStatus;
}

export interface EntityFieldDiff {
  globalId: string;
  type: string | null;
  name: string | null;
  /** Whether the entity was present in the before / after version. */
  present: { before: boolean; after: boolean };
  changes: EntityFieldChange[];
}

interface CollectedField {
  group: string;
  field: string;
  value: string;
}

const GROUP_ORDER = new Map<string, number>([
  ["Attributes", 0],
  ["Placement", 1],
  ["Geometry", 2],
]);

/** Unambiguous map key for a (group, field) pair — printable, no collisions. */
function fieldKey(group: string, field: string): string {
  return JSON.stringify([group, field]);
}

function findEntityByGlobalId(
  doc: NativeIfcDocument,
  globalId: string,
): NativeIfcEntity | undefined {
  return doc.entities.find((entity) => entity.globalId === globalId);
}

function num(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/**
 * When the diffed entity is *itself* a property/quantity set (psets are rooted
 * and carry a GlobalId, so they appear in the manifest), its values live as
 * child entities rather than under `propertySetsByEntity` (which keys on the
 * owning product). Find the indexed set by its own entity id so a changed
 * property value surfaces on the pset that the manifest diff flagged.
 */
function findOwnSet(
  doc: NativeIfcDocument,
  entityId: number,
): NativeIfcPropertySet | undefined {
  for (const sets of doc.propertySetsByEntity.values()) {
    for (const set of sets) {
      if (set.id === entityId) {
        return set;
      }
    }
  }
  return undefined;
}

/** Flat, comparable view of an entity's meaningful fields, keyed by group+field. */
function collectFields(
  doc: NativeIfcDocument,
  entity: NativeIfcEntity,
): Map<string, CollectedField> {
  const fields = new Map<string, CollectedField>();
  const put = (group: string, field: string, value: string | undefined) => {
    if (value === undefined || value === "") {
      return;
    }
    fields.set(fieldKey(group, field), { group, field, value });
  };

  put("Attributes", "Type", entity.type);
  put("Attributes", "Name", entity.name);
  put("Attributes", "Description", entity.description);

  const placement = getNativePlacement(doc, entity.id);
  if (placement) {
    put("Placement", "X", num(placement.x));
    put("Placement", "Y", num(placement.y));
    put("Placement", "Z", num(placement.z));
  }

  const body = getNativeBodyRepresentation(doc, entity.id);
  if (body.hasRepresentation) {
    put("Geometry", "Profile", body.profile ?? body.profileType);
    put("Geometry", "Width", num(body.width));
    put("Geometry", "Depth", num(body.depth));
    put("Geometry", "Height", num(body.height));
    put("Geometry", "Radius", num(body.radius));
  }

  for (const set of doc.propertySetsByEntity.get(entity.id) ?? []) {
    for (const value of set.values) {
      put(set.name, value.name, value.value);
    }
  }

  const ownSet = findOwnSet(doc, entity.id);
  if (ownSet) {
    const group = ownSet.kind === "Qto" ? "Quantities" : "Properties";
    for (const value of ownSet.values) {
      put(group, value.name, value.value);
    }
  }

  return fields;
}

function compareFields(
  a: { group: string; field: string },
  b: { group: string; field: string },
): number {
  const orderA = GROUP_ORDER.get(a.group) ?? 100;
  const orderB = GROUP_ORDER.get(b.group) ?? 100;
  return (
    orderA - orderB ||
    a.group.localeCompare(b.group) ||
    a.field.localeCompare(b.field)
  );
}

/**
 * Diffs a single GlobalId across two parsed documents (either may be null when
 * the version is the empty parent of the first commit). Returns the ordered set
 * of field-level changes plus presence flags.
 */
export function diffEntityFields(
  before: NativeIfcDocument | null,
  after: NativeIfcDocument | null,
  globalId: string,
): EntityFieldDiff {
  const beforeEntity = before
    ? findEntityByGlobalId(before, globalId)
    : undefined;
  const afterEntity = after ? findEntityByGlobalId(after, globalId) : undefined;

  const beforeFields =
    before && beforeEntity
      ? collectFields(before, beforeEntity)
      : new Map<string, CollectedField>();
  const afterFields =
    after && afterEntity
      ? collectFields(after, afterEntity)
      : new Map<string, CollectedField>();

  const changes: EntityFieldChange[] = [];
  const keys = new Set<string>([...beforeFields.keys(), ...afterFields.keys()]);

  for (const key of keys) {
    const b = beforeFields.get(key);
    const a = afterFields.get(key);
    if (b && a) {
      if (b.value !== a.value) {
        changes.push({
          group: a.group,
          field: a.field,
          before: b.value,
          after: a.value,
          status: "modified",
        });
      }
    } else if (a) {
      changes.push({
        group: a.group,
        field: a.field,
        before: null,
        after: a.value,
        status: "added",
      });
    } else if (b) {
      changes.push({
        group: b.group,
        field: b.field,
        before: b.value,
        after: null,
        status: "removed",
      });
    }
  }

  changes.sort(compareFields);

  return {
    globalId,
    type: (afterEntity ?? beforeEntity)?.type ?? null,
    name: (afterEntity ?? beforeEntity)?.name ?? null,
    present: { before: Boolean(beforeEntity), after: Boolean(afterEntity) },
    changes,
  };
}
