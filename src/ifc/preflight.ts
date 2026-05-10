import type { IfcDiagnostic, StepHeaderSummary, StepPreflightResult } from './types';

const SUPPORTED_SCHEMAS = new Set([
  'IFC2X3',
  'IFC2X_FINAL',
  'IFC4',
  'IFC4X1',
  'IFC4X2',
  'IFC4X2SCGL',
  'IFC4X3',
  'IFC4X3_ADD1',
  'IFC4X3_ADD2',
  'IFC4X3_RC1',
  'IFC4X3_RC2',
  'IFC4X3_RC3',
  'IFC4X3_RC4',
]);

export function decodeIfcBytes(data: Uint8Array) {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

export function preflightIfcText(text: string): StepPreflightResult {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const diagnostics: IfcDiagnostic[] = [];
  const hasIsoStart = /^\s*ISO-10303-21\s*;/i.test(normalized);
  const hasHeaderSection = /\bHEADER\s*;/i.test(normalized) && /\bENDSEC\s*;/i.test(normalized);
  const hasDataSection = /\bDATA\s*;/i.test(normalized);
  const hasIsoEnd = /\bEND-ISO-10303-21\s*;/i.test(normalized);
  const header = parseHeader(normalized);

  if (!hasIsoStart) {
    diagnostics.push({
      code: 'STEP_FRAME_START',
      severity: 'error',
      message: 'Missing ISO-10303-21 file start marker.',
    });
  }
  if (!hasHeaderSection) {
    diagnostics.push({
      code: 'STEP_HEADER_SECTION',
      severity: 'error',
      message: 'Missing HEADER section or HEADER terminator.',
    });
  }
  if (!hasDataSection) {
    diagnostics.push({
      code: 'STEP_DATA_SECTION',
      severity: 'error',
      message: 'Missing DATA section.',
    });
  }
  if (!hasIsoEnd) {
    diagnostics.push({
      code: 'STEP_FRAME_END',
      severity: 'error',
      message: 'Missing END-ISO-10303-21 file end marker.',
    });
  }
  if (!header.schema) {
    diagnostics.push({
      code: 'FILE_SCHEMA_MISSING',
      severity: 'error',
      message: 'FILE_SCHEMA could not be read from the header.',
    });
  } else if (!SUPPORTED_SCHEMAS.has(header.schema.toUpperCase())) {
    diagnostics.push({
      code: 'FILE_SCHEMA_UNSUPPORTED',
      severity: 'error',
      message: `Unsupported IFC schema "${header.schema}".`,
    });
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    header,
    diagnostics,
    hasIsoStart,
    hasHeaderSection,
    hasDataSection,
    hasIsoEnd,
  };
}

export function preflightIfcBytes(data: Uint8Array) {
  return preflightIfcText(decodeIfcBytes(data));
}

function parseHeader(text: string): StepHeaderSummary {
  const schemaArgs = extractEntityArguments(text, 'FILE_SCHEMA');
  const fileNameArgs = extractEntityArguments(text, 'FILE_NAME');
  const descriptionArgs = extractEntityArguments(text, 'FILE_DESCRIPTION');
  const schema = extractStrings(schemaArgs)[0];
  const fileNameStrings = splitTopLevelArguments(fileNameArgs).map((part) => extractStrings(part));

  return {
    schema,
    fileName: fileNameStrings[0]?.[0],
    timestamp: fileNameStrings[1]?.[0],
    authors: fileNameStrings[2] ?? [],
    organizations: fileNameStrings[3] ?? [],
    preprocessorVersion: fileNameStrings[4]?.[0],
    originatingSystem: fileNameStrings[5]?.[0],
    authorization: fileNameStrings[6]?.[0],
    descriptions: extractStrings(descriptionArgs),
  };
}

function extractEntityArguments(text: string, entityName: string) {
  const match = new RegExp(`${entityName}\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'i').exec(text);
  return match?.[1] ?? '';
}

function extractStrings(value: string) {
  const strings: string[] = [];
  const stringPattern = /'((?:''|[^'])*)'/g;
  let match = stringPattern.exec(value);
  while (match) {
    strings.push(match[1].replace(/''/g, "'"));
    match = stringPattern.exec(value);
  }
  return strings;
}

function splitTopLevelArguments(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === "'") {
      if (inString && next === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (!inString && char === '(') {
      depth += 1;
    } else if (!inString && char === ')') {
      depth -= 1;
    } else if (!inString && char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (value.trim()) {
    parts.push(value.slice(start).trim());
  }

  return parts;
}
