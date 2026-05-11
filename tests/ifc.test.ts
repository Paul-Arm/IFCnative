import assert from 'node:assert/strict';
import test from 'node:test';

import * as WebIFC from 'web-ifc';

import { createMinimalIfcProject } from '../src/ifc/builder';
import { previewEntityAwareDiffLines } from '../src/ifc/entityDiff';
import { buildGraphIndex, summarizeLine } from '../src/ifc/graphIndex';
import {
  addNativeElement,
  addNativeBodyElement,
  addNativeClassification,
  addNativeDocumentReference,
  addNativeMaterial,
  addNativePropertySet,
  addNativeQuantitySet,
  addNativeRelationship,
  addNativeSiUnit,
  createNativeSampleDocument,
  parseNativeIfcText,
  serializeNativeIfcDocument,
  updateNativePropertyValue,
  updateNativeRelationship,
} from '../src/ifc/nativeDocument';
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

test('native document edits keep indexes live', () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find((entity) => entity.type === 'IFCBUILDINGSTOREY');
  assert.ok(storey);

  const withElement = addNativeElement(sample, storey.id, 'IFCWALL', 'RN Wall');
  const wall = withElement.entities.find((entity) => entity.type === 'IFCWALL' && entity.name === 'RN Wall');
  assert.ok(wall);
  assert.ok(withElement.relationshipsByEntity.get(wall.id)?.some((relationship) => relationship.type === 'IFCRELAGGREGATES'));

  const withPset = addNativePropertySet(withElement, wall.id, 'Pset_RN', 'Status', 'Live');
  assert.equal(withPset.propertySetsByEntity.get(wall.id)?.[0].values[0].value, "IFCLABEL('Live')");
  const propertyId = withPset.propertySetsByEntity.get(wall.id)?.[0].values[0].id;
  assert.ok(propertyId);
  const withUpdatedProperty = updateNativePropertyValue(withPset, propertyId, {
    name: 'StatusNote',
    value: 'Reviewed',
    valueType: 'IFCTEXT',
  });
  assert.equal(withUpdatedProperty.propertySetsByEntity.get(wall.id)?.[0].values[0].name, 'StatusNote');
  assert.equal(withUpdatedProperty.propertySetsByEntity.get(wall.id)?.[0].values[0].value, "IFCTEXT('Reviewed')");

  const withQuantity = addNativeQuantitySet(withUpdatedProperty, wall.id, 'Qto_RN', 'ObservedLength', '12.5');
  assert.ok(
    withQuantity.propertySetsByEntity
      .get(wall.id)
      ?.some((set) => set.kind === 'Qto' && set.values.some((value) => value.name === 'ObservedLength')),
  );

  const withMaterial = addNativeMaterial(withQuantity, wall.id, 'RN Concrete', 'Concrete');
  assert.ok(withMaterial.resourcesByEntity.get(wall.id)?.some((resource) => resource.includes('RN Concrete')));
  const withClassification = addNativeClassification(withMaterial, wall.id, 'RN-001', 'RN Class', 'https://ifcnative.local/rn');
  assert.ok(withClassification.resourcesByEntity.get(wall.id)?.some((resource) => resource.includes('RN Class')));
  const withDocument = addNativeDocumentReference(withClassification, wall.id, 'RN-DOC', 'RN Report', 'https://ifcnative.local/doc');
  assert.ok(withDocument.resourcesByEntity.get(wall.id)?.some((resource) => resource.includes('RN Report')));

  const project = withDocument.entities.find((entity) => entity.type === 'IFCPROJECT');
  assert.ok(project);
  const withRelation = addNativeRelationship(withDocument, 'IFCRELASSIGNSTOGROUP', project.id, wall.id);
  assert.ok(
    withRelation.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === 'IFCRELASSIGNSTOGROUP'),
  );
  const groupRelationship = withRelation.relationshipsByEntity
    .get(wall.id)
    ?.find((relationship) => relationship.type === 'IFCRELASSIGNSTOGROUP');
  assert.ok(groupRelationship);
  const withUpdatedRelationship = updateNativeRelationship(withRelation, groupRelationship.id, {
    sourceId: wall.id,
    targetId: project.id,
    type: 'IFCRELDEFINESBYTYPE',
  });
  assert.ok(
    withUpdatedRelationship.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === 'IFCRELDEFINESBYTYPE'),
  );

  const withUnit = addNativeSiUnit(withUpdatedRelationship, 'LENGTHUNIT', '$', 'METRE');
  assert.ok(withUnit.units.some((unit) => unit.includes('LENGTHUNIT')));

  const reopened = parseNativeIfcText(serializeNativeIfcDocument(withUnit), 'roundtrip.ifc');
  assert.ok(reopened.entityById.has(wall.id));
  assert.ok(reopened.propertySetsByEntity.get(wall.id)?.some((set) => set.name === 'Pset_RN'));
  assert.ok(reopened.propertySetsByEntity.get(wall.id)?.some((set) => set.name === 'Qto_RN'));
  assert.ok(reopened.resourcesByEntity.get(wall.id)?.some((resource) => resource.includes('RN Report')));
});

test('entity-aware diff groups STEP changes by entity id', () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find((entity) => entity.type === 'IFCBUILDINGSTOREY');
  assert.ok(storey);

  const withBody = addNativeBodyElement(sample, {
    depth: '1',
    height: '1',
    name: 'Diff Block',
    parentId: storey.id,
    type: 'IFCBUILDINGELEMENTPROXY',
    width: '1',
  });
  const lines = previewEntityAwareDiffLines(serializeNativeIfcDocument(sample), serializeNativeIfcDocument(withBody));
  const text = lines.map((line) => line.text).join('\n');

  assert.ok(text.includes('Entity-aware STEP diff'));
  assert.ok(text.includes('IFCBUILDINGELEMENTPROXY'));
  assert.ok(text.includes("'Diff Block' added"));
  assert.ok(lines.some((line) => line.kind === 'add' && line.text.includes('IFCRELCONTAINEDINSPATIALSTRUCTURE')));
});

test('native body preset creates contained swept solid geometry', async () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find((entity) => entity.type === 'IFCBUILDINGSTOREY');
  assert.ok(storey);

  const withBody = addNativeBodyElement(sample, {
    depth: '2.5',
    height: '3',
    name: 'Body Test Wall',
    parentId: storey.id,
    type: 'IFCWALL',
    width: '5',
    x: '1',
    y: '2',
    z: '0',
  });
  const wall = withBody.entities.find((entity) => entity.type === 'IFCWALL' && entity.name === 'Body Test Wall');
  assert.ok(wall);
  assert.equal(wall.args[5], `#${wall.id + 1}`);
  assert.equal(wall.args[6], `#${wall.id + 4}`);
  assert.ok(
    withBody.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE'),
  );
  assert.ok(withBody.propertySetsByEntity.get(wall.id)?.some((set) => set.kind === 'Qto'));

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(withBody)));
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
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
