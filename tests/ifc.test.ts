import assert from "node:assert/strict";
import test from "node:test";

import * as WebIFC from "web-ifc";

import { createMinimalIfcProject } from "../src/ifc/builder";
import {
    previewEntityAwareDiffLines,
    summarizeEntityAwareDiff,
} from "../src/ifc/entityDiff";
import { buildGraphIndex, summarizeLine } from "../src/ifc/graphIndex";
import {
    addNativeBodyElement,
    addNativeClassification,
    addNativeDocumentReference,
    addNativeElement,
    addNativeMaterial,
    addNativePropertySet,
    addNativeQuantitySet,
    addNativeRelationship,
    addNativeSiUnit,
    addNativeTypeAssignment,
    assignNativeBodyRepresentation,
    createNativeSampleDocument,
    getNativePlacement,
    parseNativeIfcText,
    removeNativeRelationship,
    serializeNativeIfcDocument,
    updateNativePlacement,
    updateNativePropertyValue,
    updateNativeRelationship,
} from "../src/ifc/nativeDocument";
import { buildNativeGraphNeighborhood } from "../src/ifc/nativeGraph";
import { preflightIfcText } from "../src/ifc/preflight";
import { buildPropertyIndex } from "../src/ifc/propertyIndex";
import type { IfcEntitySummary } from "../src/ifc/types";

test("preflight reads a valid IFC4X3_ADD2 header", () => {
  const result = preflightIfcText(
    createMinimalIfcProject({ name: "Unit Test Project" }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.header.schema, "IFC4X3_ADD2");
  assert.equal(result.hasIsoStart, true);
  assert.equal(result.hasHeaderSection, true);
  assert.equal(result.hasDataSection, true);
  assert.equal(result.hasIsoEnd, true);
});

test("preflight reports missing STEP markers", () => {
  const result = preflightIfcText("DATA; ENDSEC;");

  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "STEP_FRAME_START",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "FILE_SCHEMA_MISSING",
    ),
  );
});

test("web-ifc opens builder scaffold and graph indexes spatial hierarchy", async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const bytes = new TextEncoder().encode(
    createMinimalIfcProject({ name: "Graph Test" }),
  );
  const modelID = api.OpenModel(bytes);

  assert.ok(modelID >= 0);
  assert.equal(api.GetModelSchema(modelID), "IFC4X3_ADD2");

  const { entities, counts } = readEntitySummaries(api, modelID);
  const graph = buildGraphIndex(api, modelID, entities, counts);
  const properties = buildPropertyIndex(api, modelID, graph);

  assert.equal(graph.spatialTree.length, 1);
  assert.equal(graph.spatialTree[0].typeName, "IfcProject");
  assert.equal(graph.spatialTree[0].children[0].typeName, "IfcSite");
  assert.equal(
    graph.spatialTree[0].children[0].children[0].typeName,
    "IfcBuilding",
  );
  assert.ok(properties.units.some((unit) => unit.label.includes("LENGTHUNIT")));
  assert.ok(
    properties.byObject
      .get(80)
      ?.some((set) => set.name === "IFCnative_Diagnostics"),
  );
  assert.ok(
    properties.byObject
      .get(80)
      ?.some(
        (set) =>
          set.name === "IFCnative_BaseQuantities" &&
          set.values.some((value) => value.name === "NetVolume"),
      ),
  );
  assert.ok(properties.materials.get(80)?.includes("Inspection Concrete"));
  assert.ok(properties.classifications.get(80)?.includes("Inspection Target"));
  assert.ok(
    properties.documents.get(80)?.includes("Inspection Report Placeholder"),
  );
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  assert.ok(api.SaveModel(modelID).byteLength > 0);

  api.CloseModel(modelID);
});

test("native document edits keep indexes live", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withElement = addNativeElement(sample, storey.id, "IFCWALL", "RN Wall");
  const wall = withElement.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "RN Wall",
  );
  assert.ok(wall);
  assert.ok(
    withElement.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === "IFCRELAGGREGATES"),
  );

  const withPset = addNativePropertySet(
    withElement,
    wall.id,
    "Pset_RN",
    "Status",
    "Live",
  );
  assert.equal(
    withPset.propertySetsByEntity.get(wall.id)?.[0].values[0].value,
    "IFCLABEL('Live')",
  );
  const propertyId = withPset.propertySetsByEntity.get(wall.id)?.[0].values[0]
    .id;
  assert.ok(propertyId);
  const withUpdatedProperty = updateNativePropertyValue(withPset, propertyId, {
    name: "StatusNote",
    value: "Reviewed",
    valueType: "IFCTEXT",
  });
  assert.equal(
    withUpdatedProperty.propertySetsByEntity.get(wall.id)?.[0].values[0].name,
    "StatusNote",
  );
  assert.equal(
    withUpdatedProperty.propertySetsByEntity.get(wall.id)?.[0].values[0].value,
    "IFCTEXT('Reviewed')",
  );

  const withQuantity = addNativeQuantitySet(
    withUpdatedProperty,
    wall.id,
    "Qto_RN",
    "ObservedLength",
    "12.5",
  );
  assert.ok(
    withQuantity.propertySetsByEntity
      .get(wall.id)
      ?.some(
        (set) =>
          set.kind === "Qto" &&
          set.values.some((value) => value.name === "ObservedLength"),
      ),
  );

  const withMaterial = addNativeMaterial(
    withQuantity,
    wall.id,
    "RN Concrete",
    "Concrete",
  );
  assert.ok(
    withMaterial.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Concrete")),
  );
  const withClassification = addNativeClassification(
    withMaterial,
    wall.id,
    "RN-001",
    "RN Class",
    "https://ifcnative.local/rn",
  );
  assert.ok(
    withClassification.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Class")),
  );
  const withDocument = addNativeDocumentReference(
    withClassification,
    wall.id,
    "RN-DOC",
    "RN Report",
    "https://ifcnative.local/doc",
  );
  assert.ok(
    withDocument.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Report")),
  );
  const withType = addNativeTypeAssignment(
    withDocument,
    wall.id,
    "RN Wall Type",
    "IFCTYPEOBJECT",
    "RN-WALL-TYPE",
  );
  assert.ok(
    withType.typeAssignmentsByEntity
      .get(wall.id)
      ?.some((assignment) => assignment.typeName === "RN Wall Type"),
  );

  const project = withType.entities.find(
    (entity) => entity.type === "IFCPROJECT",
  );
  assert.ok(project);
  const withRelation = addNativeRelationship(
    withType,
    "IFCRELASSIGNSTOGROUP",
    project.id,
    wall.id,
  );
  assert.ok(
    withRelation.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === "IFCRELASSIGNSTOGROUP"),
  );
  const groupRelationship = withRelation.relationshipsByEntity
    .get(wall.id)
    ?.find((relationship) => relationship.type === "IFCRELASSIGNSTOGROUP");
  assert.ok(groupRelationship);
  const withUpdatedRelationship = updateNativeRelationship(
    withRelation,
    groupRelationship.id,
    {
      sourceId: wall.id,
      targetId: project.id,
      type: "IFCRELDEFINESBYTYPE",
    },
  );
  assert.ok(
    withUpdatedRelationship.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === "IFCRELDEFINESBYTYPE"),
  );

  const withUnit = addNativeSiUnit(
    withUpdatedRelationship,
    "LENGTHUNIT",
    "$",
    "METRE",
  );
  assert.ok(withUnit.units.some((unit) => unit.includes("LENGTHUNIT")));

  const reopened = parseNativeIfcText(
    serializeNativeIfcDocument(withUnit),
    "roundtrip.ifc",
  );
  assert.ok(reopened.entityById.has(wall.id));
  assert.ok(
    reopened.propertySetsByEntity
      .get(wall.id)
      ?.some((set) => set.name === "Pset_RN"),
  );
  assert.ok(
    reopened.propertySetsByEntity
      .get(wall.id)
      ?.some((set) => set.name === "Qto_RN"),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Report")),
  );
  assert.ok(
    reopened.typeAssignmentsByEntity
      .get(wall.id)
      ?.some((assignment) => assignment.typeClass === "IFCTYPEOBJECT"),
  );
});

test("native type assignments are indexed, diffed, and endpoint-validated", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const typed = addNativeTypeAssignment(
    sample,
    block.id,
    "Inspection Type",
    "IFCTYPEOBJECT",
    "INSPECTION-TYPE",
  );
  const assignment = typed.typeAssignmentsByEntity.get(block.id)?.[0];
  assert.ok(assignment);
  assert.equal(assignment.typeName, "Inspection Type");
  assert.equal(assignment.objectIds[0], block.id);
  assert.ok(
    typed.relationshipsByEntity
      .get(block.id)
      ?.some((relationship) => relationship.type === "IFCRELDEFINESBYTYPE"),
  );
  assert.ok(
    typed.diagnostics.some((line) =>
      line.includes("Validation: no relationship or reference warnings"),
    ),
  );

  const diffSummary = summarizeEntityAwareDiff(
    serializeNativeIfcDocument(sample),
    serializeNativeIfcDocument(typed),
  );
  assert.ok(
    diffSummary.relationshipChanges.some(
      (change) => change.type === "IFCRELDEFINESBYTYPE",
    ),
  );

  const badRelationship = updateNativeRelationship(
    typed,
    assignment.relationshipId,
    { sourceId: block.id, targetId: block.id, type: "IFCRELDEFINESBYTYPE" },
  );
  assert.ok(
    badRelationship.diagnostics.some((line) =>
      line.includes("IFCRELDEFINESBYTYPE expects type object definitions"),
    ),
  );
});

test("native document diagnostics validate references, containment and relationship endpoints", () => {
  const sample = createNativeSampleDocument();
  assert.ok(
    sample.diagnostics.some((line) =>
      line.includes("Validation: no relationship or reference warnings"),
    ),
  );

  const building = sample.entities.find(
    (entity) => entity.type === "IFCBUILDING",
  );
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(building);
  assert.ok(storey);
  assert.ok(block);

  const withExtraStorey = addNativeElement(
    sample,
    building.id,
    "IFCBUILDINGSTOREY",
    "Validation Storey",
  );
  const secondStorey = withExtraStorey.entities.find(
    (entity) =>
      entity.type === "IFCBUILDINGSTOREY" &&
      entity.name === "Validation Storey",
  );
  assert.ok(secondStorey);
  const withSecondContainer = addNativeRelationship(
    withExtraStorey,
    "IFCRELCONTAINEDINSPATIALSTRUCTURE",
    secondStorey.id,
    block.id,
  );
  assert.ok(
    withSecondContainer.diagnostics.some((line) =>
      line.includes(`#${block.id} has multiple primary spatial containers`),
    ),
  );

  const withBadPropertyRelationship = updateNativeRelationship(
    withSecondContainer,
    withSecondContainer.relationships.at(-1)?.id ?? 0,
    {
      sourceId: block.id,
      targetId: storey.id,
      type: "IFCRELDEFINESBYPROPERTIES",
    },
  );
  assert.ok(
    withBadPropertyRelationship.diagnostics.some((line) =>
      line.includes(
        "IFCRELDEFINESBYPROPERTIES expects property or quantity definitions",
      ),
    ),
  );
});

test("native document stages relationship deletion without removing endpoints", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withElement = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "Delete Relation Wall",
  );
  const wall = withElement.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "Delete Relation Wall",
  );
  assert.ok(wall);
  const relationship = withElement.relationshipsByEntity
    .get(wall.id)
    ?.find((item) => item.type === "IFCRELAGGREGATES");
  assert.ok(relationship);

  const withoutRelationship = removeNativeRelationship(
    withElement,
    relationship.id,
  );
  assert.ok(withoutRelationship.entityById.has(wall.id));
  assert.ok(withoutRelationship.entityById.has(storey.id));
  assert.equal(withoutRelationship.entityById.has(relationship.id), false);
  assert.equal(
    withoutRelationship.relationshipsByEntity
      .get(wall.id)
      ?.some((item) => item.id === relationship.id) ?? false,
    false,
  );

  const summary = summarizeEntityAwareDiff(
    serializeNativeIfcDocument(withElement),
    serializeNativeIfcDocument(withoutRelationship),
  );
  assert.equal(summary.removedEntities, 1);
  assert.ok(
    summary.relationshipChanges.some(
      (change) => change.action === "removed" && change.id === relationship.id,
    ),
  );
});

test("native graph presets filter relationship neighborhoods", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withWall = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "Graph Filter Wall",
  );
  const wall = withWall.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "Graph Filter Wall",
  );
  assert.ok(wall);
  const withProperty = addNativePropertySet(
    withWall,
    wall.id,
    "Pset_GraphFilter",
    "Status",
    "Draft",
  );

  const spatial = buildNativeGraphNeighborhood(withProperty, {
    depth: 2,
    preset: "spatial",
    selectedId: storey.id,
  });
  assert.ok(spatial.nodeIds.includes(wall.id));
  assert.ok(
    spatial.edges.every(
      (edge) =>
        edge.type === "IFCRELAGGREGATES" ||
        edge.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE",
    ),
  );

  const properties = buildNativeGraphNeighborhood(withProperty, {
    depth: 1,
    preset: "properties",
    selectedId: wall.id,
  });
  assert.ok(
    properties.edges.some((edge) => edge.type === "IFCRELDEFINESBYPROPERTIES"),
  );
  assert.ok(properties.relationshipTypes.includes("IFCRELDEFINESBYPROPERTIES"));
  assert.ok(
    properties.edges.every(
      (edge) =>
        edge.type === "IFCRELDEFINESBYPROPERTIES" ||
        edge.type === "IFCRELDEFINESBYTYPE",
    ),
  );

  const explicit = buildNativeGraphNeighborhood(withProperty, {
    depth: 2,
    preset: "all",
    relationshipTypes: new Set(["IFCRELDEFINESBYPROPERTIES"]),
    selectedId: wall.id,
  });
  assert.deepEqual(explicit.relationshipTypes, ["IFCRELDEFINESBYPROPERTIES"]);
  assert.ok(explicit.edges.length > 0);
  assert.ok(
    explicit.edges.every((edge) => edge.type === "IFCRELDEFINESBYPROPERTIES"),
  );
});

test("entity-aware diff groups STEP changes by entity id", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withBody = addNativeBodyElement(sample, {
    depth: "1",
    height: "1",
    name: "Diff Block",
    parentId: storey.id,
    type: "IFCBUILDINGELEMENTPROXY",
    width: "1",
  });
  const lines = previewEntityAwareDiffLines(
    serializeNativeIfcDocument(sample),
    serializeNativeIfcDocument(withBody),
  );
  const text = lines.map((line) => line.text).join("\n");

  assert.ok(text.includes("Entity-aware STEP diff"));
  assert.ok(text.includes("IFCBUILDINGELEMENTPROXY"));
  assert.ok(text.includes("'Diff Block' added"));
  assert.ok(
    lines.some(
      (line) =>
        line.kind === "add" &&
        line.text.includes("IFCRELCONTAINEDINSPATIALSTRUCTURE"),
    ),
  );

  const summary = summarizeEntityAwareDiff(
    serializeNativeIfcDocument(sample),
    serializeNativeIfcDocument(withBody),
  );
  assert.ok(summary.addedEntities > 0);
  assert.ok(
    summary.relationshipChanges.some(
      (change) =>
        change.action === "added" &&
        change.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE",
    ),
  );
  assert.ok(
    summary.geometryChanges.some(
      (change) =>
        change.action === "added" &&
        change.type === "IFCEXTRUDEDAREASOLID" &&
        change.affectedProducts.some(
          (product) => product.name === "Diff Block",
        ),
    ),
  );
});

test("native body preset creates contained swept solid geometry", async () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withBody = addNativeBodyElement(sample, {
    depth: "2.5",
    height: "3",
    name: "Body Test Wall",
    parentId: storey.id,
    type: "IFCWALL",
    width: "5",
    x: "1",
    y: "2",
    z: "0",
  });
  const wall = withBody.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Body Test Wall",
  );
  assert.ok(wall);
  assert.equal(wall.args[5], `#${wall.id + 1}`);
  assert.equal(wall.args[6], `#${wall.id + 4}`);
  assert.ok(
    withBody.relationshipsByEntity
      .get(wall.id)
      ?.some(
        (relationship) =>
          relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE",
      ),
  );
  assert.ok(
    withBody.propertySetsByEntity
      .get(wall.id)
      ?.some((set) => set.kind === "Qto"),
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withBody)),
  );
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  api.CloseModel(modelID);
});

test("native body preset creates cylindrical swept solid geometry", async () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withCylinder = addNativeBodyElement(sample, {
    depth: "2",
    height: "4",
    name: "Body Test Column",
    parentId: storey.id,
    profile: "cylinder",
    type: "IFCCOLUMN",
    width: "2",
    x: "0",
    y: "0",
    z: "0",
  });
  const column = withCylinder.entities.find(
    (entity) =>
      entity.type === "IFCCOLUMN" && entity.name === "Body Test Column",
  );
  assert.ok(column);
  assert.ok(
    withCylinder.entities.some(
      (entity) =>
        entity.type === "IFCCIRCLEPROFILEDEF" && entity.args[3] === "1.",
    ),
  );
  assert.ok(
    withCylinder.propertySetsByEntity
      .get(column.id)
      ?.some((set) =>
        set.values.some(
          (value) => value.name === "NetVolume" && value.value === "12.5664",
        ),
      ),
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withCylinder)),
  );
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  api.CloseModel(modelID);
});

test("native body preset can spawn at world coordinates under a selected parent", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  const moved = updateNativePlacement(sample, block.id, {
    x: "10",
    y: "0",
    z: "0",
  });

  const withSpawn = addNativeBodyElement(moved, {
    depth: "1",
    height: "1",
    name: "Picked Spawn Body",
    parentId: block.id,
    placementMode: "world",
    type: "IFCBUILTELEMENT",
    width: "1",
    x: "2.6699",
    y: "0",
    z: "-0.6299",
  });
  const spawned = withSpawn.entities.find(
    (entity) =>
      entity.type === "IFCBUILTELEMENT" && entity.name === "Picked Spawn Body",
  );
  assert.ok(spawned);
  const placement = getNativePlacement(withSpawn, spawned.id);
  assert.ok(placement);
  assert.equal(placement.relativeTo, undefined);
  assert.equal(placement.x, 2.6699);
  assert.equal(placement.y, 0);
  assert.equal(placement.z, -0.6299);
  assert.ok(
    withSpawn.relationshipsByEntity
      .get(spawned.id)
      ?.some(
        (relationship) =>
          relationship.type === "IFCRELAGGREGATES" &&
          relationship.sourceIds.includes(block.id),
      ),
  );
});

test("native body assignment replaces selected product representation with reviewable quantities", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  const beforePlacement = getNativePlacement(sample, block.id);
  assert.ok(beforePlacement);

  const assigned = assignNativeBodyRepresentation(sample, block.id, {
    depth: "1.5",
    height: "2",
    profile: "rectangle",
    width: "3",
  });
  const afterBlock = assigned.entityById.get(block.id);
  assert.ok(afterBlock);
  assert.equal(afterBlock.globalId, block.globalId);
  assert.notEqual(afterBlock.args[6], block.args[6]);
  assert.equal(
    getNativePlacement(assigned, block.id)?.pointId,
    beforePlacement.pointId,
  );
  assert.equal(
    assigned.entityById.get(Number(afterBlock.args[6].slice(1)))?.type,
    "IFCPRODUCTDEFINITIONSHAPE",
  );
  assert.ok(
    assigned.propertySetsByEntity
      .get(block.id)
      ?.some(
        (set) =>
          set.kind === "Qto" &&
          set.values.some(
            (value) => value.name === "NetVolume" && value.value === "9.",
          ),
      ),
  );

  const diffSummary = summarizeEntityAwareDiff(
    serializeNativeIfcDocument(sample),
    serializeNativeIfcDocument(assigned),
  );
  assert.equal(diffSummary.changedEntities, 1);
  assert.ok(diffSummary.addedEntities >= 10);
  assert.ok(
    diffSummary.geometryChanges.some(
      (change) =>
        change.action === "added" &&
        change.type === "IFCPRODUCTDEFINITIONSHAPE" &&
        change.affectedProducts.some((product) => product.id === block.id),
    ),
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(assigned)),
  );
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  api.CloseModel(modelID);
});

test("native placement editor drafts numeric XYZ moves without rewriting product identity", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const beforePlacement = getNativePlacement(sample, block.id);
  assert.ok(beforePlacement);
  assert.equal(beforePlacement.x, 0);

  const moved = updateNativePlacement(sample, block.id, {
    x: "3.25",
    y: "-1.5",
    z: "0.75",
  });
  const afterPlacement = getNativePlacement(moved, block.id);
  assert.ok(afterPlacement);
  assert.equal(afterPlacement.productId, block.id);
  assert.equal(afterPlacement.placementId, beforePlacement.placementId);
  assert.equal(afterPlacement.pointId, beforePlacement.pointId);
  assert.equal(afterPlacement.x, 3.25);
  assert.equal(afterPlacement.y, -1.5);
  assert.equal(afterPlacement.z, 0.75);

  const diffText = previewEntityAwareDiffLines(
    serializeNativeIfcDocument(sample),
    serializeNativeIfcDocument(moved),
  )
    .map((line) => line.text)
    .join("\n");
  assert.ok(
    diffText.includes(`#${beforePlacement.pointId} IFCCARTESIANPOINT changed`),
  );
  assert.equal(moved.entityById.get(block.id)?.globalId, block.globalId);

  const diffSummary = summarizeEntityAwareDiff(
    serializeNativeIfcDocument(sample),
    serializeNativeIfcDocument(moved),
  );
  assert.deepEqual(diffSummary.placementChanges, [
    {
      after: [3.25, -1.5, 0.75],
      before: [0, 0, 0],
      affectedProducts: [
        {
          id: block.id,
          name: block.name,
          placementId: beforePlacement.placementId,
          type: block.type,
        },
      ],
      delta: [3.25, -1.5, 0.75],
      pointId: beforePlacement.pointId,
    },
  ]);

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(moved)),
  );
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  api.CloseModel(modelID);
});

function readEntitySummaries(api: WebIFC.IfcAPI, modelID: number) {
  const entities: IfcEntitySummary[] = [];
  const counts: Array<{ typeName: string; typeCode: number; count: number }> =
    [];

  for (const type of api.GetAllTypesOfModel(modelID)) {
    const ids = api.GetLineIDsWithType(modelID, type.typeID);
    counts.push({
      typeName: type.typeName,
      typeCode: type.typeID,
      count: ids.size(),
    });
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
      vertexCount += api.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      ).length;
      geometry.delete();
    }
  });
  return vertexCount;
}
