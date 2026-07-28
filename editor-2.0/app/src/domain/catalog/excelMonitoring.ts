/**
 * Import der Monitoring-Variante (openSIM MON).
 *
 * Die Mappe hat nur ein Merkmals-Sheet; Klassen stehen nicht in eigenen
 * Sheets. Gruppiert wird nach Merkmalsgruppe: jede Merkmalsgruppe wird eine
 * wählbare Klasse (Bauwerk, Messanlage, Sensor …), statt alles auf die zwei
 * IFC-Elemente der Element-Spalte zusammenzufalten (wie in 1.x).
 */
import * as XLSX from "xlsx";

import {
  normalizeCatalogRequirement,
  normalizeCatalogToken,
  normalizeIfcClass,
  normalizeIfcValueType,
  type CatalogObjectType,
  type CatalogPropertyRule,
  type IfcObjectCatalog,
} from "./model";
import {
  MONITORING_COLUMNS,
  MONITORING_LOI_COLUMNS,
  MONITORING_PROPERTY_SHEET,
  MONITORING_TRADE_COLUMNS,
  cleanCell,
  countCatalogRules,
  looksLikePropertyRule,
  makeCatalogId,
  readMarkers,
  readSheetRows,
  readableSetName,
} from "./excelUtils";

export function parseMonitoringCatalog(
  workbook: XLSX.WorkBook,
  fileName: string,
): IfcObjectCatalog {
  const objectTypes = parseMonitoringObjectTypes(
    readSheetRows(workbook, MONITORING_PROPERTY_SHEET),
  );
  return {
    diagnostics: [
      objectTypes.length === 0
        ? `Keine Monitoring-Objekte gefunden. Erwartet wird eine Element-Spalte in „${MONITORING_PROPERTY_SHEET}".`
        : `${objectTypes.length} Monitoring-Objektklassen aus „${MONITORING_PROPERTY_SHEET}" importiert.`,
      `${countCatalogRules(objectTypes)} Merkmalsregeln indiziert.`,
    ],
    fileName,
    importedAt: new Date().toISOString(),
    kind: "monitoring",
    objectTypes,
  };
}

interface MonitoringGroup {
  psetName: string;
  ifcClass: string;
  rules: CatalogPropertyRule[];
}

function parseMonitoringObjectTypes(rows: unknown[][]): CatalogObjectType[] {
  if (rows.length < 2) return [];
  const groups = new Map<string, MonitoringGroup>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const psetName = cleanCell(row[MONITORING_COLUMNS.pset]);
    const propertyName =
      cleanCell(row[MONITORING_COLUMNS.propertyAttribute]) ||
      cleanCell(row[MONITORING_COLUMNS.propertyOutput]);
    if (!looksLikePropertyRule(psetName, propertyName)) continue;

    const key = normalizeCatalogToken(psetName);
    let group = groups.get(key);
    if (!group) {
      group = {
        psetName,
        ifcClass: normalizeIfcClass(
          cleanCell(row[MONITORING_COLUMNS.ifcClass]) ||
            "IfcBuildingElementProxy",
        ),
        rules: [],
      };
      groups.set(key, group);
    }
    group.rules.push({
      format: cleanCell(row[MONITORING_COLUMNS.format]),
      id: "",
      loiMarkers: readMarkers(row, MONITORING_LOI_COLUMNS),
      propertyName,
      psetName,
      requirement: normalizeCatalogRequirement(
        row[MONITORING_COLUMNS.requirement],
      ),
      sourceRow: index + 1,
      sourceSheet: MONITORING_PROPERTY_SHEET,
      tradeMarkers: readMarkers(row, MONITORING_TRADE_COLUMNS),
      unit: "",
      valueType: normalizeIfcValueType(row[MONITORING_COLUMNS.valueType]),
    });
  }

  return [...groups.values()].map((group) => {
    const id = makeCatalogId(`mon ${group.psetName}`);
    const code = monitoringObjectCode(
      group.rules[0]?.propertyName,
      group.psetName,
    );
    return {
      code: `MON - ${code}`,
      id,
      ifcClass: group.ifcClass,
      name: readableSetName(group.psetName, true),
      propertyRules: group.rules.map((rule, ruleIndex) => ({
        ...rule,
        id: `${id}:monitoring:${ruleIndex + 1}`,
      })),
      sheetName: MONITORING_PROPERTY_SHEET,
      version: "",
    };
  });
}

/** Kürzel aus dem Merkmalssuffix („_Bauwerksnummer_BW" → „BW"). */
function monitoringObjectCode(
  propertyName: string | undefined,
  psetName: string,
): string {
  const suffix = String(propertyName ?? "").match(/_([^_]+)$/)?.[1];
  return (suffix || readableSetName(psetName, true)).toUpperCase() || "OBJ";
}
