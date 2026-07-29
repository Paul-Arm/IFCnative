/**
 * Ressourcen-Emitter (M9): schreibt Material-, Klassifikations-, Dokument-,
 * Gruppen- und Typ-Records über `session.editor().addEntity` in das
 * Mutations-Overlay (Muster `domain/geometry/records.ts`).
 *
 * Jede emit*-Funktion sammelt die erzeugten `NewEntity`-Records in `out` —
 * die Commands sichern sie fürs Undo (Records rückwärts entfernen) und Redo
 * (`restoreNewEntity` hält die expressIds stabil, Muster cmdCreateRelation).
 *
 * Argument-Layouts folgen IFC4 (wie der 1.x-Writer in
 * src/ifc/nativeDocument.ts, der ebenfalls schemaunabhängig IFC4-Arity
 * schreibt); der StepExporter serialisiert die Listen positional.
 */
import type { IfcAttributeValue, NewEntity } from "@ifc-lite/mutations";
import { EntityExtractor } from "@ifc-lite/parser";
import type { ModelSession } from "../../core/session";

export type StepValue = IfcAttributeValue;

/** `.TOKEN.` — Enum-Werte reicht der Exporter unverändert durch. */
export const enumOf = (value: string): string => `.${value.toUpperCase()}.`;

/** expressIds → STEP-Referenzliste (`["#4","#7"]`). */
export const stepRefs = (ids: readonly number[]): StepValue[] =>
  ids.map((id) => `#${id}`);

/** Quotes einer STEP-Stringlesung entfernen (EntityExtractor liefert roh). */
export function attrText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "$" || trimmed === "*") return "";
  return trimmed.replace(/^'/, "").replace(/'$/, "");
}

/** Quellzeilen-Attribute eines geparsten Records (null für Overlay-Ids). */
export function sourceAttributes(
  session: ModelSession,
  expressId: number,
): StepValue[] | null {
  const ref = session.store.entityIndex.byId.get(expressId);
  if (!ref) return null;
  const entity = new EntityExtractor(session.store.source).extractEntity(ref);
  return entity ? (entity.attributes as StepValue[]) : null;
}

/** Record anlegen, NewEntity für Undo/Redo sichern, expressId zurückgeben. */
export function addRecord(
  session: ModelSession,
  out: NewEntity[],
  entityName: string,
  attributes: StepValue[],
): number {
  const ref = session.editor().addEntity(entityName, attributes);
  const record = session.view.getNewEntity(ref.expressId);
  if (record) out.push(record);
  return ref.expressId;
}

// — Material ————————————————————————————————————————————————————————————

/** IfcMaterial(Name, Description, Category) — IFC4-Layout wie in 1.x. */
export function emitMaterial(
  session: ModelSession,
  out: NewEntity[],
  name: string,
  category = "",
): number {
  return addRecord(session, out, "IfcMaterial", [
    name.trim() || "Material",
    null,
    category.trim() || null,
  ]);
}

export interface LayerRow {
  materialName: string;
  /** Schichtdicke in Modelleinheiten */
  thickness: number;
  name?: string;
  category?: string;
}

export interface LayerUsageParams {
  setName: string;
  layers: readonly LayerRow[];
  /** IfcLayerSetDirectionEnum */
  direction: "AXIS1" | "AXIS2" | "AXIS3";
  /** IfcDirectionSenseEnum */
  sense: "POSITIVE" | "NEGATIVE";
  offset: number;
}

/**
 * IfcMaterial+IfcMaterialLayer je Zeile, IfcMaterialLayerSet und
 * IfcMaterialLayerSetUsage (Richtung/Richtungssinn/Offset). Gibt die
 * expressId der Usage zurück — sie ist die Relating-Seite der Zuordnung.
 */
export function emitLayerSetUsage(
  session: ModelSession,
  out: NewEntity[],
  params: LayerUsageParams,
): number {
  const layerIds = params.layers.map((row) => {
    const materialId = emitMaterial(
      session,
      out,
      row.materialName,
      row.category ?? "",
    );
    // IfcMaterialLayer(Material, LayerThickness, IsVentilated, Name,
    // Description, Category, Priority)
    return addRecord(session, out, "IfcMaterialLayer", [
      `#${materialId}`,
      { real: row.thickness },
      null,
      row.name?.trim() || null,
      null,
      row.category?.trim() || null,
      null,
    ]);
  });
  const setId = addRecord(session, out, "IfcMaterialLayerSet", [
    stepRefs(layerIds),
    params.setName.trim() || "Schichtaufbau",
    null,
  ]);
  return addRecord(session, out, "IfcMaterialLayerSetUsage", [
    `#${setId}`,
    enumOf(params.direction),
    enumOf(params.sense),
    { real: params.offset },
    null,
  ]);
}

// — Klassifikation ————————————————————————————————————————————————————————

export interface ClassificationParams {
  /** Name des Klassifikationssystems (IfcClassification.Name), z. B. „DIN 276" */
  system: string;
  identification: string;
  name: string;
  location?: string;
  edition?: string;
}

/**
 * Vorhandene IfcClassification mit diesem Systemnamen suchen — zuerst im
 * Overlay (frühere M9-Anlagen), dann in den Quellzeilen. Name steht in IFC4
 * wie in IFC2X3 an Position 3.
 */
export function findClassification(
  session: ModelSession,
  system: string,
): number | null {
  const wanted = system.trim();
  if (!wanted) return null;
  for (const entity of session.view.getNewEntities()) {
    if (entity.type.toUpperCase() !== "IFCCLASSIFICATION") continue;
    if (attrText(entity.attributes[3]) === wanted) return entity.expressId;
  }
  for (const id of session.store.entityIndex.byType.get("IFCCLASSIFICATION") ??
    []) {
    if (session.view.isDeleted(id)) continue;
    if (attrText(sourceAttributes(session, id)?.[3]) === wanted) return id;
  }
  return null;
}

/**
 * IfcClassification (einmalig je Quelle, siehe `findClassification`) +
 * IfcClassificationReference. Gibt die expressId der Referenz zurück.
 */
export function emitClassificationReference(
  session: ModelSession,
  out: NewEntity[],
  params: ClassificationParams,
): number {
  const system = params.system.trim() || "Klassifikation";
  const classificationId =
    findClassification(session, system) ??
    // IfcClassification(Source, Edition, EditionDate, Name, Description,
    // Location, ReferenceTokens)
    addRecord(session, out, "IfcClassification", [
      null,
      params.edition?.trim() || null,
      null,
      system,
      null,
      null,
      null,
    ]);
  // IfcClassificationReference(Location, Identification, Name,
  // ReferencedSource, Description, Sort)
  return addRecord(session, out, "IfcClassificationReference", [
    params.location?.trim() || null,
    params.identification.trim(),
    params.name.trim() || params.identification.trim(),
    `#${classificationId}`,
    null,
    null,
  ]);
}

// — Dokument ————————————————————————————————————————————————————————————

export interface DocumentParams {
  identification: string;
  name: string;
  location?: string;
  description?: string;
}

/**
 * IfcDocumentInformation (17 IFC4-Attribute) + IfcDocumentReference mit
 * ReferencedDocument-Verweis. Gibt die expressId der Referenz zurück.
 */
export function emitDocumentReference(
  session: ModelSession,
  out: NewEntity[],
  params: DocumentParams,
): number {
  const name = params.name.trim() || "Dokument";
  const identification = params.identification.trim() || name;
  const infoId = addRecord(session, out, "IfcDocumentInformation", [
    identification,
    name,
    params.description?.trim() || null,
    params.location?.trim() || null,
    ...Array.from({ length: 13 }, () => null),
  ]);
  // IfcDocumentReference(Location, Identification, Name, Description,
  // ReferencedDocument)
  return addRecord(session, out, "IfcDocumentReference", [
    params.location?.trim() || null,
    identification,
    name,
    null,
    `#${infoId}`,
  ]);
}

