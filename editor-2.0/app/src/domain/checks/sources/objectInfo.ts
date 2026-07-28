/**
 * Prüfquelle „Objektinfo-IDs" (M6) — Portierung von
 * `/src/ifc/objectInfoValidation.ts` (1.x) auf die Sitzung von Editor 2.0.
 *
 * Fachlicher Kern unverändert: die Familie `ePset_Objektinformation` vergibt
 * je Objekt eine `_ID`; andere Properties derselben Familie verweisen über
 * ihren Namen (Endung „ID"/„IDs") auf solche IDs. Geprüft werden dieselben
 * acht Befundarten wie in 1.x.
 *
 * Zwei bewusste Abweichungen von 1.x, beide in den Tests abgedeckt:
 *  - Gelesen wird über `session.view.getForEntity` — Psets, die erst in der
 *    Sitzung entstanden sind (Overlay), zählen damit voll mit.
 *  - Referenz-Properties dürfen Semikolon-Listen führen (Konvention
 *    `_UntersuchungszielIDs`); jedes Listenelement wird einzeln aufgelöst.
 *    Deshalb greift die Namenskonvention hier auch für die Pluralform „IDs",
 *    die 1.x (`endsWith("id")`) noch nicht erfasst hat.
 *
 * Tombstonete Objekte werden übersprungen.
 */
import type { ModelSession } from "../../../core/session";
import type { CheckRunResult } from "../types";
import {
  isBlank,
  isIdProperty,
  isObjectInfoPset,
  isReferenceProperty,
  normalizeValue,
  splitIdList,
} from "./objectInfoValues";
import { FindingCollector } from "./shared";

interface IdDefinition {
  entityId: number;
  psetName: string;
  propertyName: string;
  value: string;
}

interface IdReference {
  entityId: number;
  psetName: string;
  propertyName: string;
  /** Einzelwert nach dem Aufsplitten der Semikolon-Liste */
  value: string;
  /** ursprünglicher Property-Wert (für die Detailspalte) */
  raw: string;
}

interface ObjectInfoIndex {
  definitions: IdDefinition[];
  definitionsByValue: Map<string, IdDefinition[]>;
  externalByValue: Map<string, IdDefinition[]>;
  references: IdReference[];
  /** ePset_Objektinformation-Sets ohne _ID-Property */
  setsWithoutId: Array<{ entityId: number; psetName: string }>;
  checkedCount: number;
}

function pushValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Objekte, die Psets tragen können: alles mit geparsten Psets plus alles, was
 * in dieser Sitzung Property-Mutationen erhalten hat (dort entstehen die
 * Overlay-Psets). Das vermeidet einen `getForEntity`-Aufruf je Modell-Entity.
 */
function candidateEntities(session: ModelSession): number[] {
  const ids = new Set<number>(session.store.onDemandPropertyMap?.keys() ?? []);
  for (const mutation of session.view.getMutations()) {
    if (mutation.psetName) ids.add(mutation.entityId);
  }
  return [...ids].filter((id) => !session.isDeleted(id));
}

function buildIndex(session: ModelSession): ObjectInfoIndex {
  const index: ObjectInfoIndex = {
    definitions: [],
    definitionsByValue: new Map(),
    externalByValue: new Map(),
    references: [],
    setsWithoutId: [],
    checkedCount: 0,
  };

  for (const entityId of candidateEntities(session)) {
    index.checkedCount++;
    for (const pset of session.view.getForEntity(entityId)) {
      const objectInfo = isObjectInfoPset(pset.name);
      if (objectInfo && !pset.properties.some((p) => isIdProperty(p.name))) {
        index.setsWithoutId.push({ entityId, psetName: pset.name });
      }
      for (const property of pset.properties) {
        const value = normalizeValue(property.value);
        if (isIdProperty(property.name)) {
          const definition: IdDefinition = {
            entityId,
            psetName: pset.name,
            propertyName: property.name,
            value,
          };
          if (objectInfo) {
            index.definitions.push(definition);
            if (!isBlank(value)) {
              pushValue(index.definitionsByValue, value, definition);
            }
          } else if (!isBlank(value)) {
            pushValue(index.externalByValue, value, definition);
          }
          continue;
        }
        if (!isReferenceProperty(property.name)) continue;
        const targets = splitIdList(value);
        if (targets.length === 0) {
          index.references.push({
            entityId,
            psetName: pset.name,
            propertyName: property.name,
            value: "",
            raw: value,
          });
          continue;
        }
        for (const target of targets) {
          index.references.push({
            entityId,
            psetName: pset.name,
            propertyName: property.name,
            value: target,
            raw: value,
          });
        }
      }
    }
  }
  return index;
}

function reportDefinitions(
  session: ModelSession,
  index: ObjectInfoIndex,
  collector: FindingCollector,
): void {
  for (const set of index.setsWithoutId) {
    collector.add({
      kind: "missing-object-info-id",
      severity: "warning",
      message: `${set.psetName} an ${session.labelOf(set.entityId)} hat keine _ID-Property.`,
      entityIds: [set.entityId],
      detail: set.psetName,
    });
  }
  for (const definition of index.definitions) {
    if (!isBlank(definition.value)) continue;
    collector.add({
      kind: "empty-object-info-id",
      severity: "warning",
      message: `${definition.psetName}.${definition.propertyName} ist an ${session.labelOf(definition.entityId)} leer.`,
      entityIds: [definition.entityId],
      detail: `${definition.psetName}.${definition.propertyName}`,
    });
  }
  for (const [value, definitions] of index.definitionsByValue) {
    if (definitions.length < 2) continue;
    collector.add({
      kind: "duplicate-object-info-id",
      severity: "error",
      message: `Die Objektinfo-ID „${value}" ist ${definitions.length}-fach vergeben: ${definitions
        .map((definition) => `#${definition.entityId}`)
        .join(", ")}.`,
      entityIds: definitions.map((definition) => definition.entityId),
      detail: value,
    });
  }
}

function reportReferences(
  session: ModelSession,
  index: ObjectInfoIndex,
  collector: FindingCollector,
): Set<string> {
  const referenced = new Set<string>();
  for (const reference of index.references) {
    const where = `${reference.psetName}.${reference.propertyName}`;
    const label = session.labelOf(reference.entityId);
    const detail = reference.raw ? `${where} = „${reference.raw}"` : where;
    if (isBlank(reference.value)) {
      collector.add({
        kind: "empty-id-reference",
        severity: "info",
        message: `${where} ist an ${label} leer.`,
        entityIds: [reference.entityId],
        detail: where,
      });
      continue;
    }
    const targets = index.definitionsByValue.get(reference.value) ?? [];
    if (targets.length === 1) {
      referenced.add(reference.value);
      continue;
    }
    if (targets.length > 1) {
      referenced.add(reference.value);
      collector.add({
        kind: "ambiguous-object-info-reference",
        severity: "error",
        message: `${where} an ${label} verweist auf die mehrfach vergebene Objektinfo-ID „${reference.value}".`,
        entityIds: [
          reference.entityId,
          ...targets.map((target) => target.entityId),
        ],
        detail,
      });
      continue;
    }
    const external = index.externalByValue.get(reference.value) ?? [];
    if (external.length > 0) {
      collector.add({
        kind: "external-id-reference",
        severity: "info",
        message: `${where} an ${label} verweist auf „${reference.value}" — eine _ID außerhalb der Objektinfo-Familie.`,
        entityIds: [
          reference.entityId,
          ...external.map((target) => target.entityId),
        ],
        detail,
      });
      continue;
    }
    collector.add({
      kind: "missing-object-info-reference",
      severity: "warning",
      message: `${where} an ${label} verweist auf die unbekannte Objektinfo-ID „${reference.value}".`,
      entityIds: [reference.entityId],
      detail,
    });
  }
  return referenced;
}

/** Objektinfo-Prüfung über die aktuelle Sitzung ausführen. */
export async function run(session: ModelSession): Promise<CheckRunResult> {
  const collector = new FindingCollector("object-info");
  const index = buildIndex(session);
  reportDefinitions(session, index, collector);
  const referenced = reportReferences(session, index, collector);
  for (const definition of index.definitions) {
    if (isBlank(definition.value) || referenced.has(definition.value)) continue;
    collector.add({
      kind: "unreferenced-object-info-id",
      severity: "info",
      message: `Auf die Objektinfo-ID „${definition.value}" an ${session.labelOf(definition.entityId)} verweist kein ID-Property.`,
      entityIds: [definition.entityId],
      detail: definition.value,
    });
  }
  return collector.result(index.checkedCount);
}
