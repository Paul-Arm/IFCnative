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

export function parseCatalogWorkbook(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): IfcObjectCatalog {
  const workbook = XLSX.read(arrayBuffer, { cellDates: false });
  const diagnostics: string[] = [];
  const objectTypes: CatalogObjectType[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });
    const parsed = parseObjectSheet(sheetName, rows);
    if (parsed) {
      objectTypes.push(parsed);
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

  return {
    diagnostics,
    fileName,
    importedAt: new Date().toISOString(),
    objectTypes,
  };
}

function parseObjectSheet(
  sheetName: string,
  rows: unknown[][],
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
  const propertyRules = readPropertyRules(sheetName, rows, id);

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

function makeCatalogId(value: string) {
  return (
    normalizeCatalogToken(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "catalog-object"
  );
}
