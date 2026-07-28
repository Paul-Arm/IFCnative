/**
 * Prüfquelle „IDS" (M5) — buildingSMART-Anforderungen gegen die Sitzung.
 *
 * Real genutzte Paket-APIs (@ifc-lite/ids 1.15.34):
 *  - `parseIDS(xml)` → IDSDocument, `validateIDS(doc, accessor, modelInfo,
 *    { translator })` → IDSValidationReport, `createTranslationService("de")`
 *  - `createDataAccessor(store)` aus `@ifc-lite/ids/bridge` → IFCDataAccessor
 *
 * Der Bridge-Accessor nimmt unseren `IfcDataStore` direkt, kennt aber nur den
 * geparsten Stand. Für Sitzungsänderungen wird er umhüllt (`sessionAccessor`):
 * gelöschte Objekte fallen heraus, Attribut- und Property-Werte kommen aus
 * `session.view`. Der Delta entsteht gegen die reine Parser-Extraktion, damit
 * die Aufbereitung der Bridge (Einheiten, geerbte Psets) für Unverändertes
 * erhalten bleibt. Registrierung in der Quellen-Registry: Dateiende.
 */
import {
  createTranslationService,
  parseIDS,
  validateIDS,
  type IDSDocument,
  type IDSValidationReport,
  type IFCDataAccessor,
  type PropertyValueResult,
} from "@ifc-lite/ids";
import { createDataAccessor } from "@ifc-lite/ids/bridge";
import { extractPropertiesOnDemand } from "@ifc-lite/parser";
import { create } from "zustand";

import type { ModelSession } from "../../core/session";
import { registerCheckSource } from "./store";
import type { CheckFinding, CheckRunResult, CheckSeverity } from "./types";

export interface IdsEntry {
  id: string;
  /** Anzeigename (Dateiname oder Katalogklasse). */
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
      const entry: IdsEntry = {
        id: `ids-${nextId++}`,
        name,
        document,
        specCount: document.specifications.length,
      };
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

// — Sitzungs-Accessor —————————————————————————————————————————————

/** `undefined` = in der Sitzung gelöscht. */
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
function fallbackDataType(value: unknown): string {
  if (typeof value === "number") return "IFCREAL";
  if (typeof value === "boolean") return "IFCBOOLEAN";
  return "IFCLABEL";
}

/** Unterschied zwischen reinem Parser-Stand und Sitzungsstand eines Objekts. */
function propertyDelta(session: ModelSession, expressId: number): PropertyDelta {
  const delta: PropertyDelta = new Map();
  const put = (pset: string, prop: string, value: DeltaValue): void => {
    const entry = delta.get(pset) ?? new Map<string, DeltaValue>();
    delta.set(pset, entry.set(prop, value));
  };
  // Schlüssel: Pset + NUL + Merkmal. Beide Namen dürfen Leerzeichen
  // enthalten, ein NUL-Zeichen kommt in keinem von beiden vor.
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

/**
 * Bridge-Accessor plus Sitzungs-Overlay. Der Bridge ruft intern seine eigenen
 * Methoden auf — das Overlay greift daher bei den Zugriffen des Validators,
 * nicht in den internen partOf-Aufstiegen des Bridges.
 */
export function sessionAccessor(session: ModelSession): IFCDataAccessor {
  const base = createDataAccessor(session.store);
  const view = session.view;
  const alive = (id: number): boolean => !view.isDeleted(id);
  const deltas = new Map<number, PropertyDelta>();
  const deltaOf = (id: number): PropertyDelta => {
    if (!view.hasChanges(id)) return EMPTY_DELTA;
    const cached = deltas.get(id) ?? propertyDelta(session, id);
    deltas.set(id, cached);
    return cached;
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
    getPropertySets: (id) => {
      const delta = deltaOf(id);
      const sets = base.getPropertySets(id).map((set) => ({
        ...set,
        properties: [...set.properties],
      }));
      for (const [psetName, properties] of delta) {
        let set = sets.find((candidate) => candidate.name === psetName);
        if (!set) {
          set = { name: psetName, properties: [] };
          sets.push(set);
        }
        for (const [propName, value] of properties) {
          const index = set.properties.findIndex((p) => p.name === propName);
          if (value === undefined) {
            if (index >= 0) set.properties.splice(index, 1);
            continue;
          }
          const dataType =
            index >= 0 ? set.properties[index].dataType : fallbackDataType(value);
          const next = { name: propName, value, dataType };
          if (index >= 0) set.properties[index] = next;
          else set.properties.push(next);
        }
      }
      return sets.filter((set) => set.properties.length > 0);
    },
    getPropertyValue: (id, psetName, propName): PropertyValueResult | undefined => {
      const overlay = deltaOf(id).get(psetName);
      if (!overlay || !overlay.has(propName))
        return base.getPropertyValue(id, psetName, propName);
      const value = overlay.get(propName);
      if (value === undefined) return undefined;
      const dataType =
        base.getPropertyValue(id, psetName, propName)?.dataType ??
        fallbackDataType(value);
      return { value, dataType, propertySetName: psetName, propertyName: propName };
    },
  };
}

// — Bericht → Befunde —————————————————————————————————————————————

const SEVERITY_BY_OPTIONALITY: Record<string, CheckSeverity> = {
  required: "error",
  prohibited: "error",
  optional: "warning",
};

const translator = createTranslationService("de");
function findingsOf(
  report: IDSValidationReport,
  documentName: string,
  counter: { n: number },
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const spec of report.specificationResults) {
    const specName = spec.specification.name || "Spezifikation";
    const cardinality = spec.cardinalityResult;
    if (cardinality && !cardinality.passed) {
      findings.push({
        id: `ids:cardinality:0:${counter.n++}`,
        source: "ids",
        kind: "cardinality",
        severity: "error",
        message: `${specName}: geforderte Anzahl nicht erfüllt`,
        entityIds: [],
        detail: `${cardinality.message} · IDS: ${documentName}`,
      });
    }
    for (const entity of spec.entityResults) {
      if (entity.passed) continue;
      for (const req of entity.requirementResults) {
        if (req.status !== "fail") continue;
        const label =
          translator.describeRequirement(req.requirement) || req.checkedDescription;
        const detail = [
          req.failureReason,
          req.expectedValue ? `Erwartet: ${req.expectedValue}` : "",
          req.actualValue ? `Gefunden: ${req.actualValue}` : "",
          `IDS: ${documentName}`,
        ]
          .filter(Boolean)
          .join(" · ");
        findings.push({
          id: `ids:${req.facetType}:${entity.expressId}:${counter.n++}`,
          source: "ids",
          kind: req.failure?.type ?? `${req.facetType}-failed`,
          severity:
            SEVERITY_BY_OPTIONALITY[req.requirement.optionality] ?? "warning",
          message: `${specName}: ${label} nicht erfüllt`,
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
  if (entries.length === 0) {
    return { source: "ids", findings: [], durationMs: 0, checkedCount: 0 };
  }
  const accessor = sessionAccessor(session);
  const modelInfo = {
    modelId: session.fileName,
    schemaVersion: session.store.schemaVersion ?? "IFC4",
    entityCount: session.store.entityCount,
  };
  const counter = { n: 0 };
  const findings: CheckFinding[] = [];
  let checkedCount = 0;
  for (const entry of entries) {
    const options = { translator };
    const report = await validateIDS(entry.document, accessor, modelInfo, options);
    checkedCount += report.summary.totalEntitiesChecked;
    findings.push(...findingsOf(report, entry.name, counter));
  }
  return { source: "ids", findings, durationMs: Date.now() - started, checkedCount };
}

registerCheckSource("ids", runIdsChecks);
