/**
 * Spaltenlayouts und Zell-Helfer der openSIM-Arbeitsmappen
 * (Portierung der internen Helfer aus 1.x `src/ifc/catalogExcel.ts`).
 *
 * Die Spaltenindizes stammen aus den ausgelieferten Katalogdateien und sind
 * bewusst hart kodiert — die Mappen haben keine stabilen Kopfzeilen-Namen.
 */
import * as XLSX from "xlsx";

import {
  normalizeCatalogToken,
  type CatalogObjectType,
} from "./model";

/** Gesamtzahl der Merkmalsregeln über alle Klassen (Import-Diagnostik). */
export function countCatalogRules(
  objectTypes: readonly CatalogObjectType[],
): number {
  return objectTypes.reduce(
    (total, objectType) => total + objectType.propertyRules.length,
    0,
  );
}

export interface MarkerColumn {
  index: number;
  label: string;
}

/** Klassen-Sheets der Diagnostik-Mappe (eine Merkmalsliste je Klasse). */
export const SHEET_TRADE_COLUMNS: MarkerColumn[] = [
  { index: 6, label: "TM UP" },
  { index: 7, label: "TM EE" },
  { index: 8, label: "TM UE" },
];

export const SHEET_LOI_COLUMNS: MarkerColumn[] = [
  { index: 9, label: "LoI 100" },
  { index: 10, label: "LoI 200" },
  { index: 11, label: "LoI 300" },
  { index: 12, label: "LoI 400" },
  { index: 13, label: "LoI 500" },
];

export const MASTER_PROPERTY_SHEET = "Alle Merkmale (Propertys)";
export const MASTER_CLASS_SHEET = "Übersicht Klassen+Domänen";

export const MASTER_TRADE_COLUMNS: MarkerColumn[] = [
  { index: 4, label: "TM UP" },
  { index: 5, label: "TM EE" },
  { index: 6, label: "TM UE" },
];

export const MASTER_LOI_COLUMNS: MarkerColumn[] = [
  { index: 7, label: "LoI 100" },
  { index: 8, label: "LoI 200" },
  { index: 9, label: "LoI 300" },
  { index: 10, label: "LoI 400" },
  { index: 11, label: "LoI 500" },
];

export const MASTER_ELEMENT_CLASSES: Record<string, string> = {
  building: "IFCBUILDING",
  proxy: "IFCBUILDINGELEMENTPROXY",
};

/**
 * Die Monitoring-Mappe (MON) hat nur ein Merkmals-Sheet mit abweichendem
 * Spaltenlayout; Klassen stehen nicht in eigenen Sheets, sondern werden aus
 * der Element-/Merkmalsgruppen-Spalte abgeleitet.
 */
export const MONITORING_PROPERTY_SHEET = "Alle Merkmale (Propertys)";

export const MONITORING_COLUMNS = {
  element: 0,
  propertyOutput: 1,
  propertyAttribute: 3,
  pset: 4,
  valueType: 14,
  ifcClass: 15,
  format: 16,
  requirement: 18,
} as const;

export const MONITORING_TRADE_COLUMNS: MarkerColumn[] = [
  { index: 6, label: "TM MEKO" },
  { index: 7, label: "TM INSP" },
  { index: 8, label: "TM INSD" },
];

export const MONITORING_LOI_COLUMNS: MarkerColumn[] = [
  { index: 9, label: "LoI 100" },
  { index: 10, label: "LoI 200" },
  { index: 11, label: "LoI 300" },
  { index: 12, label: "LoI 400" },
  { index: 13, label: "LoI 500" },
];

/** Sheet als Zeilenmatrix (Kopfzeile inklusive), leere Zeilen fallen weg. */
export function readSheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    blankrows: false,
    defval: "",
    header: 1,
    raw: false,
  });
}

export function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Filtert Kopf-, Legenden- und Changelog-Zeilen heraus: eine echte
 * Merkmalszeile hat eine (e)Pset-Merkmalsgruppe und einen Merkmalsnamen.
 */
export function looksLikePropertyRule(
  psetName: string,
  propertyName: string,
): boolean {
  if (!psetName || !propertyName) return false;
  const psetToken = normalizeCatalogToken(psetName);
  const propertyToken = normalizeCatalogToken(propertyName);
  return (
    !psetToken.includes("propertyset") &&
    !propertyToken.includes("property") &&
    !propertyToken.includes("merkmal") &&
    (psetToken.startsWith("epset") || psetToken.startsWith("pset"))
  );
}

export function readMarkers(
  row: unknown[],
  columns: readonly MarkerColumn[],
): Record<string, boolean> {
  return Object.fromEntries(
    columns.map((column) => [column.label, isMarkerSet(row[column.index])]),
  );
}

function isMarkerSet(value: unknown): boolean {
  const token = normalizeCatalogToken(value);
  return token === "x" || token === "1" || token === "yes" || token === "ja";
}

/** „BWD - TW" → „TW" (Kurzkürzel hinter dem letzten Bindestrich). */
export function catalogCodeSuffix(code: string): string {
  return (
    cleanCell(code)
      .split("-")
      .pop()
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "") ?? ""
  );
}

export function hasPropertySuffix(
  propertyName: string,
  suffix: string,
): boolean {
  return propertyNameSuffix(propertyName) === suffix;
}

/** „_Chloridanalyse_CA" → „CA" (Klassenzuordnung der Master-Merkmalsliste). */
export function propertyNameSuffix(propertyName: string): string {
  return (
    cleanCell(propertyName)
      .match(/_([A-Z0-9]+)$/i)?.[1]
      ?.toUpperCase() ?? ""
  );
}

export function makeCatalogId(value: string): string {
  return (
    normalizeCatalogToken(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "catalog-object"
  );
}

/**
 * „ePset_Untersuchungsziel" → „Untersuchungsziel". Mit `stripPluralN` wird
 * zusätzlich ein Plural-N entfernt („ePset_MessanlageN" → „Messanlage") —
 * das gilt nur für die Monitoring-Mappe, wie in 1.x.
 */
export function readableSetName(psetName: string, stripPluralN = false): string {
  let cleaned = psetName
    .replace(/^e?pset[_\s-]*/i, "")
    .replace(/_/g, " ")
    .trim();
  if (stripPluralN) cleaned = cleaned.replace(/N$/, "").trim();
  return cleaned || psetName;
}
