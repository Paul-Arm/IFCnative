/**
 * Prüfung eines Objekts gegen eine Katalogklasse (Portierung aus 1.x
 * `src/ifc/catalogValidation.ts`) — hier gegen die `ModelSession` von 2.0
 * statt gegen das 1.x-`NativeIfcDocument`.
 *
 * Gelesen wird bewusst über das Mutations-Overlay (`view.getForEntity`),
 * damit gerade angelegte Psets sofort in die Re-Validierung einfließen.
 *
 * ENTSCHEIDUNG (Abweichung zu 1.x): Für `missing-classification` gibt es in
 * 2.0 KEINEN Quick-Fix. Eine echte IfcClassificationReference samt
 * IfcRelAssociatesClassification ließe sich zwar über den StoreEditor
 * anlegen, wäre in der laufenden Sitzung aber nicht nachweisbar — der
 * Klassifikations-Extraktor des Parsers liest den statischen CSR-Graphen und
 * würde die neue Referenz nicht sehen; die Re-Validierung meldete den Befund
 * weiterhin. Eine property-basierte Ersatzlösung würde eine Klassifikation
 * nur vortäuschen. `missing-classification` und `class-mismatch` sind daher
 * reine Anzeige-Befunde.
 */
import { extractClassificationsOnDemand } from "@ifc-lite/parser";
import type { PropertySet, Property } from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";
import {
  CATALOG_SEVERITY_OF,
  catalogObjectLabel,
  catalogValueTypeToPropertyType,
  groupCatalogRulesByPset,
  ifcTypeOfPropertyValueType,
  isRequiredCatalogRule,
  normalizeCatalogToken,
  normalizeIfcClass,
  normalizeIfcValueType,
  type CatalogFindingKind,
  type CatalogObjectType,
  type CatalogValidationFinding,
} from "./model";

/** Klassifikationssystem, unter dem der Katalog referenziert wird. */
export const CATALOG_CLASSIFICATION_SYSTEM = "openSIM BIM Objektkatalog";

export function validateEntityAgainstCatalogObject(
  session: ModelSession,
  entityId: number,
  objectType: CatalogObjectType,
): CatalogValidationFinding[] {
  const identity = session.identityOf(entityId);
  if (!identity.type) return [];

  const findings: CatalogValidationFinding[] = [];
  const objectLabel = catalogObjectLabel(objectType);

  if (normalizeIfcClass(identity.type) !== normalizeIfcClass(objectType.ifcClass)) {
    findings.push(
      finding({
        actualType: identity.type,
        entityId,
        expectedType: objectType.ifcClass,
        kind: "class-mismatch",
        message: `#${entityId} ist ${identity.type}; Katalogklasse ${objectLabel} erwartet ${objectType.ifcClass}.`,
        objectType,
        suffix: identity.type,
      }),
    );
  }

  if (objectType.code && !hasCatalogClassification(session, entityId, objectType)) {
    findings.push(
      finding({
        entityId,
        kind: "missing-classification",
        message: `Katalog-Klassifikation ${objectType.code} ist nicht mit #${entityId} verknüpft (nur Anzeige, kein Quick-Fix).`,
        objectType,
        suffix: objectType.code,
      }),
    );
  }

  const psets = session.view.getForEntity(entityId);
  const requiredRules = objectType.propertyRules.filter(isRequiredCatalogRule);

  for (const [psetName, rules] of groupCatalogRulesByPset(requiredRules)) {
    const set = findPset(psets, psetName);
    if (!set) {
      findings.push(
        finding({
          entityId,
          kind: "missing-pset",
          message: `${psetName} fehlt an #${entityId}; ${objectLabel} definiert dort ${rules.length} Pflichtmerkmale.`,
          objectType,
          psetName,
          quickFix: {
            kind: "add-pset-properties",
            label: `${psetName} anlegen`,
            properties: rules,
            psetName,
          },
          suffix: psetName,
        }),
      );
      continue;
    }

    const missingRules = rules.filter((rule) => !findProperty(set, rule.propertyName));
    if (missingRules.length > 0) {
      findings.push(
        finding({
          entityId,
          kind: "missing-property",
          message: `${psetName} an #${entityId} fehlen: ${missingRules.map((rule) => rule.propertyName).join(", ")}.`,
          objectType,
          psetName,
          quickFix: {
            kind: "add-pset-properties",
            label: `Fehlende Merkmale in ${psetName} ergänzen`,
            properties: missingRules,
            psetName,
          },
          suffix: psetName,
        }),
      );
    }

    for (const rule of rules) {
      const property = findProperty(set, rule.propertyName);
      if (!property) continue;
      const expectedType = normalizeIfcValueType(rule.valueType);
      const actualType = actualIfcTypeOf(property);
      if (actualType && !typesMatch(expectedType, actualType)) {
        findings.push(
          finding({
            actualType,
            entityId,
            expectedType,
            kind: "property-type-mismatch",
            message: `${psetName}.${rule.propertyName} nutzt ${actualType}; der Katalog erwartet ${expectedType}.`,
            objectType,
            propertyName: rule.propertyName,
            psetName,
            suffix: `${psetName}:${rule.propertyName}`,
          }),
        );
      }
      if (isEmptyValue(property.value)) {
        findings.push(
          finding({
            entityId,
            kind: "empty-required-value",
            message: `${psetName}.${rule.propertyName} ist Pflicht, aber an #${entityId} noch leer.`,
            objectType,
            propertyName: rule.propertyName,
            psetName,
            suffix: `${psetName}:${rule.propertyName}`,
          }),
        );
      }
    }
  }

  return findings;
}

/**
 * Vorschlag einer Katalogklasse für ein Objekt: zuerst über eine vorhandene
 * Klassifikationsreferenz, sonst über IFC-Klasse + Namensähnlichkeit.
 */
export function suggestCatalogObjectForEntity(
  session: ModelSession,
  entityId: number,
  objectTypes: readonly CatalogObjectType[],
): CatalogObjectType | undefined {
  const identity = session.identityOf(entityId);
  if (!identity.type) return undefined;
  const references = classificationTokens(session, entityId);
  const name = normalizeCatalogToken(identity.name);

  const byReference = objectTypes.find(
    (objectType) =>
      objectType.code &&
      references.some((reference) =>
        reference.includes(normalizeCatalogToken(objectType.code)),
      ),
  );
  if (byReference) return byReference;

  return objectTypes.find(
    (objectType) =>
      normalizeIfcClass(objectType.ifcClass) === normalizeIfcClass(identity.type) &&
      name !== "" &&
      (name.includes(normalizeCatalogToken(objectType.name)) ||
        (objectType.code !== "" &&
          name.includes(normalizeCatalogToken(objectType.code)))),
  );
}

/** Befunde, die eine Aktion erfordern (alles außer reinen Hinweisen). */
export function blockingCatalogFindings(
  findings: readonly CatalogValidationFinding[],
): CatalogValidationFinding[] {
  return findings.filter((entry) => entry.severity !== "info");
}

// — Helfer —

interface FindingInput {
  entityId: number;
  kind: CatalogFindingKind;
  message: string;
  objectType: CatalogObjectType;
  suffix: string;
  psetName?: string;
  propertyName?: string;
  expectedType?: string;
  actualType?: string;
  quickFix?: CatalogValidationFinding["quickFix"];
}

function finding(input: FindingInput): CatalogValidationFinding {
  const { objectType, suffix, ...rest } = input;
  return {
    ...rest,
    catalogObjectId: objectType.id,
    id: `${input.entityId}:${objectType.id}:${input.kind}:${normalizeCatalogToken(
      suffix,
    ).replace(/[^a-z0-9]+/g, "-")}`,
    severity: CATALOG_SEVERITY_OF[input.kind],
  };
}

function hasCatalogClassification(
  session: ModelSession,
  entityId: number,
  objectType: CatalogObjectType,
): boolean {
  const tokens = classificationTokens(session, entityId);
  const code = normalizeCatalogToken(objectType.code);
  const name = normalizeCatalogToken(objectType.name);
  return tokens.some(
    (token) =>
      (code !== "" && token.includes(code)) ||
      (name !== "" && token.includes(name)),
  );
}

function classificationTokens(
  session: ModelSession,
  entityId: number,
): string[] {
  return extractClassificationsOnDemand(session.store, entityId).flatMap(
    (entry) =>
      [entry.identification, entry.name, entry.system]
        .filter((value): value is string => Boolean(value))
        .map(normalizeCatalogToken),
  );
}

function findPset(sets: readonly PropertySet[], psetName: string) {
  const token = normalizeCatalogToken(psetName);
  return sets.find((set) => normalizeCatalogToken(set.name) === token);
}

function findProperty(set: PropertySet, propertyName: string) {
  const token = normalizeCatalogToken(propertyName);
  return set.properties.find(
    (property) => normalizeCatalogToken(property.name) === token,
  );
}

/**
 * IFC-Typ des vorhandenen Werts: bevorzugt der beim Parsen mitgelesene
 * Rohtyp (`dataType`), sonst die Werttyp-Kennung des Overlays.
 */
function actualIfcTypeOf(property: Property): string | null {
  if (property.dataType) return normalizeIfcValueType(property.dataType);
  return ifcTypeOfPropertyValueType(property.type);
}

/**
 * Typvergleich über die Werttyp-Klasse des Overlays: IFCCOUNTMEASURE und
 * IFCINTEGER etwa landen auf derselben Kennung und gelten als verträglich.
 */
function typesMatch(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  return (
    catalogValueTypeToPropertyType(expected) ===
    catalogValueTypeToPropertyType(actual)
  );
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean" || typeof value === "number") return false;
  return String(value).trim() === "";
}
