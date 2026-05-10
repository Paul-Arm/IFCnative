import * as WebIFC from 'web-ifc';

import { buildGeometryIndex } from './geometryIndex';
import { buildGraphIndex, summarizeLine } from './graphIndex';
import { preflightIfcBytes } from './preflight';
import { buildPropertyIndex } from './propertyIndex';
import type { IfcDiagnostic, IfcEntitySummary, IfcModelSession, StepHeaderSummary } from './types';
import { getWebIfcAPI } from './webIfcRuntime';

export interface OpenIfcModelOptions {
  data: Uint8Array;
  filename: string;
  loadGeometry?: boolean;
}

export async function openIfcModel(options: OpenIfcModelOptions): Promise<IfcModelSession> {
  const api = await getWebIfcAPI();
  const preflight = preflightIfcBytes(options.data);
  const diagnostics: IfcDiagnostic[] = [...preflight.diagnostics];

  if (!preflight.valid) {
    throw new Error(preflight.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  const modelID = api.OpenModel(options.data, {
    COORDINATE_TO_ORIGIN: false,
    CIRCLE_SEGMENTS: 24,
  });
  if (modelID < 0) {
    throw new Error('web-ifc could not open the model.');
  }

  const schema = api.GetModelSchema(modelID);
  const header = readWebIfcHeader(api, modelID, preflight.header);
  const { entities, entityCounts, entityDiagnostics } = readEntitySummaries(api, modelID);
  diagnostics.push(...entityDiagnostics);
  const graph = buildGraphIndex(api, modelID, entities, entityCounts);
  const properties = buildPropertyIndex(api, modelID, graph);
  const geometry = options.loadGeometry ? buildGeometryIndex(api, modelID, graph.byExpressID) : undefined;
  diagnostics.push(...graph.diagnostics, ...properties.diagnostics, ...(geometry?.diagnostics ?? []));

  return {
    api,
    modelID,
    filename: options.filename,
    size: options.data.byteLength,
    schema,
    header,
    preflight,
    graph,
    properties,
    geometry,
    diagnostics,
    save: () => api.SaveModel(modelID),
    close: () => api.CloseModel(modelID),
  };
}

export function loadGeometryForSession(session: IfcModelSession) {
  const geometry = buildGeometryIndex(session.api, session.modelID, session.graph.byExpressID);
  session.geometry = geometry;
  session.diagnostics = [...session.diagnostics, ...geometry.diagnostics];
  return geometry;
}

function readEntitySummaries(api: WebIFC.IfcAPI, modelID: number) {
  const entities: IfcEntitySummary[] = [];
  const entityCounts: { typeName: string; typeCode: number; count: number }[] = [];
  const entityDiagnostics: IfcDiagnostic[] = [];
  const types = api.GetAllTypesOfModel(modelID);

  for (const type of types) {
    try {
      const ids = api.GetLineIDsWithType(modelID, type.typeID);
      entityCounts.push({ typeName: type.typeName, typeCode: type.typeID, count: ids.size() });
      for (let index = 0; index < ids.size(); index += 1) {
        const expressID = ids.get(index);
        const line = api.GetLine(modelID, expressID) as Record<string, unknown>;
        const summary = summarizeLine(api, line);
        if (summary) {
          entities.push(summary);
        }
      }
    } catch (error) {
      entityDiagnostics.push({
        code: 'ENTITY_READ_FAILED',
        severity: 'warning',
        message: `Could not read ${type.typeName}: ${String(error)}`,
      });
    }
  }

  return {
    entities,
    entityCounts: entityCounts.sort((left, right) => right.count - left.count),
    entityDiagnostics,
  };
}

function readWebIfcHeader(
  api: WebIFC.IfcAPI,
  modelID: number,
  fallback: StepHeaderSummary,
): StepHeaderSummary {
  try {
    const schemaLine = api.GetHeaderLine(modelID, WebIFC.FILE_SCHEMA);
    const fileNameLine = api.GetHeaderLine(modelID, WebIFC.FILE_NAME);
    const descriptionLine = api.GetHeaderLine(modelID, WebIFC.FILE_DESCRIPTION);
    return {
      schema: readString(schemaLine?.arguments?.[0]?.[0]) ?? fallback.schema,
      fileName: readString(fileNameLine?.arguments?.[0]) ?? fallback.fileName,
      timestamp: readString(fileNameLine?.arguments?.[1]) ?? fallback.timestamp,
      authors: readStringArray(fileNameLine?.arguments?.[2], fallback.authors),
      organizations: readStringArray(fileNameLine?.arguments?.[3], fallback.organizations),
      preprocessorVersion:
        readString(fileNameLine?.arguments?.[4]) ?? fallback.preprocessorVersion,
      originatingSystem: readString(fileNameLine?.arguments?.[5]) ?? fallback.originatingSystem,
      authorization: readString(fileNameLine?.arguments?.[6]) ?? fallback.authorization,
      descriptions: readStringArray(descriptionLine?.arguments?.[0], fallback.descriptions),
    };
  } catch {
    return fallback;
  }
}

function readString(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && 'value' in value) {
    const raw = (value as { value?: unknown }).value;
    return typeof raw === 'string' ? raw : undefined;
  }
  return undefined;
}

function readStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.map(readString).filter((entry): entry is string => Boolean(entry));
}
