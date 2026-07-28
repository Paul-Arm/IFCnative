/**
 * Lese-Seite der Ressourcen (M9) für den Inspector-Modus „Ressourcen".
 *
 * Zwei Quellen je Abschnitt, weil die On-Demand-Extraktoren des Parsers
 * (extractMaterialsOnDemand etc.) den STATISCHEN CSR/Quellpuffer lesen und
 * Zuordnungen aus dieser Sitzung nicht kennen:
 *   1. die geparsten Daten (extract*OnDemand), Origin „parsed",
 *   2. die Overlay-Kanten aus `session.relationsOf` (das RelationOverlay
 *      liefert sie bereits mit `origin: "overlay"`), deren Ressourcen-Records
 *      als NewEntity im Mutations-Overlay liegen.
 * Erst nach Export + Reparse wandern die Overlay-Zeilen in die Parsed-Spur.
 */
import {
  extractAllMaterialsOnDemand,
  extractClassificationsOnDemand,
  extractDocumentsOnDemand,
} from "@ifc-lite/parser";
import { RelationshipType } from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";
import { attrText, sourceAttributes, type StepValue } from "./emit";

export interface ResourceEntry {
  /** expressId der Ressource; 0 für rein extrahierte Zeilen ohne Record-Id */
  id: number;
  label: string;
  detail: string;
  origin: "parsed" | "overlay";
}

/** Positionsindex des Namens je Ressourcenklasse (IFC4 == IFC2X3, wo genutzt). */
const NAME_INDEX: Record<string, number> = {
  IFCMATERIAL: 0,
  IFCMATERIALLAYERSET: 1,
  IFCCLASSIFICATION: 3,
  IFCCLASSIFICATIONREFERENCE: 2,
  IFCDOCUMENTREFERENCE: 2,
  IFCDOCUMENTINFORMATION: 1,
};

/** Attribute eines Records — Overlay zuerst, sonst Quellzeile. */
function attributesOf(
  session: ModelSession,
  expressId: number,
): { type: string; attributes: StepValue[] } | null {
  const overlay = session.view.getNewEntity(expressId);
  if (overlay) {
    return { type: overlay.type.toUpperCase(), attributes: overlay.attributes };
  }
  const ref = session.store.entityIndex.byId.get(expressId);
  if (!ref) return null;
  const attributes = sourceAttributes(session, expressId);
  return attributes ? { type: ref.type.toUpperCase(), attributes } : null;
}

/** `#42` oder 42 → 42, sonst null. */
function refId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^#\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim().slice(1), 10);
  }
  return null;
}

/**
 * Anzeigename einer Ressource (Material, Referenz, Gruppe, Typ …) — auch für
 * Overlay-Records, für die `store.entities.getName` nichts liefert.
 * LayerSetUsages werden über ihr ForLayerSet aufgelöst.
 */
export function resourceLabelOf(session: ModelSession, expressId: number): string {
  const record = attributesOf(session, expressId);
  if (!record) return session.labelOf(expressId);
  if (record.type === "IFCMATERIALLAYERSETUSAGE") {
    const setId = refId(record.attributes[0]);
    return setId !== null
      ? `${resourceLabelOf(session, setId)} (Usage)`
      : "Schichtaufbau (Usage)";
  }
  const index = NAME_INDEX[record.type] ?? 2; // IfcRoot.Name
  const name = attrText(record.attributes[index]);
  return name || session.labelOf(expressId) || `#${expressId}`;
}

/** Overlay-Kanten einer Beziehungsart, Gegenseite = Ressource. */
function overlayRows(
  session: ModelSession,
  expressId: number,
  relType: RelationshipType,
  detail: (resourceId: number) => string,
): ResourceEntry[] {
  return session
    .relationsOf(expressId)
    .filter((row) => row.relType === relType && row.origin === "overlay")
    .map((row) => ({
      id: row.otherId,
      label: resourceLabelOf(session, row.otherId),
      detail: detail(row.otherId),
      origin: "overlay" as const,
    }));
}

function typeNameOf(session: ModelSession, expressId: number): string {
  return attributesOf(session, expressId)?.type ?? "";
}

// — Abschnitte ————————————————————————————————————————————————————————————

export function readMaterialRows(
  session: ModelSession,
  expressId: number,
): ResourceEntry[] {
  const parsed = extractAllMaterialsOnDemand(session.store, expressId).map(
    (info) => ({
      id: 0,
      label: info.name ?? info.type,
      detail:
        info.type === "MaterialLayerSet"
          ? `${info.layers?.length ?? 0} Schicht(en)`
          : info.category || info.type,
      origin: "parsed" as const,
    }),
  );
  return [
    ...parsed,
    ...overlayRows(session, expressId, RelationshipType.AssociatesMaterial, (id) =>
      typeNameOf(session, id),
    ),
  ];
}

export function readClassificationRows(
  session: ModelSession,
  expressId: number,
): ResourceEntry[] {
  const parsed = extractClassificationsOnDemand(session.store, expressId).map(
    (info) => ({
      id: 0,
      label: [info.identification, info.name].filter(Boolean).join(" · "),
      detail: info.system ?? "",
      origin: "parsed" as const,
    }),
  );
  const overlay = overlayRows(
    session,
    expressId,
    RelationshipType.AssociatesClassification,
    (id) => {
      // System der Referenz über ReferencedSource (#IfcClassification) auflösen.
      const record = attributesOf(session, id);
      const sourceRef = record ? refId(record.attributes[3]) : null;
      return sourceRef !== null ? resourceLabelOf(session, sourceRef) : "";
    },
  );
  return [...parsed, ...overlay];
}

export function readDocumentRows(
  session: ModelSession,
  expressId: number,
): ResourceEntry[] {
  const parsed = extractDocumentsOnDemand(session.store, expressId).map(
    (info) => ({
      id: 0,
      label: [info.identification, info.name].filter(Boolean).join(" · "),
      detail: info.location ?? "",
      origin: "parsed" as const,
    }),
  );
  const overlay = overlayRows(
    session,
    expressId,
    RelationshipType.AssociatesDocument,
    (id) => attrText(attributesOf(session, id)?.attributes[0]), // Location
  );
  return [...parsed, ...overlay];
}

/** Gruppen/Zonen/Systeme — geparste UND Overlay-Kanten aus relationsOf. */
export function readGroupRows(
  session: ModelSession,
  expressId: number,
): ResourceEntry[] {
  return session
    .relationsOf(expressId)
    .filter(
      (row) =>
        row.relType === RelationshipType.AssignsToGroup &&
        row.direction === "inverse",
    )
    .map((row) => ({
      id: row.otherId,
      label: row.otherName || resourceLabelOf(session, row.otherId),
      detail: row.otherType || typeNameOf(session, row.otherId),
      origin: row.origin,
    }));
}

/** Typzuweisungen des Objekts (Objekt steht auf der Related-Seite). */
export function readTypeRows(
  session: ModelSession,
  expressId: number,
): ResourceEntry[] {
  return session
    .relationsOf(expressId)
    .filter(
      (row) =>
        row.relType === RelationshipType.DefinesByType &&
        row.direction === "inverse",
    )
    .map((row) => ({
      id: row.otherId,
      label: row.otherName || resourceLabelOf(session, row.otherId),
      detail: row.otherType || typeNameOf(session, row.otherId),
      origin: row.origin,
    }));
}

// — Einheiten (modellweit) ————————————————————————————————————————————————

export interface UnitAssignmentView {
  assignmentId: number;
  /** aktuelle Units-Liste als STEP-Tokens (inkl. positionaler Mutation) */
  tokens: StepValue[];
}

/** IfcUnitAssignment samt aktueller Units-Liste; null ohne Projekt-Einheiten. */
export function unitAssignmentOf(
  session: ModelSession,
): UnitAssignmentView | null {
  const assignmentId =
    session.store.entityIndex.byType.get("IFCUNITASSIGNMENT")?.[0];
  if (assignmentId === undefined) return null;
  const patched = session.view
    .getPositionalMutationsForEntity(assignmentId)
    ?.get(0);
  const raw =
    patched !== undefined ? patched : sourceAttributes(session, assignmentId)?.[0];
  const tokens = Array.isArray(raw) ? [...raw] : [];
  return { assignmentId, tokens };
}

/** Einheitenzeilen für die Anzeige (IfcSIUnit im Fokus, Rest generisch). */
export function readUnitRows(session: ModelSession): ResourceEntry[] {
  const assignment = unitAssignmentOf(session);
  if (!assignment) return [];
  const rows: ResourceEntry[] = [];
  for (const token of assignment.tokens) {
    const id = refId(token);
    if (id === null) continue;
    const record = attributesOf(session, id);
    const origin = session.view.getNewEntity(id) ? "overlay" : "parsed";
    if (!record) continue;
    if (record.type === "IFCSIUNIT") {
      const prefix = attrText(record.attributes[2]).replace(/\./g, "");
      const name = attrText(record.attributes[3]).replace(/\./g, "");
      rows.push({
        id,
        label: prefix ? `${prefix} ${name}` : name,
        detail: attrText(record.attributes[1]).replace(/\./g, ""),
        origin,
      });
    } else {
      const name = attrText(record.attributes[2]);
      rows.push({ id, label: name || record.type, detail: record.type, origin });
    }
  }
  return rows;
}

// — Auswahl-Optionen für „vorhandenes wählen" ————————————————————————————

export interface ResourceOption {
  id: number;
  label: string;
}

/** Vorhandene Ressourcen einer Klasse: Quellzeilen + Overlay-Records. */
export function existingResourceOptions(
  session: ModelSession,
  ifcClasses: readonly string[],
): ResourceOption[] {
  const wanted = new Set(ifcClasses.map((c) => c.toUpperCase()));
  const options: ResourceOption[] = [];
  for (const ifcClass of wanted) {
    for (const id of session.store.entityIndex.byType.get(ifcClass) ?? []) {
      if (session.view.isDeleted(id)) continue;
      options.push({ id, label: `${resourceLabelOf(session, id)} (#${id})` });
    }
  }
  for (const entity of session.view.getNewEntities()) {
    if (!wanted.has(entity.type.toUpperCase())) continue;
    options.push({
      id: entity.expressId,
      label: `${resourceLabelOf(session, entity.expressId)} (#${entity.expressId})`,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "de-DE"));
}
