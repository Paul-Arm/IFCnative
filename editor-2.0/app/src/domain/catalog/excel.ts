/**
 * Import der openSIM-Objektkataloge aus Excel (Portierung aus 1.x
 * `src/ifc/catalogExcel.ts`).
 *
 * Zwei Varianten werden unterstützt und automatisch erkannt:
 *  - „Diagnostik" (openSIM BWD): Klassen-Sheets plus die Master-Sheets
 *    „Alle Merkmale (Propertys)" und „Übersicht Klassen+Domänen".
 *  - „Monitoring" (openSIM MON): ein einzelnes Merkmals-Sheet; die Klassen
 *    ergeben sich aus den Merkmalsgruppen der Element-Spalte.
 *
 * Abweichung zu 1.x: die Import-Diagnostik ist deutsch formuliert.
 */
import * as XLSX from "xlsx";

import {
  normalizeCatalogRequirement,
  normalizeCatalogToken,
  normalizeIfcClass,
  normalizeIfcValueType,
  type CatalogKind,
  type CatalogObjectType,
  type CatalogPropertyRule,
  type IfcObjectCatalog,
} from "./model";
import {
  MASTER_CLASS_SHEET,
  MASTER_LOI_COLUMNS,
  MASTER_PROPERTY_SHEET,
  MASTER_TRADE_COLUMNS,
  MASTER_ELEMENT_CLASSES,
  MONITORING_COLUMNS,
  MONITORING_LOI_COLUMNS,
  MONITORING_PROPERTY_SHEET,
  MONITORING_TRADE_COLUMNS,
  SHEET_LOI_COLUMNS,
  SHEET_TRADE_COLUMNS,
  catalogCodeSuffix,
  cleanCell,
  hasPropertySuffix,
  looksLikePropertyRule,
  makeCatalogId,
  propertyNameSuffix,
  readMarkers,
  readSheetRows,
  readableSetName,
} from "./excelUtils";

export function parseCatalogWorkbook(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  kind?: CatalogKind,
): IfcObjectCatalog {
  const workbook = XLSX.read(arrayBuffer, { cellDates: false });
  const resolvedKind = kind ?? detectCatalogKind(workbook);
  return resolvedKind === "monitoring"
    ? parseMonitoringCatalog(workbook, fileName)
    : parseDiagnostikCatalog(workbook, fileName);
}

export function detectCatalogKind(workbook: XLSX.WorkBook): CatalogKind {
  if (workbook.Sheets[MASTER_CLASS_SHEET]) return "diagnostik";
  const header = readSheetRows(workbook, MONITORING_PROPERTY_SHEET)[0] ?? [];
  const tokens = header.map(normalizeCatalogToken);
  const looksMonitoring =
    tokens.includes("ifc-klasse") &&
    tokens.some((token) => token.includes("allplan"));
  return looksMonitoring ? "monitoring" : "diagnostik";
}

// — Diagnostik (BWD) —

function parseDiagnostikCatalog(
  workbook: XLSX.WorkBook,
  fileName: string,
): IfcObjectCatalog {
  const diagnostics: string[] = [];
  const masterRows = readSheetRows(workbook, MASTER_PROPERTY_SHEET);
  const masterClassRows = readSheetRows(workbook, MASTER_CLASS_SHEET);
  const objectTypes = parseMasterObjectTypes(masterClassRows, masterRows);

  if (objectTypes.length === 0) {
    for (const sheetName of workbook.SheetNames) {
      const parsed = parseObjectSheet(
        sheetName,
        readSheetRows(workbook, sheetName),
        masterRows,
      );
      if (parsed) objectTypes.push(parsed);
    }
  }

  if (objectTypes.length === 0) {
    diagnostics.push(
      'Keine Klassen-Sheets gefunden. Erwartet werden Sheets, die mit Merkmalsgruppe "Klasse" beginnen.',
    );
  } else {
    diagnostics.push(
      `${objectTypes.length} Katalogklassen aus ${workbook.SheetNames.length} Sheets importiert.`,
    );
  }
  diagnostics.push(`${countRules(objectTypes)} Merkmalsregeln indiziert.`);
  if (masterRows.length) {
    diagnostics.push(
      objectTypes.length && masterClassRows.length
        ? `Klassen aus „${MASTER_CLASS_SHEET}", Merkmale aus „${MASTER_PROPERTY_SHEET}".`
        : `Merkmale aus „${MASTER_PROPERTY_SHEET}" den Klassen über das Code-Kürzel zugeordnet.`,
    );
  }

  return {
    diagnostics,
    fileName,
    importedAt: new Date().toISOString(),
    kind: "diagnostik",
    objectTypes,
  };
}

function parseMasterObjectTypes(
  classRows: unknown[][],
  propertyRows: unknown[][],
): CatalogObjectType[] {
  if (classRows.length < 2 || propertyRows.length < 2) return [];
  const objectTypes: CatalogObjectType[] = [];
  const seenSuffixes = new Set<string>();
  for (let index = 1; index < classRows.length; index += 1) {
    const row = classRows[index];
    const name = cleanCell(row[0]);
    const code = cleanCell(row[1]);
    const version = cleanCell(row[2]);
    const longName = cleanCell(row[6]);
    const id = makeCatalogId(code || name || longName);
    const propertyRules = readMasterPropertyRules(propertyRows, id, code);
    if (!name || !code || propertyRules.length === 0) continue;
    const suffix = catalogCodeSuffix(code);
    if (suffix) seenSuffixes.add(suffix);
    objectTypes.push({
      code,
      id,
      ifcClass: inferMasterIfcClass(propertyRows, code),
      name,
      propertyRules,
      sheetName: MASTER_CLASS_SHEET,
      version,
    });
  }
  objectTypes.push(...inferMissingMasterObjectTypes(propertyRows, seenSuffixes));
  return objectTypes;
}

/** Klassen, die nur in der Master-Merkmalsliste vorkommen, nachziehen. */
function inferMissingMasterObjectTypes(
  rows: unknown[][],
  seenSuffixes: Set<string>,
): CatalogObjectType[] {
  const suffixes = new Set<string>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const psetName = cleanCell(row[2]);
    const propertyName = cleanCell(row[1]);
    const suffix = propertyNameSuffix(propertyName);
    if (
      !suffix ||
      seenSuffixes.has(suffix) ||
      !looksLikePropertyRule(psetName, propertyName)
    ) {
      continue;
    }
    suffixes.add(suffix);
  }

  return [...suffixes].flatMap<CatalogObjectType>((suffix) => {
    const code = `BWD - ${suffix}`;
    const id = makeCatalogId(code);
    const propertyRules = readMasterPropertyRules(rows, id, code);
    if (!propertyRules.length) return [];
    return [
      {
        code,
        id,
        ifcClass: inferMasterIfcClass(rows, code),
        name: readableSetName(propertyRules[0]?.psetName ?? "") || suffix,
        propertyRules,
        sheetName: MASTER_PROPERTY_SHEET,
        version: "",
      },
    ];
  });
}

function inferMasterIfcClass(rows: unknown[][], code: string): string {
  const suffix = catalogCodeSuffix(code);
  if (!suffix) return "IFCBUILDINGELEMENTPROXY";
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!hasPropertySuffix(cleanCell(row[1]), suffix)) continue;
    const element = cleanCell(row[0]);
    const mapped = MASTER_ELEMENT_CLASSES[normalizeCatalogToken(element)];
    return mapped ?? normalizeIfcClass(element || "IfcBuildingElementProxy");
  }
  return "IFCBUILDINGELEMENTPROXY";
}

function parseObjectSheet(
  sheetName: string,
  rows: unknown[][],
  masterRows: unknown[][],
): CatalogObjectType | undefined {
  const firstCell = normalizeCatalogToken(rows[0]?.[0]);
  if (!firstCell.includes("merkmalsgruppe") || !firstCell.includes("klasse")) {
    return undefined;
  }
  const name = cleanCell(rows[0]?.[1]) || sheetName;
  const code = cleanCell(rows[0]?.[2]);
  const id = makeCatalogId(code || name || sheetName);
  const masterRules = readMasterPropertyRules(masterRows, id, code);
  return {
    code,
    id,
    ifcClass: normalizeIfcClass(rows[1]?.[1]),
    name,
    // Die Master-Merkmalsliste ist führend; das Klassen-Sheet kann veraltet sein.
    propertyRules: masterRules.length
      ? masterRules
      : readSheetPropertyRules(sheetName, rows, id),
    sheetName,
    version: cleanCell(rows[0]?.[14]),
  };
}

function readMasterPropertyRules(
  rows: unknown[][],
  objectId: string,
  code: string,
): CatalogPropertyRule[] {
  const suffix = catalogCodeSuffix(code);
  if (!suffix) return [];
  const rules: CatalogPropertyRule[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const psetName = cleanCell(row[2]);
    const propertyName = cleanCell(row[1]);
    if (
      !looksLikePropertyRule(psetName, propertyName) ||
      !hasPropertySuffix(propertyName, suffix)
    ) {
      continue;
    }
    rules.push({
      format: cleanCell(row[14]),
      id: `${objectId}:master:${rules.length + 1}`,
      loiMarkers: readMarkers(row, MASTER_LOI_COLUMNS),
      propertyName,
      psetName,
      requirement: normalizeCatalogRequirement(row[17]),
      sourceRow: index + 1,
      sourceSheet: MASTER_PROPERTY_SHEET,
      tradeMarkers: readMarkers(row, MASTER_TRADE_COLUMNS),
      unit: cleanCell(row[16]),
      valueType: normalizeIfcValueType(row[13] || row[12]),
    });
  }
  return rules;
}

function readSheetPropertyRules(
  sheetName: string,
  rows: unknown[][],
  objectId: string,
): CatalogPropertyRule[] {
  const rules: CatalogPropertyRule[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const psetName = cleanCell(row[0]);
    const propertyName = cleanCell(row[1]);
    if (!looksLikePropertyRule(psetName, propertyName)) continue;
    rules.push({
      format: cleanCell(row[3]),
      id: `${objectId}:${rules.length + 1}`,
      loiMarkers: readMarkers(row, SHEET_LOI_COLUMNS),
      propertyName,
      psetName,
      requirement: normalizeCatalogRequirement(row[5]),
      sourceRow: index + 1,
      sourceSheet: sheetName,
      tradeMarkers: readMarkers(row, SHEET_TRADE_COLUMNS),
      unit: cleanCell(row[4]),
      valueType: normalizeIfcValueType(row[2]),
    });
  }
  return rules;
}

// — Monitoring (MON) —

function parseMonitoringCatalog(
  workbook: XLSX.WorkBook,
  fileName: string,
): IfcObjectCatalog {
  const diagnostics: string[] = [];
  const objectTypes = parseMonitoringObjectTypes(
    readSheetRows(workbook, MONITORING_PROPERTY_SHEET),
  );
  diagnostics.push(
    objectTypes.length === 0
      ? `Keine Monitoring-Objekte gefunden. Erwartet wird eine Element-Spalte in „${MONITORING_PROPERTY_SHEET}".`
      : `${objectTypes.length} Monitoring-Objektklassen aus „${MONITORING_PROPERTY_SHEET}" importiert.`,
  );
  diagnostics.push(`${countRules(objectTypes)} Merkmalsregeln indiziert.`);
  return {
    diagnostics,
    fileName,
    importedAt: new Date().toISOString(),
    kind: "monitoring",
    objectTypes,
  };
}

/**
 * Gruppierung nach Merkmalsgruppe: jede Merkmalsgruppe wird eine wählbare
 * Klasse (Bauwerk, Messanlage, Sensor …), statt alles auf die zwei
 * IFC-Elemente der Element-Spalte zusammenzufalten.
 */
function parseMonitoringObjectTypes(rows: unknown[][]): CatalogObjectType[] {
  if (rows.length < 2) return [];
  interface Group {
    psetName: string;
    ifcClass: string;
    rules: CatalogPropertyRule[];
  }
  const groups = new Map<string, Group>();
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
    return {
      code: `MON - ${monitoringObjectCode(group.rules[0]?.propertyName, group.psetName)}`,
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

function countRules(objectTypes: readonly CatalogObjectType[]): number {
  return objectTypes.reduce(
    (total, objectType) => total + objectType.propertyRules.length,
    0,
  );
}
