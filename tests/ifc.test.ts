import assert from 'node:assert/strict';
import test from 'node:test';

import * as WebIFC from 'web-ifc';

import { createMinimalIfcProject } from '../src/ifc/builder';
import { buildGraphIndex, summarizeLine } from '../src/ifc/graphIndex';
import { preflightIfcText } from '../src/ifc/preflight';
import { buildPropertyIndex } from '../src/ifc/propertyIndex';
import type { IfcEntitySummary } from '../src/ifc/types';

test('preflight reads a valid IFC4X3_ADD2 header', () => {
  const result = preflightIfcText(createMinimalIfcProject({ name: 'Unit Test Project' }));

  assert.equal(result.valid, true);
  assert.equal(result.header.schema, 'IFC4X3_ADD2');
  assert.equal(result.hasIsoStart, true);
  assert.equal(result.hasHeaderSection, true);
  assert.equal(result.hasDataSection, true);
  assert.equal(result.hasIsoEnd, true);
});

test('preflight reports missing STEP markers', () => {
  const result = preflightIfcText('DATA; ENDSEC;');

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'STEP_FRAME_START'));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'FILE_SCHEMA_MISSING'));
});

test('web-ifc opens builder scaffold and graph indexes spatial hierarchy', async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const bytes = new TextEncoder().encode(createMinimalIfcProject({ name: 'Graph Test' }));
  const modelID = api.OpenModel(bytes);

  assert.ok(modelID >= 0);
  assert.equal(api.GetModelSchema(modelID), 'IFC4X3_ADD2');

  const { entities, counts } = readEntitySummaries(api, modelID);
  const graph = buildGraphIndex(api, modelID, entities, counts);
  const properties = buildPropertyIndex(api, modelID, graph);

  assert.equal(graph.spatialTree.length, 1);
  assert.equal(graph.spatialTree[0].typeName, 'IfcProject');
  assert.equal(graph.spatialTree[0].children[0].typeName, 'IfcSite');
  assert.equal(graph.spatialTree[0].children[0].children[0].typeName, 'IfcBuilding');
  assert.ok(properties.units.some((unit) => unit.label.includes('LENGTHUNIT')));
  assert.ok(properties.byObject.get(80)?.some((set) => set.name === 'IFCnative_Diagnostics'));
  assert.ok(
    properties.byObject
      .get(80)
      ?.some((set) => set.name === 'IFCnative_BaseQuantities' && set.values.some((value) => value.name === 'NetVolume')),
  );
  assert.ok(properties.materials.get(80)?.includes('Inspection Concrete'));
  assert.ok(properties.classifications.get(80)?.includes('Inspection Target'));
  assert.ok(properties.documents.get(80)?.includes('Inspection Report Placeholder'));
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  assert.ok(api.SaveModel(modelID).byteLength > 0);

  api.CloseModel(modelID);
});

function readEntitySummaries(api: WebIFC.IfcAPI, modelID: number) {
  const entities: IfcEntitySummary[] = [];
  const counts: Array<{ typeName: string; typeCode: number; count: number }> = [];

  for (const type of api.GetAllTypesOfModel(modelID)) {
    const ids = api.GetLineIDsWithType(modelID, type.typeID);
    counts.push({ typeName: type.typeName, typeCode: type.typeID, count: ids.size() });
    for (let index = 0; index < ids.size(); index += 1) {
      const summary = summarizeLine(api, api.GetLine(modelID, ids.get(index)));
      if (summary) {
        entities.push(summary);
      }
    }
  }

  return { entities, counts };
}

function streamGeometryVertexCount(api: WebIFC.IfcAPI, modelID: number) {
  let vertexCount = 0;
  api.StreamAllMeshes(modelID, (mesh) => {
    for (let index = 0; index < mesh.geometries.size(); index += 1) {
      const placed = mesh.geometries.get(index);
      const geometry = api.GetGeometry(modelID, placed.geometryExpressID);
      vertexCount += api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize()).length;
      geometry.delete();
    }
  });
  return vertexCount;
}
