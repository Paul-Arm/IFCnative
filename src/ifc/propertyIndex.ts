import type * as WebIFC from 'web-ifc';

import type {
  IfcDiagnostic,
  IfcGraphIndex,
  IfcPropertyIndex,
  IfcPropertySetSummary,
  IfcPropertyValue,
} from './types';
import { asExpressID, ifcText, valueTypeName } from './utils';

export function buildPropertyIndex(api: WebIFC.IfcAPI, modelID: number, graph: IfcGraphIndex) {
  const diagnostics: IfcDiagnostic[] = [];
  const byObject = new Map<number, IfcPropertySetSummary[]>();
  const byType = new Map<number, IfcPropertySetSummary[]>();
  const units = readUnits(api, modelID, diagnostics);
  const materials = readAssociatedNames(api, modelID, graph.materialByObject);
  const classifications = readAssociatedNames(api, modelID, graph.classificationByObject);
  const documents = readAssociatedNames(api, modelID, graph.documentByObject);
  const relType = api.GetTypeCodeFromName('IFCRELDEFINESBYPROPERTIES');

  if (relType) {
    const ids = api.GetLineIDsWithType(modelID, relType);
    for (let index = 0; index < ids.size(); index += 1) {
      const relID = ids.get(index);
      const rel = safeLine(api, modelID, relID, false, diagnostics);
      const propertySetID = asExpressID(rel?.RelatingPropertyDefinition);
      const relatedObjects = Array.isArray(rel?.RelatedObjects) ? rel?.RelatedObjects : [];
      const propertySet = propertySetID
        ? readPropertySet(api, modelID, propertySetID, diagnostics)
        : undefined;
      if (!propertySet) {
        continue;
      }
      for (const relatedObject of relatedObjects) {
        const objectID = asExpressID(relatedObject);
        if (objectID) {
          byObject.set(objectID, [...(byObject.get(objectID) ?? []), propertySet]);
        }
      }
    }
  }

  for (const [typeID] of graph.typeAssignments) {
    const typeLine = safeLine(api, modelID, typeID, true, diagnostics);
    const propertySets = Array.isArray(typeLine?.HasPropertySets)
      ? typeLine.HasPropertySets.map((entry: unknown) =>
          typeof entry === 'object' && entry && 'expressID' in entry
            ? propertySetFromLine(entry as Record<string, unknown>)
            : undefined,
        ).filter(Boolean)
      : [];
    if (propertySets.length > 0) {
      byType.set(typeID, propertySets as IfcPropertySetSummary[]);
    }
  }

  return {
    byObject,
    byType,
    units,
    materials,
    classifications,
    documents,
    diagnostics,
  } satisfies IfcPropertyIndex;
}

function readPropertySet(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressID: number,
  diagnostics: IfcDiagnostic[],
) {
  const line = safeLine(api, modelID, expressID, true, diagnostics);
  return line ? propertySetFromLine(line) : undefined;
}

function propertySetFromLine(line: Record<string, unknown>): IfcPropertySetSummary {
  const typeName = line.type ? String(line.constructor?.name ?? 'PropertySet') : 'PropertySet';
  const values = [
    ...readProperties(Array.isArray(line.HasProperties) ? line.HasProperties : []),
    ...readQuantities(Array.isArray(line.Quantities) ? line.Quantities : []),
  ];

  return {
    expressID: Number(line.expressID),
    name: ifcText(line.Name) ?? `#${line.expressID}`,
    typeName,
    values,
  };
}

function readProperties(properties: unknown[]): IfcPropertyValue[] {
  return properties.map((property) => {
    const record = property as Record<string, unknown>;
    const value =
      ifcText(record.NominalValue) ??
      ifcText(record.EnumerationValues) ??
      ifcText(record.ListValues) ??
      ifcText(record.TableValues) ??
      ifcText(record.PropertyReference) ??
      '';
    return {
      name: ifcText(record.Name) ?? `#${record.expressID}`,
      value,
      valueType: valueTypeName(record.NominalValue),
      unit: ifcText(record.Unit),
    };
  });
}

function readQuantities(quantities: unknown[]): IfcPropertyValue[] {
  return quantities.map((quantity) => {
    const record = quantity as Record<string, unknown>;
    const valueKey =
      Object.keys(record).find((key) => key.endsWith('Value')) ??
      Object.keys(record).find((key) => key.endsWith('Area') || key.endsWith('Volume'));
    return {
      name: ifcText(record.Name) ?? `#${record.expressID}`,
      value: valueKey ? (ifcText(record[valueKey]) ?? '') : '',
      valueType: valueKey,
      unit: ifcText(record.Unit),
    };
  });
}

function readUnits(api: WebIFC.IfcAPI, modelID: number, diagnostics: IfcDiagnostic[]) {
  const unitType = api.GetTypeCodeFromName('IFCUNITASSIGNMENT');
  if (!unitType) {
    return [];
  }
  try {
    const ids = api.GetLineIDsWithType(modelID, unitType);
    const units: { expressID: number; label: string }[] = [];
    for (let index = 0; index < ids.size(); index += 1) {
      const line = api.GetLine(modelID, ids.get(index), true) as Record<string, unknown>;
      if (Array.isArray(line.Units)) {
        line.Units.forEach((unit) => {
          const record = unit as Record<string, unknown>;
          units.push({
            expressID: Number(record.expressID ?? line.expressID),
            label: [ifcText(record.UnitType), ifcText(record.Prefix), ifcText(record.Name)]
              .filter(Boolean)
              .join(' '),
          });
        });
      }
    }
    return units;
  } catch (error) {
    diagnostics.push({
      code: 'UNIT_READ_FAILED',
      severity: 'warning',
      message: `Could not read IfcUnitAssignment: ${String(error)}`,
    });
    return [];
  }
}

function readAssociatedNames(
  api: WebIFC.IfcAPI,
  modelID: number,
  associations: Map<number, number[]>,
) {
  const result = new Map<number, string[]>();
  for (const [objectID, associatedIDs] of associations) {
    result.set(
      objectID,
      associatedIDs.map((id) => {
        try {
          const line = api.GetLine(modelID, id) as Record<string, unknown>;
          return ifcText(line.Name) ?? ifcText(line.Identification) ?? ifcText(line.ItemReference) ?? `#${id}`;
        } catch {
          return `#${id}`;
        }
      }),
    );
  }
  return result;
}

function safeLine(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressID: number,
  flatten: boolean,
  diagnostics: IfcDiagnostic[],
) {
  try {
    return api.GetLine(modelID, expressID, flatten) as Record<string, unknown>;
  } catch (error) {
    diagnostics.push({
      code: 'LINE_READ_FAILED',
      severity: 'warning',
      expressID,
      message: `Could not read #${expressID}: ${String(error)}`,
    });
    return undefined;
  }
}
