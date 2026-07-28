/**
 * Prüfquelle „Modell-Diagnostik" (M6).
 *
 * Portiert die Diagnostik-Semantik von 1.x (`src/ifc/nativeDocument.ts`,
 * Abschnitt `validateNativeDocument` / `validatePhysicalProducts`) auf den
 * `IfcDataStore` der Sitzung. Geprüft wird ausschließlich lesend:
 *
 *  1. genau ein IFCPROJECT,
 *  2. Einheitenzuweisung (IFCUNITASSIGNMENT) vorhanden, eindeutig und vom
 *     Projekt referenziert (UnitsInContext),
 *  3. doppelt vergebene GlobalIds,
 *  4. physische Produkte ohne ObjectPlacement bzw. ohne Representation,
 *  5. Bauteile ohne räumliche Zuordnung (weder Parser-Containment noch
 *     Sitzungs-Overlay).
 *
 * Sitzungszustand zählt: tombstonete Objekte (`session.isDeleted`) fallen
 * überall heraus, Attribute werden in der Reihenfolge Overlay-Entity →
 * positionale Mutation → Quellzeile gelesen (Muster aus
 * `src/core/model/relationMembers.ts`).
 */
import { EntityExtractor, type IfcDataStore } from "@ifc-lite/parser";
import { RelationshipType } from "@ifc-lite/data";
import type { IfcAttributeValue, MutablePropertyView } from "@ifc-lite/mutations";
import type { ModelSession } from "../../../core/session";
import { storeyOf } from "../../../core/model/spatial";
import type { CheckRunResult } from "../types";
import { CONTAINMENT_EXEMPT, PHYSICAL_PRODUCTS } from "./productTypes";
import { FindingCollector } from "./shared";

/** Positionale Attribut-Indizes von IfcProduct bzw. IfcProject. */
const OBJECT_PLACEMENT_INDEX = 5;
const REPRESENTATION_INDEX = 6;
const PROJECT_UNITS_INDEX = 8;

/** Attribut gilt als gesetzt, wenn es weder fehlt noch `$` ist. */
function isSet(value: IfcAttributeValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== "$";
  }
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Attributliste eines Objekts: Overlay-Entity zuerst, sonst Quellzeile mit
 * eingemischten positionalen Mutationen.
 */
function attributesOf(
  store: IfcDataStore,
  view: MutablePropertyView,
  extractor: EntityExtractor,
  expressId: number,
): IfcAttributeValue[] | null {
  const overlay = view.getNewEntity(expressId);
  if (overlay) return overlay.attributes;
  const ref = store.entityIndex.byId.get(expressId);
  if (!ref) return null;
  const entity = extractor.extractEntity(ref);
  if (!entity) return null;
  const patched = view.getPositionalMutationsForEntity(expressId);
  if (!patched) return entity.attributes;
  const merged = [...entity.attributes];
  for (const [index, value] of patched) merged[index] = value;
  return merged;
}

/** Nicht gelöschte expressIds einer STEP-Klasse. */
function liveIdsOfType(session: ModelSession, type: string): number[] {
  return (session.store.entityIndex.byType.get(type) ?? []).filter(
    (id) => !session.isDeleted(id),
  );
}

/** Ziele aller Overlay-Containments (`ContainsElements`) der Sitzung. */
function overlayContained(session: ModelSession): Set<number> {
  const ids = new Set<number>();
  for (const relation of session.relationOverlay.all()) {
    if (relation.relType !== RelationshipType.ContainsElements) continue;
    for (const id of relation.targetIds) ids.add(id);
  }
  return ids;
}

function checkProjectAndUnits(
  session: ModelSession,
  collector: FindingCollector,
  extractor: EntityExtractor,
): void {
  const projects = liveIdsOfType(session, "IFCPROJECT");
  if (projects.length === 0) {
    collector.add({
      kind: "missing-project",
      severity: "error",
      message: "Das Modell enthält kein IFCPROJECT.",
      entityIds: [],
    });
  } else if (projects.length > 1) {
    collector.add({
      kind: "multiple-projects",
      severity: "error",
      message: `Das Modell enthält ${projects.length} IFCPROJECT-Instanzen; zulässig ist genau eine.`,
      entityIds: projects,
      detail: projects.map((id) => `#${id}`).join(", "),
    });
  }

  const units = liveIdsOfType(session, "IFCUNITASSIGNMENT");
  if (units.length === 0) {
    collector.add({
      kind: "missing-unit-assignment",
      severity: "warning",
      message:
        "Dem Modell fehlt eine Einheitenzuweisung (IFCUNITASSIGNMENT); Maßangaben sind nicht eindeutig interpretierbar.",
      entityIds: projects.slice(0, 1),
    });
  } else if (units.length > 1) {
    collector.add({
      kind: "multiple-unit-assignments",
      severity: "warning",
      message: `Das Modell enthält ${units.length} Einheitenzuweisungen (IFCUNITASSIGNMENT).`,
      entityIds: units,
      detail: units.map((id) => `#${id}`).join(", "),
    });
  }

  if (projects.length === 0 || units.length === 0) return;
  const attributes = attributesOf(
    session.store,
    session.view,
    extractor,
    projects[0],
  );
  const unitsInContext = attributes?.[PROJECT_UNITS_INDEX];
  if (!isSet(unitsInContext)) {
    collector.add({
      kind: "project-without-units",
      severity: "warning",
      message: `${session.labelOf(projects[0])} verweist in UnitsInContext auf keine Einheitenzuweisung.`,
      entityIds: [projects[0]],
    });
  }
}

function checkGlobalIds(
  session: ModelSession,
  collector: FindingCollector,
): number {
  const store = session.store;
  const owners = new Map<string, number[]>();
  let scanned = 0;
  for (const expressId of store.entityIndex.byId.keys()) {
    if (session.isDeleted(expressId)) continue;
    scanned++;
    let globalId = "";
    try {
      globalId = store.entities.getGlobalId(expressId);
    } catch {
      continue;
    }
    if (!globalId || globalId === "$") continue;
    const list = owners.get(globalId);
    if (list) list.push(expressId);
    else owners.set(globalId, [expressId]);
  }

  // Das GlobalId-Register des Stores ist eine 1:1-Abbildung — bei einer
  // Kollision gewinnt genau ein Objekt, alle Verweise (BCF, IDS, Auswahl über
  // GUID) laufen dann auf dieses eine. Genau deshalb wird die Kollision hier
  // aus der vollständigen Id-Liste ermittelt und das Register nur zitiert.
  let registry: Map<string, number> | null = null;
  try {
    registry = store.entities.getGlobalIdMap();
  } catch {
    registry = null;
  }

  for (const [globalId, ids] of owners) {
    if (ids.length < 2) continue;
    const winner = registry?.get(globalId);
    collector.add({
      kind: "duplicate-global-id",
      severity: "error",
      message: `Die GlobalId ${globalId} ist ${ids.length}-fach vergeben: ${ids
        .map((id) => `#${id}`)
        .join(", ")}.`,
      entityIds: ids,
      detail:
        winner === undefined
          ? undefined
          : `GlobalId-Register verweist auf #${winner}`,
    });
  }
  return scanned;
}

function checkProducts(
  session: ModelSession,
  collector: FindingCollector,
  extractor: EntityExtractor,
): number {
  const contained = overlayContained(session);
  let checked = 0;
  for (const [type, ids] of session.store.entityIndex.byType) {
    const upper = type.toUpperCase();
    if (!PHYSICAL_PRODUCTS.has(upper)) continue;
    for (const expressId of ids) {
      if (session.isDeleted(expressId)) continue;
      checked++;
      const attributes = attributesOf(
        session.store,
        session.view,
        extractor,
        expressId,
      );
      if (attributes) {
        if (!isSet(attributes[OBJECT_PLACEMENT_INDEX])) {
          collector.add({
            kind: "missing-placement",
            severity: "warning",
            message: `${session.labelOf(expressId)} hat keine Platzierung (ObjectPlacement).`,
            entityIds: [expressId],
          });
        }
        if (!isSet(attributes[REPRESENTATION_INDEX])) {
          collector.add({
            kind: "missing-representation",
            severity: "warning",
            message: `${session.labelOf(expressId)} hat keine Geometrie-Repräsentation (Representation).`,
            entityIds: [expressId],
          });
        }
      }
      if (CONTAINMENT_EXEMPT.has(upper)) continue;
      if (storeyOf(session.store, expressId) !== null) continue;
      if (contained.has(expressId)) continue;
      collector.add({
        kind: "missing-containment",
        severity: "warning",
        message: `${session.labelOf(expressId)} ist keiner räumlichen Struktur zugeordnet.`,
        entityIds: [expressId],
        detail: "weder IfcRelContainedInSpatialStructure noch Sitzungs-Overlay",
      });
    }
  }
  return checked;
}

/** Modell-Diagnostik über die aktuelle Sitzung ausführen. */
export async function run(session: ModelSession): Promise<CheckRunResult> {
  const collector = new FindingCollector("diagnostics");
  const extractor = new EntityExtractor(session.store.source);
  checkProjectAndUnits(session, collector, extractor);
  const scanned = checkGlobalIds(session, collector);
  checkProducts(session, collector, extractor);
  return collector.result(scanned);
}
