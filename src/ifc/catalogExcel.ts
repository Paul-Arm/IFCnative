import * as XLSX from "xlsx";

import {
    type CatalogObjectType,
    type CatalogPropertyRule,
    type IfcObjectCatalog,
    normalizeCatalogRequirement,
    normalizeCatalogToken,
    normalizeIfcClass,
    normalizeIfcValueType,
} from "./catalog";

const TRADE_COLUMNS = [
  { index: 6, label: "TM UP" },
  { index: 7, label: "TM EE" },
  { index: 8, label: "TM UE" },
];

const LOI_COLUMNS = [
  { index: 9, label: "LoI 100" },
  { index: 10, label: "LoI 200" },
  { index: 11, label: "LoI 300" },
  { index: 12, label: "LoI 400" },
  { index: 13, label: "LoI 500" },
];

const MASTER_PROPERTY_SHEET = "Alle Merkmale (Propertys)";
const MASTER_CLASS_SHEET = "Übersicht Klassen+Domänen";

const MASTER_TRADE_COLUMNS = [
  { index: 4, label: "TM UP" },
  { index: 5, label: "TM EE" },
  { index: 6, label: "TM UE" },
];

const MASTER_LOI_COLUMNS = [
  { index: 7, label: "LoI 100" },
  { index: 8, label: "LoI 200" },
  { index: 9, label: "LoI 300" },
  { index: 10, label: "LoI 400" },
  { index: 11, label: "LoI 500" },
];

const MASTER_ELEMENT_CLASSES: Record<string, string> = {
  building: "IFCBUILDING",
  proxy: "IFCBUILDINGELEMENTPROXY",
};

export function parseCatalogWorkbook(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): IfcObjectCatalog {
  const workbook = XLSX.read(arrayBuffer, { cellDates: false });
  const diagnostics: string[] = [];
  let objectTypes: CatalogObjectType[] = [];
  const masterRows = readSheetRows(workbook, MASTER_PROPERTY_SHEET);
  const masterClassRows = readSheetRows(workbook, MASTER_CLASS_SHEET);

  objectTypes = parseMasterObjectTypes(masterClassRows, masterRows);

  if (objectTypes.length === 0) {
    for (const sheetName of workbook.SheetNames) {
      const rows = readSheetRows(workbook, sheetName);
      const parsed = parseObjectSheet(sheetName, rows, masterRows);
      if (parsed) {
        objectTypes.push(parsed);
      }
    }
  }

  if (objectTypes.length === 0) {
    diagnostics.push(
      'No object-class sheets found. Expected sheets starting with Merkmalsgruppe "Klasse".',
    );
  } else {
    diagnostics.push(
      `Imported ${objectTypes.length.toLocaleString()} catalog object classes from ${workbook.SheetNames.length.toLocaleString()} sheets.`,
    );
  }

  const propertyRuleCount = objectTypes.reduce(
    (total, objectType) => total + objectType.propertyRules.length,
    0,
  );
  diagnostics.push(
    `Indexed ${propertyRuleCount.toLocaleString()} object-bound property rules.`,
  );
  if (masterRows.length) {
    diagnostics.push(
      objectTypes.length && masterClassRows.length
        ? `Imported object classes from ${MASTER_CLASS_SHEET} and rules from ${MASTER_PROPERTY_SHEET}.`
        : `Preferred ${MASTER_PROPERTY_SHEET} rows for object classes with matching code suffixes.`,
    );
  }

  return {
    diagnostics,
    fileName,
    importedAt: new Date().toISOString(),
    objectTypes,
  };
}

function parseMasterObjectTypes(
  classRows: unknown[][],
  propertyRows: unknown[][],
) {
  if (classRows.length < 2 || propertyRows.length < 2) {
    return [];
  }
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
    if (!name || !code || propertyRules.length === 0) {
      continue;
    }
    const suffix = catalogCodeSuffix(code);
    if (suffix) {
      seenSuffixes.add(suffix);
    }
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
  objectTypes.push(
    ...inferMissingMasterObjectTypes(propertyRows, seenSuffixes),
  );
  return objectTypes;
}

function inferMissingMasterObjectTypes(
  rows: unknown[][],
  seenSuffixes: Set<string>,
) {
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
    if (!propertyRules.length) {
      return [];
    }
    return [
      {
        code,
        id,
        ifcClass: inferMasterIfcClass(rows, code),
        name: inferMissingMasterObjectName(propertyRules, suffix),
        propertyRules,
        sheetName: MASTER_PROPERTY_SHEET,
        version: "",
      },
    ];
  });
}

function inferMissingMasterObjectName(
  rules: CatalogPropertyRule[],
  suffix: string,
) {
  const psetName = rules[0]?.psetName ?? "";
  return (
    psetName
      .replace(/^e?pset[_\s-]*/i, "")
      .replace(/_/g, " ")
      .trim() || suffix
  );
}

function inferMasterIfcClass(rows: unknown[][], code: string) {
  const suffix = catalogCodeSuffix(code);
  if (!suffix) {
    return "IFCBUILDINGELEMENTPROXY";
  }
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const propertyName = cleanCell(row[1]);
    if (!hasPropertySuffix(propertyName, suffix)) {
      continue;
    }
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
  const version = cleanCell(rows[0]?.[14]);
  const ifcClass = normalizeIfcClass(rows[1]?.[1]);
  const id = makeCatalogId(code || name || sheetName);
  const sheetRules = readPropertyRules(sheetName, rows, id);
  const masterRules = readMasterPropertyRules(masterRows, id, code);
  const propertyRules = masterRules.length ? masterRules : sheetRules;

  return {
    code,
    id,
    ifcClass,
    name,
    propertyRules,
    sheetName,
    version,
  };
}

function readSheetRows(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    blankrows: false,
    defval: "",
    header: 1,
    raw: false,
  });
}

function readMasterPropertyRules(
  rows: unknown[][],
  objectId: string,
  code: string,
) {
  const suffix = catalogCodeSuffix(code);
  if (!suffix) {
    return [];
  }
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

function readPropertyRules(
  sheetName: string,
  rows: unknown[][],
  objectId: string,
) {
  const rules: CatalogPropertyRule[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const psetName = cleanCell(row[0]);
    const propertyName = cleanCell(row[1]);
    if (!looksLikePropertyRule(psetName, propertyName)) {
      continue;
    }
    rules.push({
      format: cleanCell(row[3]),
      id: `${objectId}:${rules.length + 1}`,
      loiMarkers: readMarkers(row, LOI_COLUMNS),
      propertyName,
      psetName,
      requirement: normalizeCatalogRequirement(row[5]),
      sourceRow: index + 1,
      sourceSheet: sheetName,
      tradeMarkers: readMarkers(row, TRADE_COLUMNS),
      unit: cleanCell(row[4]),
      valueType: normalizeIfcValueType(row[2]),
    });
  }
  return rules;
}

function looksLikePropertyRule(psetName: string, propertyName: string) {
  if (!psetName || !propertyName) {
    return false;
  }
  const psetToken = normalizeCatalogToken(psetName);
  const propertyToken = normalizeCatalogToken(propertyName);
  return (
    !psetToken.includes("propertyset") &&
    !propertyToken.includes("property") &&
    !propertyToken.includes("merkmal") &&
    (psetToken.startsWith("epset") || psetToken.startsWith("pset"))
  );
}

function readMarkers(
  row: unknown[],
  columns: Array<{ index: number; label: string }>,
) {
  return Object.fromEntries(
    columns.map((column) => [column.label, isMarkerSet(row[column.index])]),
  );
}

function isMarkerSet(value: unknown) {
  const token = normalizeCatalogToken(value);
  return token === "x" || token === "1" || token === "yes" || token === "ja";
}

function cleanCell(value: unknown) {
  return String(value ?? "").trim();
}

function catalogCodeSuffix(code: string) {
  return (
    cleanCell(code)
      .split("-")
      .pop()
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "") ?? ""
  );
}

function hasPropertySuffix(propertyName: string, suffix: string) {
  return propertyNameSuffix(propertyName) === suffix;
}

function propertyNameSuffix(propertyName: string) {
  return (
    cleanCell(propertyName)
      .match(/_([A-Z0-9]+)$/i)?.[1]
      ?.toUpperCase() ?? ""
  );
}

function makeCatalogId(value: string) {
  return (
    normalizeCatalogToken(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "catalog-object"
  );
}
