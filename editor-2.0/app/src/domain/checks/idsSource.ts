/**
 * Prüfquelle „IDS" (M5) — buildingSMART-Anforderungen gegen die Sitzung.
 * Genutzte Paket-APIs (@ifc-lite/ids 1.15.34): `parseIDS`, `validateIDS`,
 * `createTranslationService("de")` und `createDataAccessor` aus
 * `@ifc-lite/ids/bridge`. Letzterer nimmt unseren `IfcDataStore` direkt, kennt
 * aber nur den geparsten Stand; für Sitzungsänderungen wird er umhüllt
 * (`sessionAccessor`): gelöschte Objekte fallen heraus, Attribut- und
 * Property-Werte kommen aus `session.view` (Delta gegen die reine
 * Parser-Extraktion, damit Einheiten und geerbte Psets der Bridge für
 * Unverändertes erhalten bleiben). Registrierung: Dateiende.
 */
import {
  createTranslationService,
  parseIDS,
  validateIDS,
  type IDSConstraint,
  type IDSDocument,
  type IDSFacet,
  type IDSValidationReport,
  type IFCDataAccessor,
  type PropertySetInfo,
  type PropertyValueResult,
} from "@ifc-lite/ids";
import { createDataAccessor } from "@ifc-lite/ids/bridge";
import { extractPropertiesOnDemand } from "@ifc-lite/parser";
import { create } from "zustand";

import type { ModelSession } from "../../core/session";
import { registerCheckSource } from "./store";
import type { CheckFinding, CheckRunResult } from "./types";

export interface IdsEntry {
  id: string;
  /** Anzeigename: Dateiname oder Katalogklasse. */
  name: string;
  document: IDSDocument;
  specCount: number;
}

interface IdsDocumentsState {
  entries: IdsEntry[];
  error: string | null;
  /** IDS-XML einlesen; false + `error`, wenn das Dokument nicht parsbar ist. */
  addFromXml(name: string, xml: string): boolean;
  remove(id: string): void;
  clear(): void;
}

let nextId = 1;

/**
 * Geladene IDS-Dokumente — wie der Objektkatalog app-weit und nicht je
 * Dokument: dieselbe Anforderungsliste wird gegen mehrere Modelle geprüft.
 */
export const useIdsDocuments = create<IdsDocumentsState>((set) => ({
  entries: [],
  error: null,
  addFromXml(name, xml) {
    try {
      const document = parseIDS(xml);
      const id = `ids-${nextId++}`;
      const specCount = document.specifications.length;
      const entry: IdsEntry = { id, name, document, specCount };
      set((state) => ({ entries: [...state.entries, entry], error: null }));
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      set({ error: `„${name}" ist kein gültiges IDS-Dokument: ${reason}` });
      return false;
    }
  },
  remove(id) {
    set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
  },
  clear() {
    set({ entries: [], error: null });
  },
}));

// — Sitzungs-Accessor: `undefined` als Delta-Wert = in der Sitzung gelöscht —
type DeltaValue = string | number | boolean | null | undefined;
type PropertyDelta = Map<string, Map<string, DeltaValue>>;

const EMPTY_DELTA: PropertyDelta = new Map();

/** Skalarer Wert für den Validator (Listenwerte werden zusammengefasst). */
function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object") return String(value);
  return value as string | number | boolean;
}
const sameValue = (a: unknown, b: unknown): boolean =>
  String(scalar(a) ?? "") === String(scalar(b) ?? "");

/** Datentyp für in der Sitzung neu angelegte Merkmale. */
const fallbackDataType = (value: unknown): string =>
  typeof value === "number"
    ? "IFCREAL"
    : typeof value === "boolean"
      ? "IFCBOOLEAN"
      : "IFCLABEL";

/** Unterschied zwischen reinem Parser-Stand und Sitzungsstand eines Objekts. */
function propertyDelta(session: ModelSession, expressId: number): PropertyDelta {
  const delta: PropertyDelta = new Map();
  const put = (pset: string, prop: string, value: DeltaValue): void => {
    delta.set(pset, (delta.get(pset) ?? new Map()).set(prop, value));
  };
  // Schlüssel: Pset + NUL + Merkmal (beide Namen dürfen Leerzeichen haben).
  const parsed = new Map<string, unknown>();
  for (const pset of extractPropertiesOnDemand(session.store, expressId))
    for (const p of pset.properties)
      parsed.set(`${pset.name}\u0000${p.name}`, p.value);
  const seen = new Set<string>();
  for (const pset of session.view.getForEntity(expressId)) {
    for (const p of pset.properties) {
      const key = `${pset.name}\u0000${p.name}`;
      seen.add(key);
      if (parsed.has(key) && sameValue(parsed.get(key), p.value)) continue;
      put(pset.name, p.name, scalar(p.value));
    }
  }
  for (const key of parsed.keys()) {
    if (seen.has(key)) continue;
    const [pset, prop] = key.split("\u0000");
    put(pset, prop, undefined);
  }
  return delta;
}

/** Basis-Psets der Bridge mit dem Sitzungs-Delta überlagern. */
function applyDelta(sets: readonly PropertySetInfo[], delta: PropertyDelta) {
  const byName = new Map<string, PropertySetInfo>(
    sets.map((set) => [set.name, { ...set, properties: [...set.properties] }]),
  );
  for (const [psetName, properties] of delta) {
    const set = byName.get(psetName) ?? { name: psetName, properties: [] };
    byName.set(psetName, set);
    for (const [name, value] of properties) {
      const dataType =
        set.properties.find((p) => p.name === name)?.dataType ??
        fallbackDataType(value);
      const rest = set.properties.filter((p) => p.name !== name);
      set.properties = value === undefined ? rest : [...rest, { name, value, dataType }];
    }
  }
  return [...byName.values()].filter((set) => set.properties.length > 0);
}

/**
 * Bridge-Accessor plus Sitzungs-Overlay. Der Bridge ruft intern seine eigenen
 * Methoden auf — das Overlay greift daher bei den Zugriffen des Validators,
 * nicht in dessen internen partOf-Aufstiegen.
 */
export function sessionAccessor(session: ModelSession): IFCDataAccessor {
  const base = createDataAccessor(session.store);
  const view = session.view;
  const alive = (id: number): boolean => !view.isDeleted(id);
  const deltas = new Map<number, PropertyDelta>();
  const deltaOf = (id: number): PropertyDelta => {
    const known = deltas.get(id);
    if (known) return known;
    const delta = view.hasChanges(id) ? propertyDelta(session, id) : EMPTY_DELTA;
    deltas.set(id, delta);
    return delta;
  };
  const attributeOf = (id: number, name: string): string | undefined =>
    view
      .getAttributeMutationsForEntity(id)
      .find((m) => m.name.toLowerCase() === name.toLowerCase())?.value;
  return {
    ...base,
    getAllEntityIds: () => base.getAllEntityIds().filter(alive),
    getEntitiesByType: (type) => base.getEntitiesByType(type).filter(alive),
    getEntityType: (id) =>
      view.getEntityTypeMutation(id)?.newType ?? base.getEntityType(id),
    getEntityName: (id) => attributeOf(id, "Name") ?? base.getEntityName(id),
    getDescription: (id) =>
      attributeOf(id, "Description") ?? base.getDescription(id),
    getAttribute: (id, name) => attributeOf(id, name) ?? base.getAttribute(id, name),
    getPropertySets: (id) => applyDelta(base.getPropertySets(id), deltaOf(id)),
    getPropertyValue: (id, pset, prop): PropertyValueResult | undefined => {
      const overlay = deltaOf(id).get(pset);
      const fromBase = base.getPropertyValue(id, pset, prop);
      if (!overlay?.has(prop)) return fromBase;
      const value = overlay.get(prop);
      if (value === undefined) return undefined;
      const dataType = fromBase?.dataType ?? fallbackDataType(value);
      return { value, dataType, propertySetName: pset, propertyName: prop };
    },
  };
}

/** Kurzform einer Wertevorgabe (für den Anforderungstext). */
function constraintText(c: IDSConstraint | undefined): string {
  if (!c) return "beliebig";
  if (c.type === "simpleValue") return c.value;
  if (c.type === "pattern") return `Muster ${c.pattern}`;
  return c.type === "enumeration" ? c.values.join(" | ") : "Wertebereich";
}

/**
 * Kurzer deutscher Anforderungstext — der Übersetzer des Pakets liefert ganze
 * Sätze, die zu „<Spezifikation>: <Anforderung> nicht erfüllt" nicht passen.
 */
function requirementLabel(facet: IDSFacet): string {
  const c = constraintText;
  const suffix = (v?: IDSConstraint): string => (v ? ` = ${c(v)}` : "");
  switch (facet.type) {
    case "property":
      return `Eigenschaft ${c(facet.propertySet)}.${c(facet.baseName)}${suffix(facet.value)}`;
    case "attribute":
      return `Attribut ${c(facet.name)}${suffix(facet.value)}`;
    case "entity":
      return `Klasse ${c(facet.name)}`;
    case "classification":
      return `Klassifikation ${c(facet.value)}`;
    case "material":
      return `Material ${c(facet.value)}`;
    default:
      return `Zugehörigkeit ${facet.relation}`;
  }
}

const translator = createTranslationService("de");
function findingsOf(
  report: IDSValidationReport,
  documentName: string,
  docIndex: number,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const nextId = (kind: string, entityId: number): string =>
    `ids:${kind}:${entityId}:${docIndex}-${findings.length}`;
  for (const spec of report.specificationResults) {
    const specName = spec.specification.name || "Spezifikation";
    const cardinality = spec.cardinalityResult;
    if (cardinality && !cardinality.passed)
      findings.push({
        id: nextId("cardinality", 0),
        source: "ids",
        kind: "cardinality",
        severity: "error",
        message: `${specName}: geforderte Anzahl nicht erfüllt`,
        entityIds: [],
        detail: `${cardinality.message} · IDS: ${documentName}`,
      });
    for (const entity of spec.entityResults) {
      if (entity.passed) continue;
      for (const req of entity.requirementResults) {
        if (req.status !== "fail") continue;
        const detail = [
          req.failureReason,
          req.expectedValue && `Erwartet: ${req.expectedValue}`,
          req.actualValue && `Gefunden: ${req.actualValue}`,
          `IDS: ${documentName}`,
        ].filter(Boolean).join(" · ");
        findings.push({
          id: nextId(req.facetType, entity.expressId),
          source: "ids",
          kind: req.failure?.type ?? `${req.facetType}-failed`,
          // required/prohibited verletzt = Fehler, optional = Warnung.
          severity:
            req.requirement.optionality === "optional" ? "warning" : "error",
          message: `${specName}: ${requirementLabel(req.requirement.facet)} nicht erfüllt`,
          entityIds: [entity.expressId],
          detail,
        });
      }
    }
  }
  return findings;
}

/** Prüfquelle: alle geladenen IDS-Dokumente gegen die Sitzung. */
export async function runIdsChecks(session: ModelSession): Promise<CheckRunResult> {
  const started = Date.now();
  const entries = useIdsDocuments.getState().entries;
  if (entries.length === 0)
    return { source: "ids", findings: [], durationMs: 0, checkedCount: 0 };
  const accessor = sessionAccessor(session);
  const modelInfo = {
    modelId: session.fileName,
    schemaVersion: session.store.schemaVersion ?? "IFC4",
    entityCount: session.store.entityCount,
  };
  const findings: CheckFinding[] = [];
  let checkedCount = 0;
  for (const [index, entry] of entries.entries()) {
    const report = await validateIDS(entry.document, accessor, modelInfo, {
      translator,
    });
    checkedCount += report.summary.totalEntitiesChecked;
    findings.push(...findingsOf(report, entry.name, index));
  }
  return { source: "ids", findings, durationMs: Date.now() - started, checkedCount };
}

registerCheckSource("ids", runIdsChecks);
