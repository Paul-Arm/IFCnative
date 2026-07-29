import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";

export function matchesEntitySearch(entity: NativeIfcEntity, query: string) {
  const id = String(entity.id);
  return [
    id,
    `#${id}`,
    entity.type,
    entity.name,
    entity.globalId,
    entity.description,
  ].some((value) => value.toLowerCase().includes(query));
}

/** Lesbaren Wert einer einfachen Property/Quantity aus dem Entity ziehen. */
export function readSimplePropertyValueText(entity?: NativeIfcEntity) {
  if (!entity) {
    return "";
  }
  if (entity.type.startsWith("IFCQUANTITY")) {
    const raw = (entity.args[3] ?? "").trim();
    return raw === "$" ? "" : raw;
  }
  const raw = (entity.args[2] ?? "").trim();
  if (!raw || raw === "$") {
    return "";
  }
  const match = raw.match(/^[A-Za-z0-9_]+\(([\s\S]*)\)$/);
  const inner = match ? match[1].trim() : raw;
  if (/^\.[TF]\.$/i.test(inner)) {
    return inner.toUpperCase() === ".T." ? "True" : "False";
  }
  return inner.replace(/^'([\s\S]*)'$/, "$1");
}

export function findNextSelectionAfterEntityDelete(
  current: NativeIfcDocument,
  next: NativeIfcDocument,
  entityId: number,
) {
  const related = current.relationshipsByEntity.get(entityId) ?? [];
  const candidates = [
    ...related.flatMap((relationship) =>
      relationship.targetIds.includes(entityId) ? relationship.sourceIds : [],
    ),
    ...related.flatMap((relationship) => relationship.sourceIds),
    ...related.flatMap((relationship) => relationship.targetIds),
    next.spatialRoots[0]?.id,
    next.entities[0]?.id,
  ].filter(
    (candidate): candidate is number =>
      Number.isFinite(candidate) && candidate !== entityId,
  );

  return candidates.find((candidate) => next.entityById.has(candidate));
}

export function graphCopyName(name: string, type: string, index: number) {
  const baseName = name.trim() || type.replace(/^IFC/i, "");
  return `${baseName} Copy${index > 0 ? ` ${index + 1}` : ""}`;
}
