/**
 * Katalogklasse → IDS 1.0 (neu in 2.0, kein 1.x-Vorbild).
 *
 * `@ifc-lite/ids` (1.15.34) liefert ausschließlich Lese-APIs — `parseIDS`,
 * `validateIDS`, `auditIDSDocument` samt Facetten-/Constraint-Prüfern. Einen
 * Builder oder Serializer gibt es dort NICHT, deshalb wird das Dokument hier
 * als Template-String nach dem IDS-1.0-Schema erzeugt
 * (Namensraum http://standards.buildingsmart.org/IDS). Die Gegenprobe
 * (`parseIDS`/`auditIDSDocument`) läuft in tests/m3-katalog.test.ts.
 *
 * Erzeugt wird eine Spezifikation je Katalogklasse:
 *  - Applicability: Entity-Facette mit der IFC-Klasse der Katalogklasse
 *  - Requirements: je Pflichtmerkmal eine Property-Facette mit Merkmalsgruppe
 *    (propertySet), Merkmal (baseName), IFC-Wertetyp (@dataType) und
 *    cardinality="required"
 */
import {
  catalogObjectLabel,
  isRequiredCatalogRule,
  matchesLoiLevel,
  normalizeIfcClass,
  normalizeIfcValueType,
  type CatalogLoiLevel,
  type CatalogObjectType,
  type CatalogPropertyRule,
} from "./model";

export interface CatalogIdsOptions {
  /** Nur Merkmale dieser LoI-Stufe; `null` = alle Stufen. */
  loi?: CatalogLoiLevel | null;
  /** Nur Pflichtmerkmale übernehmen (Standard: ja). */
  requiredOnly?: boolean;
  ifcVersion?: "IFC2X3" | "IFC4" | "IFC4X3";
  title?: string;
  /** Datum im Format JJJJ-MM-TT (Standard: heute). */
  date?: string;
}

const IDS_NS = "http://standards.buildingsmart.org/IDS";
const XSD_LOCATION = `${IDS_NS} http://standards.buildingsmart.org/IDS/1.0/ids.xsd`;

/** Merkmale, die in das IDS-Dokument einfließen. */
export function catalogIdsRules(
  objectType: CatalogObjectType,
  options: CatalogIdsOptions = {},
): CatalogPropertyRule[] {
  const requiredOnly = options.requiredOnly ?? true;
  return objectType.propertyRules.filter(
    (rule) =>
      (!requiredOnly || isRequiredCatalogRule(rule)) &&
      matchesLoiLevel(rule, options.loi ?? null),
  );
}

export function buildCatalogIds(
  objectType: CatalogObjectType,
  options: CatalogIdsOptions = {},
): string {
  const ifcVersion = options.ifcVersion ?? "IFC4";
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const loiSuffix = options.loi ? ` — ${options.loi}` : "";
  const title =
    options.title ?? `openSIM Objektkatalog: ${catalogObjectLabel(objectType)}`;
  const rules = catalogIdsRules(objectType, options);

  const requirements = rules
    .map((rule) => propertyFacet(rule))
    .join("\n");
  const requirementsBlock = rules.length
    ? `      <requirements>\n${requirements}\n      </requirements>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="${IDS_NS}" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${XSD_LOCATION}">
  <info>
    <title>${escapeXml(title)}</title>
    <version>${escapeXml(objectType.version || "1.0")}</version>
    <date>${escapeXml(date)}</date>
    <purpose>Aus dem openSIM-Objektkatalog erzeugte Anforderungen (IFCnative 2.0).</purpose>
  </info>
  <specifications>
    <specification name="${escapeXml(catalogObjectLabel(objectType) + loiSuffix)}" ifcVersion="${ifcVersion}" identifier="${escapeXml(objectType.id)}">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity>
          <name>
            <simpleValue>${escapeXml(normalizeIfcClass(objectType.ifcClass))}</simpleValue>
          </name>
        </entity>
      </applicability>
${requirementsBlock}    </specification>
  </specifications>
</ids>
`;
}

function propertyFacet(rule: CatalogPropertyRule): string {
  const dataType = escapeXml(normalizeIfcValueType(rule.valueType));
  return `        <property dataType="${dataType}" cardinality="required">
          <propertySet>
            <simpleValue>${escapeXml(rule.psetName)}</simpleValue>
          </propertySet>
          <baseName>
            <simpleValue>${escapeXml(rule.propertyName)}</simpleValue>
          </baseName>
        </property>`;
}

/** Dateiname für den Download: „<Klasse>.ids". */
export function catalogIdsFileName(objectType: CatalogObjectType): string {
  const base = (objectType.name || objectType.id)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();
  return `${base || "Katalogklasse"}.ids`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
