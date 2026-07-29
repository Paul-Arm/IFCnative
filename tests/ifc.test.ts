import assert from "node:assert/strict";
import test from "node:test";

import { Matrix4, Object3D, Vector3 } from "three";
import * as WebIFC from "web-ifc";

import { createBodyGeometry } from "../src/components/bodyGeometry";
import {
    createPositionMarkerProfile,
    polygonArea,
} from "../src/ifc/bodyProfiles";
import { createMinimalIfcProject } from "../src/ifc/builder";
import type { IfcObjectCatalog } from "../src/ifc/catalog";
import {
    ifcPlacementPointToViewerWorldPoint,
    viewerWorldDeltaToIfcPlacementDelta,
    viewerWorldDirectionToIfcPlacementDirection,
    viewerWorldPointToIfcPlacementPoint,
} from "../src/ifc/coordinateMapping";
import {
    addDiagnosticObjectiveReference,
    applyDiagnosticObjectInfo,
    buildDiagnosticObjectInfoDraft,
    buildDiagnosticSelectionContext,
    findDiagnosticObjectives,
    readDiagnosticObjectiveReferences,
    setDiagnosticObjectiveReferences,
    suggestDiagnosticProcedureCatalogObjects,
} from "../src/ifc/diagnosticsAssistant";
import {
    previewEntityAwareDiffLines,
    summarizeEntityAwareDiff,
} from "../src/ifc/entityDiff";
import {
    buildNativeDocumentFromFragments,
    type FragmentDocumentModel,
} from "../src/ifc/fragmentDocument";
import {
    fragmentModelPointToScene,
    fragmentScenePointToIfcWorld,
} from "../src/ifc/fragmentSceneCoordinates";
import { buildGraphIndex, summarizeLine } from "../src/ifc/graphIndex";
import {
    addNativeApproval,
    addNativeBodyElement,
    addNativeClassification,
    addNativeConstraintObjective,
    addNativeDocumentReference,
    addNativeElement,
    addNativeEmptyPropertySet,
    addNativeGroupAssignment,
    addNativeLibraryReference,
    addNativeMaterial,
    addNativeMaterialConstituentSet,
    addNativeMaterialLayerSet,
    addNativeMaterialLayerSetUsage,
    addNativeMaterialProfileSet,
    addNativeMaterialProfileSetUsage,
    addNativeMaterialStyle,
    addNativeMaterialWithProperties,
    addNativePropertySet,
    addNativePropertySetValues,
    addNativePropertyToSet,
    addNativeQuantitySet,
    addNativeRelationship,
    addNativeSiUnit,
    addNativeTypeAssignment,
    assignNativeBodyRepresentation,
    combineNativeBodyElements,
    createNativeSampleDocument,
    duplicateNativePropertySet,
    getNativeBodyRepresentation,
    getNativeLengthUnitScale,
    getNativePlacement,
    getNativePlacementWorld,
    getNativePlacementWorldFrame,
    nativeWorldDeltaInElementFrame,
    nativeWorldDirectionInPlacementParentFrame,
    nativeWorldToLocalPlacementPoint,
    parseNativeIfcText,
    planNativeEntityRemoval,
    quote,
    removeNativeBodyRepresentation,
    removeNativeEntity,
    removeNativePropertyFromSet,
    removeNativePropertySet,
    removeNativeRelationship,
    resolveNativeMovableProductId,
    serializeNativeIfcDocument,
    splitNativeBodyElement,
    summarizeNativeIfcGeometry,
    unquote,
    updateNativeEntity,
    updateNativePlacement,
    updateNativePlacementRotation,
    updateNativePlacementWorld,
    updateNativePropertySetName,
    updateNativePropertyValue,
    updateNativeRelationship,
} from "../src/ifc/nativeDocument";
import {
    buildNativeGraphNeighborhood,
    resolveNativeGraphAnchorId,
} from "../src/ifc/nativeGraph";
import {
    buildObjectInfoIndex,
    validateObjectInfoReferences,
} from "../src/ifc/objectInfoValidation";
import { preflightIfcText } from "../src/ifc/preflight";
import { buildPropertyIndex } from "../src/ifc/propertyIndex";
import { relationshipTypesForEndpointTypes } from "../src/ifc/relationshipRules";
import type { IfcEntitySummary } from "../src/ifc/types";

type FragmentStubItem = {
  GlobalId: { value: string };
  Name: { value: string };
  localId: { value: number };
  [key: string]: unknown;
};

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

test("native STEP strings decode and encode IFC umlaut escapes", () => {
  assert.equal(unquote("'Ma\\X\\DFnahme'"), "Maßnahme");
  assert.equal(unquote("'Br\\X2\\00FC00E400DF20AC\\X0\\cke'"), "Brüäß€cke");
  assert.equal(
    quote("Größe Prüfling €"),
    "'Gr\\X\\F6\\X\\DFe Pr\\X\\FCfling \\X2\\20AC\\X0\\'",
  );

  const document = parseNativeIfcText(
    [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
      "FILE_SCHEMA(('IFC4X3_ADD2'));",
      "ENDSEC;",
      "DATA;",
      "#1= IFCPROJECT('0IFCnative000000000001',$,'Br\\X\\FCcke \\X\\DF',$,$,$,$,$,$);",
      "#2= IFCPROPERTYSINGLEVALUE('_Ma\\X\\DFnahme',$,IFCTEXT('Gr\\X\\F6\\X\\DFe und \\X2\\20AC\\X0\\'),$);",
      "#3= IFCPROPERTYSET('0IFCnative000000000003',$,'Pset_\\X\\C4nderung',$,(#2));",
      "#4= IFCRELDEFINESBYPROPERTIES('0IFCnative000000000004',$,$,$,(#1),#3);",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n"),
    "umlaut.ifc",
  );

  assert.equal(document.entityById.get(1)?.name, "Brücke ß");
  assert.equal(document.propertySetsByEntity.get(1)?.[0].name, "Pset_Änderung");
  assert.deepEqual(document.propertySetsByEntity.get(1)?.[0].values[0], {
    id: 2,
    name: "_Maßnahme",
    type: "IFCPROPERTYSINGLEVALUE",
    value: "IFCTEXT('Größe und €')",
  });

  const updated = updateNativePropertyValue(document, 2, {
    name: "_Prüfung",
    value: "Änderung Größe €",
    valueType: "IFCTEXT",
  });
  const serialized = serializeNativeIfcDocument(updated);
  assert.ok(serialized.includes("'_Pr\\X\\FCfung'"));
  assert.ok(
    serialized.includes(
      "IFCTEXT('\\X\\C4nderung Gr\\X\\F6\\X\\DFe \\X2\\20AC\\X0\\')",
    ),
  );
  assert.equal(
    parseNativeIfcText(serialized, "roundtrip.ifc").propertySetsByEntity.get(
      1,
    )?.[0].values[0].value,
    "IFCTEXT('Änderung Größe €')",
  );

  const builderText = createMinimalIfcProject({
    name: "Brücke",
    products: [
      {
        name: "Prüfblock",
        properties: { Maßnahme: "Größe" },
      },
    ],
  });
  assert.ok(builderText.includes("Br\\X\\FCcke"));
  assert.ok(builderText.includes("Pr\\X\\FCfblock"));
  assert.ok(builderText.includes("Ma\\X\\DFnahme"));
  const builderDocument = parseNativeIfcText(builderText, "builder.ifc");
  assert.equal(builderDocument.entityById.get(80)?.name, "Prüfblock");
  assert.ok(
    builderDocument.propertySetsByEntity
      .get(80)
      ?.some((set) =>
        set.values.some(
          (value) =>
            value.name === "Maßnahme" && value.value === "IFCLABEL('Größe')",
        ),
      ),
  );
});

test("fragments adapter projects model data into the native document contract", async () => {
  const items = new Map<number, FragmentStubItem>();
  const project = fragmentItem(1, "Demo Project");
  const storey = fragmentItem(2, "Level 01");
  const wall = fragmentItem(3, "Basic Wall", {
    HasAssociations: [
      fragmentItem(12, "Catalog class", {
        Identification: { value: "B-123" },
        Location: { value: "openSIM BIM Objektkatalog" },
      }),
    ],
  });
  const pset = fragmentItem(10, "Pset_\\X\\C4nderung", {
    HasProperties: [
      fragmentItem(11, "Ma\\X\\DFnahme", {
        NominalValue: { value: "Gr\\X\\F6\\X\\DFe" },
        valueType: { value: "IFCLABEL" },
      }),
    ],
  });
  project.IsDecomposedBy = [storey];
  storey.ContainsElements = [wall];
  wall.IsDefinedBy = [pset];
  for (const item of [project, storey, wall, pset]) {
    items.set(Number((item.localId as { value: number }).value), item);
  }

  const categories = new Map([
    ["IFCPROJECT", [1]],
    ["IFCBUILDINGSTOREY", [2]],
    ["IFCWALL", [3]],
    ["IFCPROPERTYSET", [10]],
  ]);
  const model = {
    modelId: "demo-frag",
    getAttributeNames: async () => ["Name", "GlobalId"],
    getCategories: async () => [...categories.keys()],
    getGuidsByLocalIds: async (ids) => ids.map((id) => `guid-${id}`),
    getItemsData: async (ids) => ids.map((id) => items.get(id) ?? {}),
    getItemsOfCategories: async (patterns) => {
      const result: Record<string, number[]> = {};
      for (const [category, ids] of categories) {
        if (patterns.some((pattern) => pattern.test(category))) {
          result[category] = ids;
        }
      }
      return result;
    },
    getLocalIds: async () => [1, 2, 3, 10],
    getMetadata: async () => ({ schema: "IFC4X3_ADD2" }),
    getRelationNames: async () => [
      "IsDecomposedBy",
      "ContainsElements",
      "IsDefinedBy",
      "HasAssociations",
    ],
    getSpatialStructure: async () => ({
      category: "IFCPROJECT",
      localId: null,
      children: [
        {
          category: "IFCPROJECT",
          localId: 1,
          children: [
            {
              category: "IFCBUILDINGSTOREY",
              localId: 2,
              children: [{ category: "IFCWALL", localId: 3 }],
            },
          ],
        },
      ],
    }),
  } as FragmentDocumentModel;

  const document = await buildNativeDocumentFromFragments(model, {
    fileName: "demo.ifc",
  });

  assert.equal(document.schema, "IFC4X3_ADD2");
  assert.equal(document.entityById.get(3)?.type, "IFCWALL");
  assert.equal(document.entityById.get(3)?.name, "Basic Wall");
  assert.equal(document.spatialRoots[0]?.children[0]?.children[0]?.id, 3);
  assert.ok(
    document.relationships.some(
      (relationship) =>
        relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" &&
        relationship.sourceIds.includes(2) &&
        relationship.targetIds.includes(3),
    ),
  );
  assert.deepEqual(document.propertySetsByEntity.get(3)?.[0], {
    id: 10,
    kind: "IFCPROPERTYSET",
    name: "Pset_Änderung",
    values: [
      {
        id: 11,
        name: "Maßnahme",
        type: "IFCLABEL",
        value: "Größe",
      },
    ],
  });
  assert.equal(
    document.resourcesByEntity.get(3)?.[0],
    "B-123 openSIM BIM Objektkatalog",
  );
});

function fragmentItem(
  localId: number,
  name: string,
  extra: Record<string, unknown> = {},
): FragmentStubItem {
  return {
    GlobalId: { value: `guid-${localId}` },
    Name: { value: name },
    localId: { value: localId },
    ...extra,
  };
}

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

test("native document edits keep indexes live", async () => {
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
  assert.ok(getNativePlacement(withElement, wall.id));
  assert.equal(
    withElement.diagnostics.some((line) =>
      line.includes(`#${wall.id} IFCWALL has no ObjectPlacement`),
    ),
    false,
  );
  assert.ok(
    withElement.relationshipsByEntity
      .get(wall.id)
      ?.some(
        (relationship) =>
          relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE",
      ),
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
  const withMaterialProperties = addNativeMaterialWithProperties(
    withMaterial,
    wall.id,
    "RN Property Concrete",
    "Concrete",
    "RN Material Pset",
    "MassDensity | 2400 | IFCREAL\nFireRating | REI 90 | IFCLABEL",
  );
  assert.ok(
    withMaterialProperties.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("RN Property Concrete") &&
          resource.includes("RN Material Pset"),
      ),
  );
  assert.ok(
    withMaterialProperties.entities.some(
      (entity) =>
        entity.type === "IFCMATERIALPROPERTIES" &&
        entity.name === "RN Material Pset",
    ),
  );
  const withMaterialStyle = addNativeMaterialStyle(
    withMaterialProperties,
    wall.id,
    "RN Styled Concrete",
    "Concrete",
    "RN Blue Style",
    "#336699",
    "0.15",
  );
  assert.ok(
    withMaterialStyle.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("RN Styled Concrete") &&
          resource.includes("RN Blue Style"),
      ),
  );
  assert.ok(
    withMaterialStyle.entities.some(
      (entity) => entity.type === "IFCMATERIALDEFINITIONREPRESENTATION",
    ),
  );
  assert.ok(
    withMaterialStyle.entities.some(
      (entity) => entity.type === "IFCSURFACESTYLERENDERING",
    ),
  );
  assert.ok(
    withMaterialStyle.entities.some((entity) => entity.type === "IFCCOLOURRGB"),
  );
  const withLayerSet = addNativeMaterialLayerSet(
    withMaterialStyle,
    wall.id,
    "RN Layer Set",
    "Core | RN Concrete | 0.2 | LoadBearing\nFinish | RN Plaster | 0.02 | Finish",
  );
  assert.ok(
    withLayerSet.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Layer Set")),
  );
  const withProfileSet = addNativeMaterialProfileSet(
    withLayerSet,
    wall.id,
    "RN Profile Set",
    "RN Rectangle",
    "RN Steel",
    "LoadBearing",
    "0.2",
    "0.3",
  );
  assert.ok(
    withProfileSet.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Profile Set")),
  );
  const withLayerUsage = addNativeMaterialLayerSetUsage(
    withProfileSet,
    wall.id,
    "RN Layer Usage",
    "Core | RN Concrete | 0.2 | LoadBearing\nFinish | RN Plaster | 0.02 | Finish",
    "AXIS2",
    "POSITIVE",
    "0",
    "3",
  );
  assert.ok(
    withLayerUsage.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("IFCMATERIALLAYERSETUSAGE") &&
          resource.includes("RN Layer Usage"),
      ),
  );
  const withProfileUsage = addNativeMaterialProfileSetUsage(
    withLayerUsage,
    wall.id,
    "RN Profile Usage",
    "RN Rectangle Usage",
    "RN Usage Steel",
    "LoadBearing",
    "0.2",
    "0.3",
    "5",
    "4",
  );
  assert.ok(
    withProfileUsage.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("IFCMATERIALPROFILESETUSAGE") &&
          resource.includes("RN Profile Usage"),
      ),
  );
  const withConstituentSet = addNativeMaterialConstituentSet(
    withProfileUsage,
    wall.id,
    "RN Constituent Set",
    "Frame | RN Aluminium | 0.6 | Frame\nGlazing | RN Glass | 0.4 | Glazing",
  );
  assert.ok(
    withConstituentSet.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Constituent Set")),
  );
  const withClassification = addNativeClassification(
    withConstituentSet,
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
  const withLibrary = addNativeLibraryReference(
    withDocument,
    wall.id,
    "RN-LIB",
    "RN Library",
    "https://ifcnative.local/lib",
  );
  assert.ok(
    withLibrary.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Library")),
  );
  const withApproval = addNativeApproval(
    withLibrary,
    wall.id,
    "RN-APP",
    "RN Approval",
    "Approved",
  );
  assert.ok(
    withApproval.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Approval")),
  );
  const withConstraint = addNativeConstraintObjective(
    withApproval,
    wall.id,
    "RN Constraint",
    "HARD",
    "RN Spec",
    "REQUIREMENT",
    "EXPECTED PERFORMANCE",
  );
  assert.ok(
    withConstraint.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Constraint")),
  );
  const withGroup = addNativeGroupAssignment(
    withConstraint,
    wall.id,
    "IFCZONE",
    "RN Fire Zone",
    "Fire compartment",
    "RN Fire Compartment Level 1",
  );
  assert.ok(
    withGroup.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("IFCZONE") && resource.includes("RN Fire Zone"),
      ),
  );
  assert.ok(
    withGroup.relationshipsByEntity
      .get(wall.id)
      ?.some((relationship) => relationship.type === "IFCRELASSIGNSTOGROUP"),
  );
  assert.ok(
    withGroup.entities.some(
      (entity) => entity.type === "IFCZONE" && entity.args.length === 6,
    ),
  );
  const withType = addNativeTypeAssignment(
    withGroup,
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
  const resourceText = serializeNativeIfcDocument(withType);
  assert.ok(resourceText.includes("IFCMATERIALPROPERTIES"));
  assert.ok(resourceText.includes("RN Material Pset"));
  assert.ok(resourceText.includes("IFCMATERIALDEFINITIONREPRESENTATION"));
  assert.ok(resourceText.includes("IFCSTYLEDREPRESENTATION"));
  assert.ok(resourceText.includes("IFCSTYLEDITEM"));
  assert.ok(resourceText.includes("IFCSURFACESTYLE"));
  assert.ok(resourceText.includes("IFCSURFACESTYLERENDERING"));
  assert.ok(resourceText.includes("IFCCOLOURRGB"));
  assert.ok(resourceText.includes("IFCMATERIALLAYERSET"));
  assert.ok(resourceText.includes("IFCMATERIALLAYERSETUSAGE"));
  assert.ok(resourceText.includes("IFCMATERIALPROFILESET"));
  assert.ok(resourceText.includes("IFCMATERIALPROFILESETUSAGE"));
  assert.ok(resourceText.includes("IFCMATERIALCONSTITUENTSET"));
  assert.ok(resourceText.includes("IFCAPPROVAL"));
  assert.ok(resourceText.includes("IFCOBJECTIVE"));
  assert.ok(resourceText.includes("IFCZONE"));
  assert.ok(resourceText.includes("RN Fire Compartment Level 1"));
  assert.ok(resourceText.includes("IFCRELASSIGNSTOGROUP"));
  assert.ok(resourceText.includes("IFCRELASSOCIATESAPPROVAL"));
  assert.ok(resourceText.includes("IFCRELASSOCIATESCONSTRAINT"));

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
    ?.find(
      (relationship) =>
        relationship.type === "IFCRELASSIGNSTOGROUP" &&
        relationship.sourceIds.includes(project.id),
    );
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
      ?.some(
        (resource) =>
          resource.includes("RN Property Concrete") &&
          resource.includes("RN Material Pset"),
      ),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("RN Styled Concrete") &&
          resource.includes("RN Blue Style"),
      ),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Layer Set")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("IFCMATERIALLAYERSETUSAGE") &&
          resource.includes("RN Layer Usage"),
      ),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Profile Set")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("IFCMATERIALPROFILESETUSAGE") &&
          resource.includes("RN Profile Usage"),
      ),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Constituent Set")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Report")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Library")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Approval")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("RN Constraint")),
  );
  assert.ok(
    reopened.resourcesByEntity
      .get(wall.id)
      ?.some(
        (resource) =>
          resource.includes("IFCZONE") && resource.includes("RN Fire Zone"),
      ),
  );
  assert.ok(
    reopened.typeAssignmentsByEntity
      .get(wall.id)
      ?.some((assignment) => assignment.typeClass === "IFCTYPEOBJECT"),
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new TextEncoder().encode(resourceText));
  assert.ok(modelID >= 0);
  api.CloseModel(modelID);
});

test("native property editor authors extended IFC simple property types", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const withSet = addNativeEmptyPropertySet(
    sample,
    block.id,
    "Pset_ExtendedValues",
  );
  const set = withSet.propertySetsByEntity
    .get(block.id)
    ?.find((item) => item.name === "Pset_ExtendedValues");
  assert.ok(set);

  const withList = addNativePropertyToSet(
    withSet,
    set.id,
    "AllowedStatuses",
    "Draft; Reviewed; Approved",
    "IFCPROPERTYLISTVALUE:IFCLABEL",
  );
  const withEnum = addNativePropertyToSet(
    withList,
    set.id,
    "SelectedStatus",
    "Reviewed",
    "IFCPROPERTYENUMERATEDVALUE:IFCLABEL",
  );
  const withBounded = addNativePropertyToSet(
    withEnum,
    set.id,
    "TemperatureRange",
    "18..24; 21",
    "IFCPROPERTYBOUNDEDVALUE:IFCREAL",
  );
  const withTable = addNativePropertyToSet(
    withBounded,
    set.id,
    "LoadCurve",
    "0=>0; 1=>10; 2=>30",
    "IFCPROPERTYTABLEVALUE:IFCREAL:IFCREAL",
  );

  const values = withTable.propertySetsByEntity
    .get(block.id)
    ?.find((item) => item.name === "Pset_ExtendedValues")?.values;
  assert.ok(values?.some((value) => value.type === "IFCPROPERTYLISTVALUE"));
  assert.ok(
    values?.some((value) => value.type === "IFCPROPERTYENUMERATEDVALUE"),
  );
  assert.ok(values?.some((value) => value.type === "IFCPROPERTYBOUNDEDVALUE"));
  assert.ok(values?.some((value) => value.type === "IFCPROPERTYTABLEVALUE"));

  const listProperty = values?.find(
    (value) => value.name === "AllowedStatuses",
  );
  assert.ok(listProperty);
  const updated = updateNativePropertyValue(withTable, listProperty.id, {
    name: "AllowedStatuses",
    value: "Draft; Approved",
    valueType: "IFCPROPERTYLISTVALUE:IFCLABEL",
  });
  const serialized = serializeNativeIfcDocument(updated);
  assert.ok(serialized.includes("IFCPROPERTYLISTVALUE"));
  assert.ok(serialized.includes("IFCPROPERTYENUMERATEDVALUE"));
  assert.ok(serialized.includes("IFCPROPERTYBOUNDEDVALUE"));
  assert.ok(serialized.includes("IFCPROPERTYTABLEVALUE"));
  assert.ok(serialized.includes("IFCREAL(24)"));

  const reopened = parseNativeIfcText(serialized, "extended-values.ifc");
  const reopenedValues = reopened.propertySetsByEntity
    .get(block.id)
    ?.find((item) => item.name === "Pset_ExtendedValues")?.values;
  assert.ok(
    reopenedValues?.some(
      (value) =>
        value.name === "AllowedStatuses" &&
        value.type === "IFCPROPERTYLISTVALUE" &&
        value.value.includes("Approved"),
    ),
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new TextEncoder().encode(serialized));
  assert.ok(modelID >= 0);
  api.CloseModel(modelID);
});

test("native type assignments are indexed and endpoint-validated", () => {
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
  const typeChange = diffSummary.relationshipChanges.find(
    (change) => change.type === "IFCRELDEFINESBYTYPE",
  );
  assert.ok(typeChange);
  assert.ok(
    typeChange.afterSources?.some(
      (endpoint) =>
        endpoint.id === assignment.typeId && endpoint.type === "IFCTYPEOBJECT",
    ),
  );
  assert.ok(
    typeChange.afterTargets?.some(
      (endpoint) => endpoint.id === block.id && endpoint.type === block.type,
    ),
  );
  assert.ok(typeChange.after?.includes(`#${assignment.typeId} IFCTYPEOBJECT`));
  assert.ok(typeChange.after?.includes(`#${block.id} IFCBUILTELEMENT`));
  assert.ok(
    typed.relationships.some(
      (relationship) => relationship.type === "IFCRELDEFINESBYTYPE",
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

test("native document diagnostics flag unit/schema and physical product shape issues", () => {
  const sample = createNativeSampleDocument();
  const project = sample.entities.find(
    (entity) => entity.type === "IFCPROJECT",
  );
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(project);
  assert.ok(block);

  const broken = parseNativeIfcText(
    serializeNativeIfcDocument(sample)
      .replace("FILE_SCHEMA(('IFC4X3_ADD2'));", "")
      .replace(`,${project.args[8]});`, ",$);")
      .replace(`,${block.args[5]},${block.args[6]},`, ",$,$,"),
    "diagnostics.ifc",
  );

  assert.ok(
    broken.diagnostics.some((line) => line.includes("FILE_SCHEMA is missing")),
  );
  assert.ok(
    broken.diagnostics.some((line) =>
      line.includes("IFCPROJECT does not reference an IFCUNITASSIGNMENT"),
    ),
  );
  assert.ok(
    broken.diagnostics.some((line) =>
      line.includes(`#${block.id} IFCBUILTELEMENT has no ObjectPlacement`),
    ),
  );
  assert.ok(
    broken.diagnostics.some((line) =>
      line.includes(`#${block.id} IFCBUILTELEMENT has no Representation`),
    ),
  );

  const duplicateUnits = addNativeSiUnit(sample, "LENGTHUNIT", "$", "METRE");
  assert.ok(
    duplicateUnits.diagnostics.some((line) =>
      line.includes("IFCUNITASSIGNMENT has duplicate .LENGTHUNIT. units"),
    ),
  );
});

test("removing an entity cascades hierarchy children and referencing relationships", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withWall = addNativeBodyElement(sample, {
    depth: 0.3,
    height: 3,
    name: "Delete Me Wall",
    parentId: storey.id,
    placementMode: "parent",
    type: "IFCWALL",
    width: 4,
    x: 1,
    y: 2,
    z: 0,
  });
  const wall = withWall.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Delete Me Wall",
  );
  assert.ok(wall);

  const withMaterial = addNativeMaterial(
    withWall,
    wall.id,
    "Delete Me Material",
  );
  const materialRelationship = withMaterial.relationshipsByEntity
    .get(wall.id)
    ?.find((relationship) => relationship.type === "IFCRELASSOCIATESMATERIAL");
  assert.ok(materialRelationship);

  const plan = planNativeEntityRemoval(withMaterial, wall.id);
  assert.ok(plan);
  assert.ok(plan.removedEntityIds.includes(wall.id));
  assert.ok(plan.relationshipCount > 0);
  const removed = plan.document;
  assert.equal(
    serializeNativeIfcDocument(removed),
    serializeNativeIfcDocument(removeNativeEntity(withMaterial, wall.id)),
  );

  assert.equal(removed.entityById.has(wall.id), false);
  assert.equal(
    removed.relationships.some(
      (relationship) => relationship.id === materialRelationship.id,
    ),
    false,
  );
  assert.equal(
    removed.entities.some((entity) => entity.name === "Delete Me Wall"),
    false,
  );
  assert.equal(
    removed.entities.some((entity) => entity.name === "Delete Me Material"),
    true,
  );
});

test("removing one element keeps siblings that share its relationships", () => {
  // Real-world IFC files group many siblings into a single relationship:
  // one IfcRelContainedInSpatialStructure per storey, one shared material,
  // one shared pset. Deleting a single element must not drag the siblings out.
  const document = parseNativeIfcText(
    [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      "#1= IFCPROJECT('0IFCnative000000000001',$,'Project',$,$,$,$,$,$);",
      "#10= IFCBUILDINGSTOREY('0IFCnative000000000010',$,'Level 1',$,$,$,$,$,.ELEMENT.,0.);",
      "#20= IFCWALL('0IFCnative000000000020',$,'Wall A',$,$,$,$,$,.STANDARD.);",
      "#21= IFCWALL('0IFCnative000000000021',$,'Wall B',$,$,$,$,$,.STANDARD.);",
      "#30= IFCRELCONTAINEDINSPATIALSTRUCTURE('0IFCnative000000000030',$,$,$,(#20,#21),#10);",
      "#40= IFCMATERIAL('Concrete');",
      "#41= IFCRELASSOCIATESMATERIAL('0IFCnative000000000041',$,$,$,(#20,#21),#40);",
      "#50= IFCPROPERTYSET('0IFCnative000000000050',$,'Pset_Common',$,(#52));",
      "#52= IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);",
      "#51= IFCRELDEFINESBYPROPERTIES('0IFCnative000000000051',$,$,$,(#20,#21),#50);",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n"),
    "siblings.ifc",
  );

  const removed = removeNativeEntity(document, 20);

  // The deleted wall is gone, but its sibling and the shared resources survive.
  assert.equal(removed.entityById.has(20), false);
  assert.equal(removed.entityById.has(21), true);
  assert.equal(removed.entityById.has(40), true);
  assert.equal(removed.entityById.has(50), true);

  // Shared relationships are KEPT, with only the deleted member pruned out, so
  // the sibling stays spatially contained (i.e. still visible in the tree).
  const containment = removed.relationships.find(
    (relationship) => relationship.id === 30,
  );
  assert.ok(containment);
  assert.deepEqual(containment.targetIds, [21]);

  const material = removed.relationships.find(
    (relationship) => relationship.id === 41,
  );
  assert.ok(material);
  assert.deepEqual(material.sourceIds, [21]);

  const properties = removed.relationships.find(
    (relationship) => relationship.id === 51,
  );
  assert.ok(properties);
  assert.deepEqual(properties.sourceIds, [21]);

  const siblingRelationshipTypes = (
    removed.relationshipsByEntity.get(21) ?? []
  ).map((relationship) => relationship.type);
  assert.ok(
    siblingRelationshipTypes.includes("IFCRELCONTAINEDINSPATIALSTRUCTURE"),
  );
  assert.ok(siblingRelationshipTypes.includes("IFCRELASSOCIATESMATERIAL"));
});

test("removing an element garbage-collects its exclusive resources but keeps shared ones", () => {
  const document = parseNativeIfcText(
    [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      "#1= IFCPROJECT('0IFCnative000000000001',$,'Project',$,$,$,$,$,$);",
      "#10= IFCBUILDINGSTOREY('0IFCnative000000000010',$,'Level 1',$,$,#80,$,$,.ELEMENT.,0.);",
      "#20= IFCWALL('0IFCnative000000000020',$,'Wall A',$,$,#71,$,$,.STANDARD.);",
      "#21= IFCWALL('0IFCnative000000000021',$,'Wall B',$,$,$,$,$,.STANDARD.);",
      "#30= IFCRELCONTAINEDINSPATIALSTRUCTURE('0IFCnative000000000030',$,$,$,(#20,#21),#10);",
      // Shared origin point used by both the wall and the storey placement.
      "#76= IFCCARTESIANPOINT((0.,0.,0.));",
      "#80= IFCLOCALPLACEMENT($,#81);",
      "#81= IFCAXIS2PLACEMENT3D(#76,$,$);",
      // Placement that belongs only to wall #20.
      "#71= IFCLOCALPLACEMENT($,#75);",
      "#75= IFCAXIS2PLACEMENT3D(#76,$,$);",
      // Catalog material, associated only with the deleted wall.
      "#40= IFCMATERIAL('Concrete');",
      "#41= IFCRELASSOCIATESMATERIAL('0IFCnative000000000041',$,$,$,(#20),#40);",
      // Pset shared by both walls.
      "#50= IFCPROPERTYSET('0IFCnative000000000050',$,'Pset_Shared',$,(#52));",
      "#52= IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);",
      "#51= IFCRELDEFINESBYPROPERTIES('0IFCnative000000000051',$,$,$,(#20,#21),#50);",
      // Pset that belongs only to wall #20.
      "#60= IFCPROPERTYSET('0IFCnative000000000060',$,'Pset_Only20',$,(#62));",
      "#62= IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.F.),$);",
      "#61= IFCRELDEFINESBYPROPERTIES('0IFCnative000000000061',$,$,$,(#20),#60);",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n"),
    "orphans.ifc",
  );

  const removed = removeNativeEntity(document, 20);

  assert.equal(removed.entityById.has(20), false);
  assert.equal(removed.entityById.has(21), true);

  // Exclusive resources of the deleted wall are cleaned up …
  assert.equal(removed.entityById.has(60), false, "exclusive pset removed");
  assert.equal(
    removed.entityById.has(62),
    false,
    "exclusive pset value removed",
  );
  assert.equal(
    removed.entityById.has(71),
    false,
    "exclusive placement removed",
  );
  assert.equal(removed.entityById.has(75), false, "exclusive axis removed");

  // … while shared resources, catalog items and structural anchors survive.
  assert.equal(removed.entityById.has(50), true, "shared pset kept");
  assert.equal(removed.entityById.has(52), true, "shared pset value kept");
  assert.equal(removed.entityById.has(76), true, "shared origin point kept");
  assert.equal(removed.entityById.has(40), true, "catalog material kept");
  assert.equal(removed.entityById.has(10), true, "storey kept");

  // No dangling references remain in the surviving entities.
  assert.ok(
    removed.diagnostics.every((line) => !line.includes("references missing")),
  );
});

test("removing the only child keeps its parent in the hierarchy", () => {
  const document = parseNativeIfcText(
    [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      "#1= IFCPROJECT('0IFCnative000000000001',$,'Project',$,$,$,$,$,$);",
      "#15= IFCELEMENTASSEMBLY('0IFCnative000000000015',$,'Assembly',$,$,$,$,$,$,$);",
      "#20= IFCBEAM('0IFCnative000000000020',$,'Only Beam',$,$,$,$,$,$);",
      // The assembly is connected to its single child via this one relationship.
      "#30= IFCRELAGGREGATES('0IFCnative000000000030',$,$,$,#15,(#20));",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n"),
    "parent.ifc",
  );

  const removed = removeNativeEntity(document, 20);

  // The child is gone and its now-empty aggregation relationship is dropped …
  assert.equal(removed.entityById.has(20), false);
  assert.equal(
    removed.relationships.some((relationship) => relationship.id === 30),
    false,
  );
  // … but the parent assembly must NOT be garbage-collected with it.
  assert.equal(removed.entityById.has(15), true);
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

test("native document removes relationships without removing endpoints", () => {
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
    ?.find((item) => item.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE");
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

  assert.equal(
    serializeNativeIfcDocument(withoutRelationship).includes(
      `#${relationship.id}=`,
    ),
    false,
  );
  const summary = summarizeEntityAwareDiff(
    serializeNativeIfcDocument(withElement),
    serializeNativeIfcDocument(withoutRelationship),
  );
  assert.equal(summary.removedEntities, 1);
  const removed = summary.relationshipChanges.find(
    (change) => change.action === "removed" && change.id === relationship.id,
  );
  assert.ok(removed);
  assert.ok(
    removed.beforeSources?.some(
      (endpoint) => endpoint.id === storey.id && endpoint.type === storey.type,
    ),
  );
  assert.ok(
    removed.beforeTargets?.some(
      (endpoint) =>
        endpoint.id === wall.id && endpoint.name === "Delete Relation Wall",
    ),
  );
});

test("native document removes pset rows and selected pset relationships", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withWall = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "Pset UI Wall",
  );
  const wall = withWall.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Pset UI Wall",
  );
  assert.ok(wall);
  const withPset = addNativePropertySet(
    withWall,
    wall.id,
    "Pset_UI",
    "Status",
    "Draft",
  );
  const pset = withPset.propertySetsByEntity.get(wall.id)?.[0];
  const propertyId = pset?.values[0]?.id;
  const relationship = withPset.relationshipsByEntity
    .get(wall.id)
    ?.find((item) => item.type === "IFCRELDEFINESBYPROPERTIES");
  assert.ok(pset);
  assert.ok(propertyId);
  assert.ok(relationship);

  const withoutRow = removeNativePropertyFromSet(withPset, pset.id, propertyId);
  assert.equal(withoutRow.entityById.has(propertyId), false);
  assert.equal(
    withoutRow.propertySetsByEntity.get(wall.id)?.[0].values.length,
    0,
  );
  assert.equal(withoutRow.entityById.has(pset.id), true);
  assert.equal(withoutRow.entityById.has(relationship.id), true);

  const withoutPset = removeNativePropertySet(withPset, wall.id, pset.id);
  assert.equal(withoutPset.propertySetsByEntity.get(wall.id), undefined);
  assert.equal(withoutPset.entityById.has(propertyId), false);
  assert.equal(withoutPset.entityById.has(pset.id), false);
  assert.equal(withoutPset.entityById.has(relationship.id), false);
});

test("object info validation indexes definitions and ID references", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withTarget = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "ObjectInfo Target",
  );
  const target = withTarget.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "ObjectInfo Target",
  );
  assert.ok(target);
  const targetWithInfo = addNativePropertySetValues(
    withTarget,
    target.id,
    "ePset_Objektinformationen",
    [{ name: "_ID", value: "OBJ-TARGET" }],
  );

  const withSource = addNativeElement(
    targetWithInfo,
    storey.id,
    "IFCWALL",
    "ObjectInfo Source",
  );
  const source = withSource.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "ObjectInfo Source",
  );
  assert.ok(source);
  const sourceWithInfo = addNativePropertySetValues(
    withSource,
    source.id,
    "ePset_Objektinformationen",
    [
      { name: "_ID", value: "OBJ-SOURCE" },
      { name: "_TargetID", value: "OBJ-TARGET" },
      { name: "_ExternalID", value: "EXT-1" },
      { name: "_MissingID", value: "DOES-NOT-EXIST" },
    ],
  );
  const document = addNativePropertySetValues(
    sourceWithInfo,
    storey.id,
    "ePset_ExternalFamily",
    [{ name: "_ID", value: "EXT-1" }],
  );

  const index = buildObjectInfoIndex(document);
  assert.equal(
    index.definitionsByValue.get("OBJ-TARGET")?.[0].entityId,
    target.id,
  );
  const targetReference = index.references.find(
    (reference) => reference.propertyName === "_TargetID",
  );
  assert.equal(targetReference?.targetDefinitions[0]?.entityId, target.id);

  const findings = validateObjectInfoReferences(document);
  assert.ok(
    findings.some(
      (finding) =>
        finding.kind === "external-id-reference" && finding.value === "EXT-1",
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.kind === "missing-object-info-reference" &&
        finding.value === "DOES-NOT-EXIST",
    ),
  );
  assert.equal(
    findings.some(
      (finding) =>
        finding.kind === "missing-object-info-reference" &&
        finding.value === "OBJ-TARGET",
    ),
    false,
  );
});

test("object info validation accepts singular diagnostics object info psets", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withWall = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "Singular ObjectInfo",
  );
  const wall = withWall.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "Singular ObjectInfo",
  );
  assert.ok(wall);

  const document = addNativePropertySetValues(
    withWall,
    wall.id,
    "ePset_Objektinformation",
    [{ name: "_ID", value: "OBJ-SINGULAR" }],
  );

  const index = buildObjectInfoIndex(document);
  assert.equal(
    index.definitionsByValue.get("OBJ-SINGULAR")?.[0].entityId,
    wall.id,
  );
});

test("diagnostics assistant creates probe object info from US context", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withUs = addNativeElement(
    sample,
    storey.id,
    "IFCBUILDINGELEMENTPROXY",
    "US.01",
  );
  const us = withUs.entities.find(
    (entity) =>
      entity.type === "IFCBUILDINGELEMENTPROXY" && entity.name === "US.01",
  );
  assert.ok(us);
  const usWithInfo = applyDiagnosticObjectInfo(withUs, us.id, {
    bemerkung: "",
    bezeichnung: "US.01",
    id: "5692001.2.05387_02_FM_DIA_2012.US.01",
    role: "untersuchungsstelle",
  });
  const withProbe = addNativeElement(
    usWithInfo,
    us.id,
    "IFCBUILDINGELEMENTPROXY",
    "Probe01.01",
  );
  const probe = withProbe.entities.find(
    (entity) =>
      entity.type === "IFCBUILDINGELEMENTPROXY" && entity.name === "Probe01.01",
  );
  assert.ok(probe);

  const draft = buildDiagnosticObjectInfoDraft(withProbe, probe.id, "probe");
  assert.equal(draft.id, "5692001.2.05387_02_FM_DIA_2012.Probe01.01");
  assert.equal(
    draft.untersuchungsstelleId,
    "5692001.2.05387_02_FM_DIA_2012.US.01",
  );

  const document = applyDiagnosticObjectInfo(withProbe, probe.id, draft);
  const pset = document.propertySetsByEntity
    .get(probe.id)
    ?.find((set) => set.name === "ePset_Objektinformation");
  assert.ok(pset);
  assert.deepEqual(
    pset.values.map((value) => [value.name, value.value]),
    [
      ["_ID", "IFCLABEL('5692001.2.05387_02_FM_DIA_2012.Probe01.01')"],
      [
        "_UntersuchungsstelleID",
        "IFCLABEL('5692001.2.05387_02_FM_DIA_2012.US.01')",
      ],
      ["_Bezeichnung", "IFCLABEL('Probe01.01')"],
      ["_Bemerkung", "IFCTEXT('')"],
    ],
  );
});

test("diagnostics assistant detects existing site and probe role psets", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withSite = addNativeElement(
    sample,
    storey.id,
    "IFCBUILDINGELEMENTPROXY",
    "Legacy Site",
  );
  const site = withSite.entities.find(
    (entity) =>
      entity.type === "IFCBUILDINGELEMENTPROXY" &&
      entity.name === "Legacy Site",
  );
  assert.ok(site);
  const siteDocument = addNativePropertySetValues(
    withSite,
    site.id,
    "ePset_Untersuchungsstelle",
    [{ name: "_Status_US", value: "angelegt" }],
  );
  const siteContext = buildDiagnosticSelectionContext(siteDocument, site.id);
  assert.equal(siteContext.detectedRole, "untersuchungsstelle");
  assert.equal(siteContext.detectedRoleReason, "ePset_Untersuchungsstelle");
  assert.equal(siteContext.procedures.length, 0);

  const withProbe = addNativeElement(
    siteDocument,
    storey.id,
    "IFCBUILDINGELEMENTPROXY",
    "Legacy Probe",
  );
  const probe = withProbe.entities.find(
    (entity) =>
      entity.type === "IFCBUILDINGELEMENTPROXY" &&
      entity.name === "Legacy Probe",
  );
  assert.ok(probe);
  const probeDocument = addNativePropertySetValues(
    withProbe,
    probe.id,
    "ePset_Probe",
    [{ name: "_Status_PR", value: "angelegt" }],
  );
  const probeContext = buildDiagnosticSelectionContext(probeDocument, probe.id);
  assert.equal(probeContext.detectedRole, "probe");
  assert.equal(probeContext.detectedRoleReason, "ePset_Probe");
  assert.equal(probeContext.procedures.length, 0);
});

test("diagnostics assistant summarizes objectives and procedure catalog entries", () => {
  const sample = createNativeSampleDocument();
  const building = sample.entitiesByType.get("IFCBUILDING")?.[0];
  assert.ok(building);
  const withObjective = addNativePropertySetValues(
    sample,
    building.id,
    "ePset_Untersuchungsziel01",
    [
      { name: "_ID", value: "UZ-01" },
      { name: "_Bezeichnung", value: "Druckfestigkeit" },
    ],
  );
  const objectives = findDiagnosticObjectives(withObjective, building.id);
  assert.deepEqual(objectives, [
    {
      id: objectives[0].id,
      label: "Druckfestigkeit",
      objectInfoId: "UZ-01",
      psetName: "ePset_Untersuchungsziel01",
    },
  ]);

  const catalog: IfcObjectCatalog = {
    diagnostics: [],
    fileName: "catalog.xlsx",
    importedAt: "2026-06-04T00:00:00.000Z",
    kind: "diagnostik",
    objectTypes: [
      catalogObject(
        "bwd-dfk",
        "Druckfestigkeit",
        "BWD - DFK",
        "ePset_Druckfestigkeit",
      ),
      catalogObject(
        "bwd-us",
        "Untersuchungsstelle",
        "BWD - US",
        "ePset_Objektinformation",
      ),
    ],
  };
  assert.deepEqual(
    suggestDiagnosticProcedureCatalogObjects(catalog).map(
      (objectType) => objectType.id,
    ),
    ["bwd-dfk"],
  );

  const context = buildDiagnosticSelectionContext(withObjective, building.id);
  assert.equal(context.objectives[0].label, "Druckfestigkeit");
});

test("diagnostics assistant stores objective IDs as one semicolon list", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withProbe = addNativeElement(
    sample,
    storey.id,
    "IFCBUILDINGELEMENTPROXY",
    "Probe01.01",
  );
  const probe = withProbe.entities.find(
    (entity) =>
      entity.type === "IFCBUILDINGELEMENTPROXY" && entity.name === "Probe01.01",
  );
  assert.ok(probe);
  const withProcedure = addNativePropertySetValues(
    withProbe,
    probe.id,
    "ePset_Druckfestigkeit",
    [
      {
        name: "_UntersuchungszielID",
        value: "5692001.2.05387_02_FM_DIA_2012.Baustoffeigenschaften",
      },
    ],
  );
  const procedureSet = withProcedure.propertySetsByEntity
    .get(probe.id)
    ?.find((set) => set.name === "ePset_Druckfestigkeit");
  assert.ok(procedureSet);
  assert.deepEqual(readDiagnosticObjectiveReferences(procedureSet), [
    "5692001.2.05387_02_FM_DIA_2012.Baustoffeigenschaften",
  ]);

  const updated = addDiagnosticObjectiveReference(
    withProcedure,
    probe.id,
    procedureSet.id,
    "5692001.2.05387_02_FM_DIA_2012.Dauerhaftigkeit",
  );
  const updatedSet = updated.propertySetsByEntity
    .get(probe.id)
    ?.find((set) => set.id === procedureSet.id);
  assert.ok(updatedSet);
  assert.equal(
    updatedSet.values.filter((value) =>
      value.name.toLowerCase().startsWith("_untersuchungszielid"),
    ).length,
    1,
  );
  assert.deepEqual(updatedSet.values[0], {
    id: updatedSet.values[0].id,
    name: "_UntersuchungszielIDs",
    type: "IFCPROPERTYSINGLEVALUE",
    value:
      "IFCLABEL('5692001.2.05387_02_FM_DIA_2012.Baustoffeigenschaften; 5692001.2.05387_02_FM_DIA_2012.Dauerhaftigkeit')",
  });
  assert.deepEqual(readDiagnosticObjectiveReferences(updatedSet), [
    "5692001.2.05387_02_FM_DIA_2012.Baustoffeigenschaften",
    "5692001.2.05387_02_FM_DIA_2012.Dauerhaftigkeit",
  ]);

  const replaced = setDiagnosticObjectiveReferences(
    updated,
    probe.id,
    procedureSet.id,
    [
      "5692001.2.05387_02_FM_DIA_2012.Tragfaehigkeit",
      "5692001.2.05387_02_FM_DIA_2012.Tragfaehigkeit",
    ],
  );
  const replacedSet = replaced.propertySetsByEntity
    .get(probe.id)
    ?.find((set) => set.id === procedureSet.id);
  assert.ok(replacedSet);
  assert.deepEqual(readDiagnosticObjectiveReferences(replacedSet), [
    "5692001.2.05387_02_FM_DIA_2012.Tragfaehigkeit",
  ]);

  const cleared = setDiagnosticObjectiveReferences(
    replaced,
    probe.id,
    procedureSet.id,
    [],
  );
  const clearedSet = cleared.propertySetsByEntity
    .get(probe.id)
    ?.find((set) => set.id === procedureSet.id);
  assert.ok(clearedSet);
  assert.deepEqual(readDiagnosticObjectiveReferences(clearedSet), []);
});

function catalogObject(
  id: string,
  name: string,
  code: string,
  psetName: string,
) {
  return {
    code,
    id,
    ifcClass: "IFCBUILDINGELEMENTPROXY",
    name,
    propertyRules: [
      {
        format: "",
        id: `${id}-property`,
        loiMarkers: {},
        propertyName: "_Datum_DFK",
        psetName,
        requirement: "required" as const,
        sourceRow: 1,
        sourceSheet: "Alle Merkmale (Propertys)",
        tradeMarkers: {},
        unit: "",
        valueType: "IFCDATE",
      },
    ],
    sheetName: "Alle Merkmale (Propertys)",
    version: "",
  };
}

test("object info validation reports duplicate and empty object info IDs", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withFirst = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "Duplicate ObjectInfo A",
  );
  const first = withFirst.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "Duplicate ObjectInfo A",
  );
  assert.ok(first);
  const firstWithInfo = addNativePropertySetValues(
    withFirst,
    first.id,
    "ePset_Objektinformationen",
    [{ name: "_ID", value: "DUPLICATE-ID" }],
  );

  const withSecond = addNativeElement(
    firstWithInfo,
    storey.id,
    "IFCWALL",
    "Duplicate ObjectInfo B",
  );
  const second = withSecond.entities.find(
    (entity) =>
      entity.type === "IFCWALL" && entity.name === "Duplicate ObjectInfo B",
  );
  assert.ok(second);
  const secondWithInfo = addNativePropertySetValues(
    withSecond,
    second.id,
    "ePset_Objektinformationen",
    [{ name: "_ID", value: "DUPLICATE-ID" }],
  );

  const withEmpty = addNativeElement(
    secondWithInfo,
    storey.id,
    "IFCWALL",
    "Empty ObjectInfo",
  );
  const empty = withEmpty.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Empty ObjectInfo",
  );
  assert.ok(empty);
  const document = addNativePropertySetValues(
    withEmpty,
    empty.id,
    "ePset_Objektinformationen",
    [{ name: "_ID", value: "-" }],
  );

  const findings = validateObjectInfoReferences(document);
  assert.ok(
    findings.some(
      (finding) =>
        finding.kind === "duplicate-object-info-id" &&
        finding.value === "DUPLICATE-ID" &&
        finding.severity === "error",
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.kind === "empty-object-info-id" &&
        finding.entityId === empty.id,
    ),
  );
});

test("native document renames and duplicates property sets", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withWall = addNativeElement(
    sample,
    storey.id,
    "IFCWALL",
    "Pset Copy Wall",
  );
  const wall = withWall.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Pset Copy Wall",
  );
  assert.ok(wall);
  const withPset = addNativePropertySet(
    withWall,
    wall.id,
    "Pset_Original",
    "Status",
    "Draft",
  );
  const pset = withPset.propertySetsByEntity.get(wall.id)?.[0];
  assert.ok(pset);

  const renamed = updateNativePropertySetName(
    withPset,
    pset.id,
    "Pset_Renamed",
  );
  assert.equal(renamed.entityById.get(pset.id)?.name, "Pset_Renamed");
  assert.equal(
    renamed.propertySetsByEntity.get(wall.id)?.[0].name,
    "Pset_Renamed",
  );

  const duplicated = duplicateNativePropertySet(
    renamed,
    wall.id,
    pset.id,
    "Pset_Renamed Copy",
  );
  const sets = duplicated.propertySetsByEntity.get(wall.id) ?? [];
  assert.equal(sets.length, 2);
  const copy = sets.find((set) => set.name === "Pset_Renamed Copy");
  assert.ok(copy);
  assert.notEqual(copy.id, pset.id);
  assert.deepEqual(
    copy.values.map((value) => [value.name, value.value]),
    [["Status", "IFCLABEL('Draft')"]],
  );
  assert.notEqual(copy.values[0].id, pset.values[0].id);
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
    properties.edges.every((edge) => edge.type === "IFCRELDEFINESBYTYPE"),
  );
  assert.deepEqual(properties.relationshipTypes, ["IFCRELDEFINESBYTYPE"]);
  const attachedSet = withProperty.propertySetsByEntity.get(wall.id)?.[0];
  assert.ok(attachedSet);
  assert.ok(!properties.nodeIds.includes(attachedSet.id));
  assert.equal(
    resolveNativeGraphAnchorId(withProperty, attachedSet.id),
    wall.id,
  );
  assert.equal(
    resolveNativeGraphAnchorId(withProperty, attachedSet.values[0].id),
    wall.id,
  );

  const explicit = buildNativeGraphNeighborhood(withProperty, {
    depth: 2,
    preset: "all",
    relationshipTypes: new Set(["IFCRELDEFINESBYPROPERTIES"]),
    selectedId: wall.id,
  });
  assert.deepEqual(explicit.relationshipTypes, ["IFCRELDEFINESBYPROPERTIES"]);
  assert.deepEqual(explicit.edges, []);
  assert.deepEqual(explicit.nodeIds, [wall.id]);

  const withMaterial = addNativeMaterial(
    withProperty,
    wall.id,
    "Graph Concrete",
    "Concrete",
  );
  const withClassification = addNativeClassification(
    withMaterial,
    wall.id,
    "GRAPH-001",
    "Graph Classification",
    "https://example.test/classification",
  );
  const withDocument = addNativeDocumentReference(
    withClassification,
    wall.id,
    "GRAPH-DOC",
    "Graph Document",
    "https://example.test/document",
  );
  const resources = buildNativeGraphNeighborhood(withDocument, {
    depth: 1,
    preset: "resources",
    selectedId: wall.id,
  });
  const embeddedResourceTypes = new Set([
    "IFCRELASSOCIATESMATERIAL",
    "IFCRELASSOCIATESCLASSIFICATION",
    "IFCRELASSOCIATESDOCUMENT",
  ]);
  const embeddedResourceIds = withDocument.relationships
    .filter(
      (relationship) =>
        embeddedResourceTypes.has(relationship.type) &&
        relationship.sourceIds.includes(wall.id),
    )
    .flatMap((relationship) => relationship.targetIds);
  assert.ok(embeddedResourceIds.length >= 3);
  assert.ok(embeddedResourceIds.every((id) => !resources.nodeIds.includes(id)));
  assert.ok(
    embeddedResourceIds.every(
      (id) => resolveNativeGraphAnchorId(withDocument, id) === wall.id,
    ),
  );
  assert.ok(
    resources.edges.every((edge) => !embeddedResourceTypes.has(edge.type)),
  );
});

test("native graph expands from indexed relationships without scanning the relationship array", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const withResource = addNativeApproval(
    sample,
    block.id,
    "GRAPH-APPROVAL",
    "Graph Approval",
    "Approved",
  );
  const approval = withResource.entities.find(
    (entity) =>
      entity.type === "IFCAPPROVAL" && entity.name === "Graph Approval",
  );
  assert.ok(approval);

  const indexedOnly = { ...withResource, relationships: [] };
  const graph = buildNativeGraphNeighborhood(indexedOnly, {
    depth: 1,
    preset: "resources",
    selectedId: block.id,
  });

  assert.ok(graph.nodeIds.includes(approval.id));
  assert.ok(
    graph.edges.some((edge) => edge.type === "IFCRELASSOCIATESAPPROVAL"),
  );
  assert.ok(graph.relationshipTypes.includes("IFCRELASSOCIATESAPPROVAL"));
});

test("native graph geometry preset expands placement and representation references", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const placement = getNativePlacement(sample, block.id);
  assert.ok(placement);

  const graph = buildNativeGraphNeighborhood(sample, {
    depth: 4,
    preset: "geometry",
    selectedId: block.id,
  });

  assert.ok(graph.nodeIds.includes(placement.placementId));
  assert.ok(graph.nodeIds.includes(placement.axisPlacementId));
  assert.ok(graph.nodeIds.includes(placement.pointId));
  assert.ok(graph.nodeIds.includes(Number(block.args[6].slice(1))));
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.type === "IFCREFGEOMETRY" && edge.label === "ObjectPlacement",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.type === "IFCREFGEOMETRY" && edge.label === "Representation",
    ),
  );
  assert.ok(graph.relationshipTypes.includes("IFCLOCALPLACEMENT"));
});

test("native graph surfaces visible relationship validation warnings", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const typed = addNativeTypeAssignment(
    sample,
    block.id,
    "Graph Warning Type",
    "IFCTYPEOBJECT",
    "WARN-TYPE",
  );
  const assignment = typed.typeAssignmentsByEntity.get(block.id)?.[0];
  assert.ok(assignment);

  const broken = updateNativeRelationship(typed, assignment.relationshipId, {
    sourceId: block.id,
    targetId: block.id,
    type: "IFCRELDEFINESBYTYPE",
  });
  const graph = buildNativeGraphNeighborhood(broken, {
    depth: 1,
    preset: "all",
    selectedId: block.id,
  });

  assert.ok(
    graph.warnings.some(
      (warning) => warning.relationshipId === assignment.relationshipId,
    ),
  );
  assert.ok(
    graph.warnings.some((warning) =>
      warning.message.includes(
        "IFCRELDEFINESBYTYPE expects type object definitions",
      ),
    ),
  );
});

test("relationship create menus filter relationship classes by endpoint types", () => {
  const relationTypes = [
    "IFCRELASSOCIATESAPPROVAL",
    "IFCRELASSIGNSTOGROUP",
    "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  ];

  assert.deepEqual(
    relationshipTypesForEndpointTypes(
      relationTypes,
      "IFCWALL",
      "IFCZONE",
      1,
      2,
    ),
    ["IFCRELASSIGNSTOGROUP"],
  );
  assert.deepEqual(
    relationshipTypesForEndpointTypes(
      relationTypes,
      "IFCWALL",
      "IFCAPPROVAL",
      1,
      2,
    ),
    ["IFCRELASSOCIATESAPPROVAL"],
  );
  assert.deepEqual(
    relationshipTypesForEndpointTypes(
      relationTypes,
      "IFCBUILDINGSTOREY",
      "IFCWALL",
      1,
      2,
    ),
    ["IFCRELCONTAINEDINSPATIALSTRUCTURE"],
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
  const solidChange = summary.geometryChanges.find(
    (change) =>
      change.action === "added" &&
      change.type === "IFCEXTRUDEDAREASOLID" &&
      change.affectedProducts.some((product) => product.name === "Diff Block"),
  );
  assert.ok(solidChange);
  assert.ok(solidChange.after?.includes("rectangle 1."));
  assert.ok(solidChange.after?.includes("depth 1."));
});

test("native spatial tree handles deep hierarchies without recursion", () => {
  const document = parseNativeIfcText(createDeepSpatialIfc(2500), "deep.ifc");
  assert.equal(document.spatialRoots.length, 1);

  let current = document.spatialRoots[0];
  let depth = 0;
  while (current.children.length) {
    depth += 1;
    current = current.children[0];
  }

  assert.equal(depth, 2500);
  assert.ok(document.entityById.has(2501));
});

test("web-ifc graph tree handles deep aggregate chains without recursion", () => {
  const depth = 2500;
  const entities: IfcEntitySummary[] = Array.from(
    { length: depth + 1 },
    (_value, index) => ({
      expressID: index + 1,
      name: `Node ${index + 1}`,
      typeCode: index === 0 ? 1 : 2,
      typeName: index === 0 ? "IFCPROJECT" : "IFCSITE",
    }),
  );
  const relationshipLines = new Map<number, Record<string, unknown>>();
  for (let index = 0; index < depth; index += 1) {
    const id = 10_000 + index;
    relationshipLines.set(id, {
      RelatedObjects: [{ value: index + 2 }],
      RelatingObject: { value: index + 1 },
      expressID: id,
    });
  }
  const ids = [...relationshipLines.keys()];
  const api = {
    GetLine: (_modelID: number, expressID: number) =>
      relationshipLines.get(expressID),
    GetLineIDsWithType: () => ({
      get: (index: number) => ids[index],
      size: () => ids.length,
    }),
    GetTypeCodeFromName: (typeName: string) =>
      typeName === "IFCRELAGGREGATES" ? 1 : 0,
  } as unknown as WebIFC.IfcAPI;

  const graph = buildGraphIndex(api, 1, entities, []);
  assert.equal(graph.spatialTree.length, 1);

  let current = graph.spatialTree[0];
  let resolvedDepth = 0;
  while (current.children.length) {
    resolvedDepth += 1;
    current = current.children[0];
  }

  assert.equal(resolvedDepth, depth);
});

function createDeepSpatialIfc(depth: number) {
  const entities = [
    "#1=IFCPROJECT('0IFCnative000000000001',$,'Deep Project',$,$,$,$,$,$);",
  ];
  const relationships: string[] = [];
  for (let index = 0; index < depth; index += 1) {
    const id = index + 2;
    const parentId = id - 1;
    entities.push(
      `#${id}=IFCSITE('0IFCnative${String(id).padStart(12, "0")}',$,'Node ${id}',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);`,
    );
    relationships.push(
      `#${10_000 + index}=IFCRELAGGREGATES('0IFCnative${String(10_000 + index).padStart(12, "0")}',$,$,$,#${parentId},(#${id}));`,
    );
  }
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    "FILE_NAME('deep.ifc','2026-05-13T00:00:00',('IFCnative'),('IFCnative'),'IFCnative','IFCnative','');",
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    "ENDSEC;",
    "DATA;",
    ...entities,
    ...relationships,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

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

test("native cylindrical body splits into independent equal samples", async () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withCylinder = addNativeBodyElement(sample, {
    depth: "2",
    height: "4",
    name: "Bohrkern",
    parentId: storey.id,
    profile: "cylinder",
    type: "IFCBUILDINGELEMENTPROXY",
    width: "2",
    x: "0",
    y: "0",
    z: "0",
  });
  const cylinder = withCylinder.entities.find(
    (entity) => entity.name === "Bohrkern",
  );
  assert.ok(cylinder);
  const withMetadata = addNativePropertySet(
    withCylinder,
    cylinder.id,
    "Pset_Probe",
    "Status",
    "bereit",
  );

  const split = splitNativeBodyElement(withMetadata, cylinder.id, 2);
  assert.ok(split);
  assert.equal(split.partIds.length, 2);
  assert.equal(split.document.entityById.get(split.partIds[0])?.name, "Bohrkern – Teil 1/2");
  assert.equal(split.document.entityById.get(split.partIds[1])?.name, "Bohrkern – Teil 2/2");
  for (const id of split.partIds) {
    const body = getNativeBodyRepresentation(split.document, id);
    assert.equal(body.profile, "cylinder");
    assert.equal(body.height, 2);
    assert.ok(
      split.document.propertySetsByEntity
        .get(id)
        ?.some((set) => set.name === "Pset_Probe"),
    );
    assert.equal(
      split.document.propertySetsByEntity
        .get(id)
        ?.find((set) => set.name === "IFCnative_BaseQuantities")
        ?.values.find((value) => value.name === "NetVolume")?.value,
      "6.2832",
    );
  }

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(split.document)),
  );
  assert.ok(modelID >= 0);
  const firstBounds = streamElementWorldBounds(api, modelID, split.partIds[0]);
  const secondBounds = streamElementWorldBounds(api, modelID, split.partIds[1]);
  // web-ifc streams the Z-up IFC extrusion in its Y-up mesh coordinates.
  assert.equal(roundCoordinate(firstBounds.min[1]), 0);
  assert.equal(roundCoordinate(firstBounds.max[1]), 2);
  assert.equal(roundCoordinate(secondBounds.min[1]), 2);
  assert.equal(roundCoordinate(secondBounds.max[1]), 4);
  api.CloseModel(modelID);
});

test("native bodies combine into one mapped multi-body product", async () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withFirst = addNativeBodyElement(sample, {
    depth: "1",
    height: "1",
    name: "Segment A",
    parentId: storey.id,
    type: "IFCBUILDINGELEMENTPROXY",
    width: "1",
    x: "0",
    y: "0",
    z: "0",
  });
  const first = withFirst.entities.find((entity) => entity.name === "Segment A");
  assert.ok(first);
  const withSecond = addNativeBodyElement(withFirst, {
    depth: "1",
    height: "1",
    name: "Segment B",
    parentId: storey.id,
    type: "IFCBUILDINGELEMENTPROXY",
    width: "1",
    x: "3",
    y: "0",
    z: "0",
  });
  const second = withSecond.entities.find((entity) => entity.name === "Segment B");
  assert.ok(second);
  const withMetadata = addNativePropertySet(
    withSecond,
    first.id,
    "Pset_Kombination",
    "Quelle",
    "A",
  );

  const combined = combineNativeBodyElements(
    withMetadata,
    [first.id, second.id],
    { name: "Gemeinsames Teil", removeSources: true },
  );
  assert.ok(combined);
  assert.equal(combined.document.entityById.has(first.id), false);
  assert.equal(combined.document.entityById.has(second.id), false);
  assert.equal(combined.document.entityById.get(combined.productId)?.name, "Gemeinsames Teil");
  assert.equal(
    combined.document.entities.filter((entity) => entity.type === "IFCMAPPEDITEM")
      .length,
    2,
  );
  assert.ok(
    combined.document.propertySetsByEntity
      .get(combined.productId)
      ?.some((set) => set.name === "Pset_Kombination"),
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(combined.document)),
  );
  assert.ok(modelID >= 0);
  const bounds = streamElementWorldBounds(api, modelID, combined.productId);
  assert.equal(roundCoordinate(bounds.min[0]), -0.5);
  assert.equal(roundCoordinate(bounds.max[0]), 3.5);
  assert.equal(roundCoordinate(bounds.min[1]), 0);
  assert.equal(roundCoordinate(bounds.max[1]), 1);
  assert.equal(roundCoordinate(bounds.min[2]), -0.5);
  assert.equal(roundCoordinate(bounds.max[2]), 0.5);
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
  // Weltmodus erbt die Platzierungskette des Parents (RelativeTo = dessen
  // IFCLOCALPLACEMENT) und speichert kleine, projizierte lokale Koordinaten …
  const parentPlacement = getNativePlacement(moved, block.id);
  assert.ok(parentPlacement);
  assert.equal(placement.relativeTo, parentPlacement.placementId);
  assert.equal(roundCoordinate(placement.x), roundCoordinate(2.6699 - 10));
  assert.equal(roundCoordinate(placement.y), 0);
  assert.equal(roundCoordinate(placement.z), roundCoordinate(-0.6299));
  // … landet aber exakt an der absoluten IFC-Weltposition.
  const spawnedWorld = getNativePlacementWorld(withSpawn, spawned.id);
  assert.ok(spawnedWorld);
  assert.equal(roundCoordinate(spawnedWorld.worldX), roundCoordinate(2.6699));
  assert.equal(roundCoordinate(spawnedWorld.worldY), 0);
  assert.equal(roundCoordinate(spawnedWorld.worldZ), roundCoordinate(-0.6299));
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

test("native body assignment updates selected product representation with reviewable quantities", async () => {
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
  assert.equal(afterBlock.args[6], block.args[6]);
  const body = getNativeBodyRepresentation(assigned, block.id);
  assert.equal(body.profile, "rectangle");
  assert.equal(body.width, 3);
  assert.equal(body.depth, 1.5);
  assert.equal(body.height, 2);
  assert.deepEqual(summarizeNativeIfcGeometry(assigned), {
    entityCount: assigned.entities.length,
    geometryItemCount: 1,
    productDefinitionShapeCount: 1,
    representedProductCount: 1,
    shapeRepresentationCount: 1,
  });
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
  assert.ok(diffSummary.changedEntities >= 2);
  assert.equal(diffSummary.addedEntities, 0);
  assert.ok(
    assigned.entities.some(
      (entity) => entity.type === "IFCPRODUCTDEFINITIONSHAPE",
    ),
  );
  assert.ok(
    diffSummary.geometryChanges.some(
      (change) =>
        change.action === "changed" &&
        change.type === "IFCEXTRUDEDAREASOLID" &&
        change.after?.includes("rectangle 3.") &&
        change.after.includes("depth 2."),
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

test("native body assignment repairs missing product placement", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  const broken = updateNativeEntity(sample, block.id, {
    args: block.args.map((arg, index) => (index === 5 ? "$" : arg)),
  });
  assert.equal(getNativePlacement(broken, block.id), undefined);
  assert.ok(
    broken.diagnostics.some((line) =>
      line.includes(`#${block.id} IFCBUILTELEMENT has no ObjectPlacement`),
    ),
  );

  const repaired = assignNativeBodyRepresentation(broken, block.id, {
    depth: "1",
    height: "1",
    profile: "rectangle",
    width: "1",
  });
  const placement = getNativePlacement(repaired, block.id);
  assert.ok(placement);
  assert.equal(placement.x, 0);
  assert.equal(placement.y, 0);
  assert.equal(placement.z, 0);
  assert.equal(
    repaired.diagnostics.some((line) =>
      line.includes(`#${block.id} IFCBUILTELEMENT has no ObjectPlacement`),
    ),
    false,
  );
});

test("native body representation summary reads and updates assigned geometry", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const assigned = assignNativeBodyRepresentation(sample, block.id, {
    depth: "2",
    height: "3",
    profile: "rectangle",
    width: "4",
  });
  const initialBody = getNativeBodyRepresentation(assigned, block.id);
  assert.equal(initialBody.canAssign, true);
  assert.equal(initialBody.canEdit, true);
  assert.equal(initialBody.profile, "rectangle");
  assert.equal(initialBody.width, 4);
  assert.equal(initialBody.depth, 2);
  assert.equal(initialBody.height, 3);
  assert.ok(initialBody.shapeId);
  assert.ok(initialBody.solidId);
  assert.ok(initialBody.profileId);

  const updated = assignNativeBodyRepresentation(assigned, block.id, {
    depth: "1",
    height: "5",
    profile: "cylinder",
    width: "2",
  });
  const updatedBody = getNativeBodyRepresentation(updated, block.id);
  assert.equal(updatedBody.shapeId, initialBody.shapeId);
  assert.equal(updatedBody.solidId, initialBody.solidId);
  assert.equal(updatedBody.profileId, initialBody.profileId);
  assert.equal(updatedBody.profile, "cylinder");
  assert.equal(updatedBody.radius, 1);
  assert.equal(updatedBody.width, 2);
  assert.equal(updatedBody.depth, 2);
  assert.equal(updatedBody.height, 5);
  assert.equal(
    updated.propertySetsByEntity
      .get(block.id)
      ?.find((set) => set.name === "IFCnative_BaseQuantities")
      ?.values.find((value) => value.name === "NetVolume")?.value,
    "15.708",
  );
});

test("native placement editor writes numeric XYZ moves without rewriting product identity", async () => {
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

  const movedPoint = moved.entityById.get(beforePlacement.pointId);
  assert.ok(movedPoint);
  assert.deepEqual(movedPoint.args, ["(3.25,-1.5,0.75)"]);
  assert.equal(moved.entityById.get(block.id)?.globalId, block.globalId);

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(moved)),
  );
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  api.CloseModel(modelID);
});

test("native movable product resolves from sample geometry references", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  const shapeId = firstStepReference(block.args[6]);
  const shape = sample.entityById.get(shapeId);
  assert.ok(shape);
  const representationId = firstStepReference(shape.args[2]);
  const representation = sample.entityById.get(representationId);
  assert.ok(representation);
  const solidId = firstStepReference(representation.args[3]);

  assert.equal(resolveNativeMovableProductId(sample, block.id), block.id);
  assert.equal(resolveNativeMovableProductId(sample, shapeId), block.id);
  assert.equal(resolveNativeMovableProductId(sample, solidId), block.id);
  assert.equal(resolveNativeMovableProductId(sample, 21), undefined);
});

test("viewer-world move deltas are converted to IFC placement axes", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const placement = getNativePlacement(sample, block.id);
  assert.ok(placement);
  const viewerDelta = { x: 1.5, y: 0.75, z: -2 };
  const ifcDelta = viewerWorldDeltaToIfcPlacementDelta(viewerDelta);
  const moved = updateNativePlacement(sample, block.id, {
    x: String(placement.x + ifcDelta.x),
    y: String(placement.y + ifcDelta.y),
    z: String(placement.z + ifcDelta.z),
  });

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const beforeModelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(sample)),
  );
  const afterModelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(moved)),
  );
  const beforeCenter = streamGeometryWorldCenter(api, beforeModelID);
  const afterCenter = streamGeometryWorldCenter(api, afterModelID);

  assert.deepEqual(
    afterCenter.map((value, index) =>
      roundCoordinate(value - beforeCenter[index]),
    ),
    [viewerDelta.x, viewerDelta.y, viewerDelta.z],
  );

  api.CloseModel(beforeModelID);
  api.CloseModel(afterModelID);
});

test("viewer-world rotation writes valid IFC placement directions", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const rotated = updateNativePlacementRotation(sample, block.id, {
    axis: viewerWorldDirectionToIfcPlacementDirection({ x: 0, y: 1, z: 0 }),
    refDirection: viewerWorldDirectionToIfcPlacementDirection({
      x: 0,
      y: 0,
      z: -1,
    }),
  });
  const text = serializeNativeIfcDocument(rotated);
  const reparsed = parseNativeIfcText(text, "rotated.ifc");
  const placement = getNativePlacement(reparsed, block.id);
  assert.ok(placement);
  const axisPlacement = reparsed.entityById.get(placement.axisPlacementId);
  assert.equal(axisPlacement?.type, "IFCAXIS2PLACEMENT3D");
  assert.notEqual(
    axisPlacement?.args[1],
    "$",
    "Axis direction should be written for rotated placements",
  );
  assert.notEqual(
    axisPlacement?.args[2],
    "$",
    "RefDirection should be written for rotated placements",
  );

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new TextEncoder().encode(text));
  assert.ok(modelID >= 0);
  assert.ok(streamGeometryVertexCount(api, modelID) > 0);
  api.CloseModel(modelID);
});

test("placement rotation keeps shared extrusion directions private", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  const placement = getNativePlacement(sample, block.id);
  const body = getNativeBodyRepresentation(sample, block.id);
  assert.ok(placement);
  assert.ok(body.solidId);
  const solid = sample.entityById.get(body.solidId);
  assert.equal(solid?.type, "IFCEXTRUDEDAREASOLID");
  const sharedDirectionId = Number(solid?.args[2]?.replace(/^#/, ""));
  const sharedDirection = sample.entityById.get(sharedDirectionId);
  assert.equal(sharedDirection?.type, "IFCDIRECTION");
  const axisPlacement = sample.entityById.get(placement.axisPlacementId);
  assert.equal(axisPlacement?.type, "IFCAXIS2PLACEMENT3D");

  const withSharedDirection = updateNativeEntity(
    sample,
    placement.axisPlacementId,
    {
      args: [
        axisPlacement.args[0],
        `#${sharedDirectionId}`,
        axisPlacement.args[2] ?? "$",
      ],
    },
  );
  assert.ok(
    (withSharedDirection.incomingRefs.get(sharedDirectionId)?.length ?? 0) > 1,
  );
  const rotated = updateNativePlacementRotation(withSharedDirection, block.id, {
    axis: { x: 1, y: 0, z: 0 },
    refDirection: { x: 0, y: 1, z: 0 },
  });

  assert.deepEqual(
    rotated.entityById.get(sharedDirectionId)?.args,
    sharedDirection?.args,
    "The extrusion direction must not be mutated by placement rotation",
  );
  const rotatedPlacement = getNativePlacement(rotated, block.id);
  assert.ok(rotatedPlacement);
  const rotatedAxis = rotated.entityById.get(rotatedPlacement.axisPlacementId);
  assert.notEqual(rotatedAxis?.args[1], `#${sharedDirectionId}`);

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const beforeModelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withSharedDirection)),
  );
  const afterModelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(rotated)),
  );
  assert.equal(
    streamGeometryVertexCount(api, afterModelID),
    streamGeometryVertexCount(api, beforeModelID),
  );
  api.CloseModel(beforeModelID);
  api.CloseModel(afterModelID);
});

test("viewer-world picked points are converted to IFC placement axes", () => {
  assert.deepEqual(
    viewerWorldPointToIfcPlacementPoint({
      x: -1456.5366,
      y: 15.1184,
      z: -395.765,
    }),
    { x: -1456.5366, y: 395.765, z: 15.1184 },
  );
});

test("ifc placement points map back to viewer world points", () => {
  const viewerPoint = { x: -1456.5366, y: 15.1184, z: -395.765 };
  const roundTrip = ifcPlacementPointToViewerWorldPoint(
    viewerWorldPointToIfcPlacementPoint(viewerPoint),
  );
  assert.deepEqual(roundTrip, viewerPoint);
});

test("tree child creation uses containment for elements and aggregation for spatial children", () => {
  const sample = createNativeSampleDocument();
  const building = sample.entities.find(
    (entity) => entity.type === "IFCBUILDING",
  );
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(building);
  assert.ok(storey);

  // Spatial child under spatial parent -> IFCRELAGGREGATES.
  const withStorey = addNativeElement(
    sample,
    building.id,
    "IFCBUILDINGSTOREY",
    "Level1",
  );
  const newStorey = withStorey.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY" && entity.name === "Level1",
  );
  assert.ok(newStorey);
  assert.ok(
    withStorey.relationshipsByEntity
      .get(newStorey.id)
      ?.some((relationship) => relationship.type === "IFCRELAGGREGATES"),
  );

  // Element under spatial parent -> IFCRELCONTAINEDINSPATIALSTRUCTURE.
  const withDoor = addNativeElement(withStorey, storey.id, "IFCDOOR", "Tür");
  const door = withDoor.entities.find((entity) => entity.type === "IFCDOOR");
  assert.ok(door);
  const doorRelationship = withDoor.relationshipsByEntity
    .get(door.id)
    ?.find(
      (relationship) =>
        relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE",
    );
  assert.ok(doorRelationship);
  assert.ok(doorRelationship.sourceIds.includes(storey.id));
  assert.ok(doorRelationship.targetIds.includes(door.id));

  // Element part under element parent -> IFCRELAGGREGATES.
  const withPart = addNativeElement(
    withDoor,
    door.id,
    "IFCBUILDINGELEMENTPROXY",
    "Türgriff",
  );
  const part = withPart.entities.find(
    (entity) => entity.type === "IFCBUILDINGELEMENTPROXY",
  );
  assert.ok(part);
  assert.ok(
    withPart.relationshipsByEntity
      .get(part.id)
      ?.some((relationship) => relationship.type === "IFCRELAGGREGATES"),
  );

  // All created nodes show up in the spatial tree.
  const treeIds = new Set<number>();
  const collect = (nodes: typeof withPart.spatialRoots) => {
    for (const node of nodes) {
      treeIds.add(node.id);
      collect(node.children);
    }
  };
  collect(withPart.spatialRoots);
  assert.ok(treeIds.has(newStorey.id));
  assert.ok(treeIds.has(door.id));
  assert.ok(treeIds.has(part.id));
});

test("world placement accumulates rotated parent frames and round-trips writes", () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  const withChild = addNativeBodyElement(sample, {
    depth: 1,
    height: 1,
    name: "World Placement Child",
    parentId: block.id,
    type: "IFCBUILTELEMENT",
    width: 1,
    x: 1,
    y: 0,
    z: 0,
  });
  const child = withChild.entities.find(
    (entity) => entity.name === "World Placement Child",
  );
  assert.ok(child);

  // Rotate the parent block 90 degrees about Z (X axis becomes +Y).
  const rotated = updateNativePlacementRotation(withChild, block.id, {
    axis: { x: 0, y: 0, z: 1 },
    refDirection: { x: 0, y: 1, z: 0 },
  });

  const parentWorld = getNativePlacementWorld(rotated, block.id);
  const childWorld = getNativePlacementWorld(rotated, child.id);
  assert.ok(parentWorld);
  assert.ok(childWorld);
  assert.equal(roundCoordinate(childWorld.worldX - parentWorld.worldX), 0);
  assert.equal(roundCoordinate(childWorld.worldY - parentWorld.worldY), 1);
  assert.equal(roundCoordinate(childWorld.worldZ - parentWorld.worldZ), 0);

  // Reading back the current world position yields the stored local point.
  const roundTripLocal = nativeWorldToLocalPlacementPoint(rotated, child.id, {
    x: childWorld.worldX,
    y: childWorld.worldY,
    z: childWorld.worldZ,
  });
  assert.ok(roundTripLocal);
  assert.equal(roundCoordinate(roundTripLocal.x), 1);
  assert.equal(roundCoordinate(roundTripLocal.y), 0);
  assert.equal(roundCoordinate(roundTripLocal.z), 0);

  // Writing a world target through the local conversion lands on the target.
  const target = {
    x: childWorld.worldX + 5,
    y: childWorld.worldY - 2,
    z: childWorld.worldZ + 3,
  };
  const moved = updateNativePlacementWorld(rotated, child.id, target);
  const movedWorld = getNativePlacementWorld(moved, child.id);
  assert.ok(movedWorld);
  assert.equal(roundCoordinate(movedWorld.worldX), roundCoordinate(target.x));
  assert.equal(roundCoordinate(movedWorld.worldY), roundCoordinate(target.y));
  assert.equal(roundCoordinate(movedWorld.worldZ), roundCoordinate(target.z));

  // A desired world orientation must be projected through the rotated parent
  // before it is written into the child's local IFCAXIS2PLACEMENT3D.
  const localAxis = nativeWorldDirectionInPlacementParentFrame(
    moved,
    child.id,
    { x: 0, y: 0, z: 1 },
  );
  const localRefDirection = nativeWorldDirectionInPlacementParentFrame(
    moved,
    child.id,
    { x: 1, y: 0, z: 0 },
  );
  assert.ok(localAxis);
  assert.ok(localRefDirection);
  const worldAligned = updateNativePlacementRotation(moved, child.id, {
    axis: localAxis,
    refDirection: localRefDirection,
  });
  const alignedFrame = getNativePlacementWorldFrame(worldAligned, child.id);
  assert.ok(alignedFrame);
  assert.equal(roundCoordinate(alignedFrame.xAxis.x), 1);
  assert.equal(roundCoordinate(alignedFrame.xAxis.y), 0);
  assert.equal(roundCoordinate(alignedFrame.xAxis.z), 0);
});

test("picked viewer point on a moved element spawns a world body at the same spot", async () => {
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);

  // Move the block via the placement panel path (world input -> local write).
  const worldTarget = { x: 6, y: 4, z: 0 };
  const local = nativeWorldToLocalPlacementPoint(sample, block.id, worldTarget);
  assert.ok(local);
  const moved = updateNativePlacement(sample, block.id, {
    x: String(local.x),
    y: String(local.y),
    z: String(local.z),
  });

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const movedModelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(moved)),
  );
  const blockBounds = streamElementWorldBounds(api, movedModelID, block.id);
  api.CloseModel(movedModelID);

  // The rendered (viewer) position must match the absolute IFC placement.
  assert.deepEqual(
    [
      roundCoordinate((blockBounds.min[0] + blockBounds.max[0]) / 2),
      roundCoordinate(blockBounds.min[1]),
      roundCoordinate((blockBounds.min[2] + blockBounds.max[2]) / 2),
    ],
    [worldTarget.x, worldTarget.z, -worldTarget.y],
  );

  // Simulate picking the top center of the moved block in the viewer.
  const pick = {
    x: (blockBounds.min[0] + blockBounds.max[0]) / 2,
    y: blockBounds.max[1],
    z: (blockBounds.min[2] + blockBounds.max[2]) / 2,
  };
  const ifcPoint = viewerWorldPointToIfcPlacementPoint(pick);
  const withBody = addNativeBodyElement(moved, {
    depth: 1,
    height: 1,
    name: "Picked Spawn Body",
    parentId: block.id,
    placementMode: "world",
    profile: "rectangle",
    type: "IFCBUILTELEMENT",
    width: 1,
    x: ifcPoint.x,
    y: ifcPoint.y,
    z: ifcPoint.z,
  });
  const created = withBody.entities.find(
    (entity) => entity.name === "Picked Spawn Body",
  );
  assert.ok(created);

  const bodyModelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withBody)),
  );
  const createdBounds = streamElementWorldBounds(api, bodyModelID, created.id);
  api.CloseModel(bodyModelID);

  // The created body sits centered on the picked point (profile is centered).
  assert.equal(
    roundCoordinate((createdBounds.min[0] + createdBounds.max[0]) / 2),
    roundCoordinate(pick.x),
  );
  assert.equal(roundCoordinate(createdBounds.min[1]), roundCoordinate(pick.y));
  assert.equal(
    roundCoordinate((createdBounds.min[2] + createdBounds.max[2]) / 2),
    roundCoordinate(pick.z),
  );
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

function streamGeometryWorldCenter(api: WebIFC.IfcAPI, modelID: number) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  api.StreamAllMeshes(modelID, (mesh) => {
    accumulateMeshWorldBounds(api, modelID, mesh, min, max);
  });
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

function streamElementWorldBounds(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressID: number,
) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  api.StreamAllMeshes(modelID, (mesh) => {
    if (mesh.expressID !== expressID) {
      return;
    }
    accumulateMeshWorldBounds(api, modelID, mesh, min, max);
  });
  assert.ok(Number.isFinite(min[0]), `No geometry streamed for #${expressID}`);
  return { max, min };
}

function accumulateMeshWorldBounds(
  api: WebIFC.IfcAPI,
  modelID: number,
  mesh: WebIFC.FlatMesh,
  min: number[],
  max: number[],
) {
  for (let index = 0; index < mesh.geometries.size(); index += 1) {
    const placed = mesh.geometries.get(index);
    const matrix = placed.flatTransformation;
    const geometry = api.GetGeometry(modelID, placed.geometryExpressID);
    const vertices = api.GetVertexArray(
      geometry.GetVertexData(),
      geometry.GetVertexDataSize(),
    );
    for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 6) {
      const x = vertices[vertexIndex];
      const y = vertices[vertexIndex + 1];
      const z = vertices[vertexIndex + 2];
      const worldX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      const worldY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      const worldZ =
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      min[0] = Math.min(min[0], worldX);
      min[1] = Math.min(min[1], worldY);
      min[2] = Math.min(min[2], worldZ);
      max[0] = Math.max(max[0], worldX);
      max[1] = Math.max(max[1], worldY);
      max[2] = Math.max(max[2], worldZ);
    }
    geometry.delete();
  }
}

function roundCoordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}

function firstStepReference(value: string) {
  const id = Number(value.match(/#(\d+)/)?.[1]);
  assert.ok(Number.isFinite(id));
  return id;
}

test("body mirror geometry preserves every builder profile", async () => {
  const THREE = await import("three");
  const rectangle = createBodyGeometry(THREE, {
    depth: "2",
    height: "3",
    profile: "rectangle",
    width: "4",
  });
  const cylinder = createBodyGeometry(THREE, {
    depth: "2",
    height: "3",
    profile: "cylinder",
    width: "4",
  });
  const ellipse = createBodyGeometry(THREE, {
    depth: "2",
    height: "3",
    profile: "ellipse",
    width: "4",
  });
  const triangle = createBodyGeometry(THREE, {
    depth: "2",
    height: "3",
    profile: "triangle",
    width: "4",
  });
  const marker = createBodyGeometry(THREE, {
    depth: "2",
    height: "3",
    profile: "marker",
    width: "4",
  });

  try {
    assert.equal(rectangle.type, "BoxGeometry");
    assert.equal(cylinder.type, "CylinderGeometry");
    assert.equal(ellipse.type, "CylinderGeometry");
    assert.equal(triangle.type, "ExtrudeGeometry");
    assert.equal(marker.type, "ExtrudeGeometry");

    const ellipseSize = ellipse.boundingBox?.getSize(new THREE.Vector3());
    assert.ok(ellipseSize);
    assert.equal(roundCoordinate(ellipseSize.x), 4);
    assert.equal(roundCoordinate(ellipseSize.y), 3);
    assert.equal(roundCoordinate(ellipseSize.z), 2);

    for (const geometry of [triangle, marker]) {
      const size = geometry.boundingBox?.getSize(new THREE.Vector3());
      assert.ok(size);
      assert.equal(roundCoordinate(size.x), 4);
      assert.equal(roundCoordinate(size.y), 3);
      assert.equal(roundCoordinate(size.z), 2);
    }
  } finally {
    rectangle.dispose();
    cylinder.dispose();
    ellipse.dispose();
    triangle.dispose();
    marker.dispose();
  }
});

test("native body presets create ellipse, triangle and position marker profiles that web-ifc can mesh", async () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const api = new WebIFC.IfcAPI();
  await api.Init();

  // Ellipse: Halbachsen 2/1 -> Flaeche pi*2*1 = 6.2832
  const withEllipse = addNativeBodyElement(sample, {
    depth: "2",
    height: "1",
    name: "Ellipse Body",
    parentId: storey.id,
    profile: "ellipse",
    type: "IFCBUILTELEMENT",
    width: "4",
    x: "0",
    y: "0",
    z: "0",
  });
  const ellipseProfile = withEllipse.entities.find(
    (entity) => entity.type === "IFCELLIPSEPROFILEDEF",
  );
  assert.ok(ellipseProfile);
  assert.equal(ellipseProfile.args[3], "2.");
  assert.equal(ellipseProfile.args[4], "1.");
  const ellipseBody = withEllipse.entities.find(
    (entity) => entity.name === "Ellipse Body",
  );
  assert.ok(ellipseBody);
  assert.ok(
    withEllipse.propertySetsByEntity
      .get(ellipseBody.id)
      ?.some((set) =>
        set.values.some(
          (value) => value.name === "FootprintArea" && value.value === "6.2832",
        ),
      ),
  );
  const ellipseModel = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withEllipse)),
  );
  assert.ok(streamGeometryVertexCount(api, ellipseModel) > 0);
  api.CloseModel(ellipseModel);

  // Dreieck: geschlossene Polylinie mit 3 Punkten (+ Schlusspunkt), Flaeche w*d/2
  const withTriangle = addNativeBodyElement(sample, {
    depth: "2",
    height: "1",
    name: "Triangle Body",
    parentId: storey.id,
    profile: "triangle",
    type: "IFCBUILTELEMENT",
    width: "4",
    x: "0",
    y: "0",
    z: "0",
  });
  const triangleProfile = withTriangle.entities.find(
    (entity) => entity.type === "IFCARBITRARYCLOSEDPROFILEDEF",
  );
  assert.ok(triangleProfile);
  const trianglePolyline = withTriangle.entityById.get(
    firstStepReference(triangleProfile.args[2] ?? ""),
  );
  assert.equal(trianglePolyline?.type, "IFCPOLYLINE");
  assert.equal((trianglePolyline?.args[0]?.match(/#\d+/g) ?? []).length, 4);
  const triangleBody = withTriangle.entities.find(
    (entity) => entity.name === "Triangle Body",
  );
  assert.ok(triangleBody);
  assert.ok(
    withTriangle.propertySetsByEntity
      .get(triangleBody.id)
      ?.some((set) =>
        set.values.some(
          (value) => value.name === "FootprintArea" && value.value === "4.",
        ),
      ),
  );
  const triangleModel = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withTriangle)),
  );
  assert.ok(streamGeometryVertexCount(api, triangleModel) > 0);
  api.CloseModel(triangleModel);

  // Karten-Pin: aufrechte Silhouette (Spitze + Kreisbogen-Kopf, 26 Punkte
  // + Schlusspunkt), dünn extrudiert entlang der Tiefe.
  const withMarker = addNativeBodyElement(sample, {
    depth: "0.2",
    height: "3",
    name: "Marker Body",
    parentId: storey.id,
    profile: "marker",
    type: "IFCBUILDINGELEMENTPROXY",
    width: "2",
    x: "0",
    y: "0",
    z: "0",
  });
  const markerProfile = withMarker.entities.find(
    (entity) => entity.type === "IFCARBITRARYCLOSEDPROFILEDEF",
  );
  assert.ok(markerProfile);
  const markerPolyline = withMarker.entityById.get(
    firstStepReference(markerProfile.args[2] ?? ""),
  );
  assert.equal(markerPolyline?.type, "IFCPOLYLINE");
  assert.equal((markerPolyline?.args[0]?.match(/#\d+/g) ?? []).length, 27);
  // Solid: Profil-Ebene vertikal gestellt, Extrusionslänge = Tiefe (Dicke).
  const markerSolid = withMarker.entities.find(
    (entity) =>
      entity.type === "IFCEXTRUDEDAREASOLID" &&
      firstStepReference(entity.args[0] ?? "") === markerProfile.id,
  );
  assert.ok(markerSolid);
  assert.equal(markerSolid.args[3], "0.2");
  const markerSolidAxis = withMarker.entityById.get(
    firstStepReference(markerSolid.args[1] ?? ""),
  );
  const markerAxisDirection = withMarker.entityById.get(
    firstStepReference(markerSolidAxis?.args[1] ?? ""),
  );
  assert.equal(markerAxisDirection?.args[0], "(0.,-1.,0.)");
  const markerBody = withMarker.entities.find(
    (entity) => entity.name === "Marker Body",
  );
  assert.ok(markerBody);
  const expectedMarkerArea = polygonArea(createPositionMarkerProfile(2, 3));
  assert.ok(
    withMarker.propertySetsByEntity
      .get(markerBody.id)
      ?.some((set) =>
        set.values.some(
          (value) =>
            value.name === "FootprintArea" &&
            Math.abs(Number(value.value) - expectedMarkerArea) < 0.001,
        ),
      ),
  );
  const markerModel = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(withMarker)),
  );
  assert.ok(streamGeometryVertexCount(api, markerModel) > 0);
  api.CloseModel(markerModel);
});

test("removeNativeBodyRepresentation strips the exclusive geometry chain but keeps the product", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withBody = addNativeBodyElement(sample, {
    depth: "2",
    height: "1.5",
    name: "Remove Me Body",
    parentId: storey.id,
    profile: "rectangle",
    type: "IFCBUILTELEMENT",
    width: "4",
    x: "1",
    y: "0",
    z: "2",
  });
  const body = withBody.entities.find(
    (entity) => entity.name === "Remove Me Body",
  );
  assert.ok(body);
  const before = getNativeBodyRepresentation(withBody, body.id);
  assert.ok(before.hasRepresentation);
  assert.ok(before.shapeId);
  const shapeCountBefore = withBody.entities.filter(
    (entity) => entity.type === "IFCPRODUCTDEFINITIONSHAPE",
  ).length;

  const removed = removeNativeBodyRepresentation(withBody, body.id);
  assert.notEqual(removed, withBody);

  const bodyAfter = removed.entities.find(
    (entity) => entity.name === "Remove Me Body",
  );
  assert.ok(bodyAfter, "Produkt bleibt nach dem Geometrie-Entfernen erhalten");
  assert.equal(bodyAfter.args[6], "$");
  assert.equal(
    getNativeBodyRepresentation(removed, bodyAfter.id).hasRepresentation,
    false,
  );
  // Die exklusive Shape-Kette ist abgeraeumt ...
  assert.equal(removed.entityById.has(before.shapeId), false);
  assert.equal(
    removed.entities.filter(
      (entity) => entity.type === "IFCPRODUCTDEFINITIONSHAPE",
    ).length,
    shapeCountBefore - 1,
  );
  // ... aber Platzierung und Psets/Quantities des Produkts bleiben.
  assert.ok(bodyAfter.args[5]?.startsWith("#"));
  assert.ok(
    removed.propertySetsByEntity
      .get(bodyAfter.id)
      ?.some((set) => set.name === "IFCnative_BaseQuantities"),
  );
  // Fremde Geometrie (z. B. der Sample-Block) ist unangetastet.
  const block = removed.entities.find(
    (entity) =>
      entity.type === "IFCBUILTELEMENT" && entity.name !== "Remove Me Body",
  );
  assert.ok(block);
  assert.ok(getNativeBodyRepresentation(removed, block.id).hasRepresentation);

  // Zweiter Aufruf ist ein No-op.
  assert.equal(removeNativeBodyRepresentation(removed, bodyAfter.id), removed);
});

test("getNativeLengthUnitScale reads metre and milli-metre length units", () => {
  const sample = createNativeSampleDocument();
  assert.equal(getNativeLengthUnitScale(sample), 1);

  const mmText = serializeNativeIfcDocument(sample).replace(
    ".LENGTHUNIT.,$,.METRE.",
    ".LENGTHUNIT.,.MILLI.,.METRE.",
  );
  const mmDocument = parseNativeIfcText(mmText, "mm.ifc");
  assert.equal(getNativeLengthUnitScale(mmDocument), 0.001);
});

test("addNativeBodyElement converts metre inputs into millimetre model units", () => {
  const sample = createNativeSampleDocument();
  const mmText = serializeNativeIfcDocument(sample).replace(
    ".LENGTHUNIT.,$,.METRE.",
    ".LENGTHUNIT.,.MILLI.,.METRE.",
  );
  const mmDocument = parseNativeIfcText(mmText, "mm.ifc");
  const storey = mmDocument.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withBody = addNativeBodyElement(mmDocument, {
    depth: "2",
    height: "1.5",
    name: "MM Body",
    parentId: storey.id,
    placementMode: "world",
    profile: "rectangle",
    type: "IFCBUILTELEMENT",
    width: "4",
    x: "66.84",
    y: "26.135",
    z: "15.489",
  });
  const body = withBody.entities.find((entity) => entity.name === "MM Body");
  assert.ok(body);
  // Platzierung: Meter-Eingaben landen als Millimeter im Modell.
  const placement = withBody.entityById.get(
    firstStepReference(body.args[5] ?? ""),
  );
  assert.ok(placement);
  const axis = withBody.entityById.get(
    firstStepReference(placement.args[1] ?? ""),
  );
  assert.ok(axis);
  const point = withBody.entityById.get(firstStepReference(axis.args[0] ?? ""));
  assert.equal(point?.args[0], "(66840.,26135.,15489.)");
  // Abmessungen: 4 m x 2 m -> 4000 mm x 2000 mm.
  const profiles = withBody.entities.filter(
    (entity) => entity.type === "IFCRECTANGLEPROFILEDEF",
  );
  const profile = profiles[profiles.length - 1];
  assert.equal(profile?.args[3], "4000.");
  assert.equal(profile?.args[4], "2000.");
});

test("addNativeBodyElement falls back to IFCBUILDINGELEMENTPROXY in pre-IFC4X3 schemas", () => {
  const sample = createNativeSampleDocument();
  const ifc4Text = serializeNativeIfcDocument(sample).replace(
    "IFC4X3_ADD2",
    "IFC4",
  );
  const ifc4Document = parseNativeIfcText(ifc4Text, "ifc4.ifc");
  assert.equal(ifc4Document.schema, "IFC4");
  const storey = ifc4Document.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  const withBody = addNativeBodyElement(ifc4Document, {
    depth: "1",
    height: "1",
    name: "IFC4 Body",
    parentId: storey.id,
    profile: "cylinder",
    type: "IFCBUILTELEMENT",
    width: "1",
    x: "0",
    y: "0",
    z: "0",
  });
  const body = withBody.entities.find((entity) => entity.name === "IFC4 Body");
  assert.equal(body?.type, "IFCBUILDINGELEMENTPROXY");

  // Im IFC4X3-Beispieldokument bleibt IFCBUILTELEMENT erhalten.
  const withNativeType = addNativeBodyElement(sample, {
    depth: "1",
    height: "1",
    name: "X3 Body",
    parentId: storey.id,
    profile: "rectangle",
    type: "IFCBUILTELEMENT",
    width: "1",
    x: "0",
    y: "0",
    z: "0",
  });
  assert.equal(
    withNativeType.entities.find((entity) => entity.name === "X3 Body")?.type,
    "IFCBUILTELEMENT",
  );
});

test("viewer coordinate mapping applies the length unit scale", () => {
  // mm-Modell: 1 m Viewer-Delta = 1000 Modelleinheiten.
  const delta = viewerWorldDeltaToIfcPlacementDelta(
    { x: 1, y: 2, z: 3 },
    0.001,
  );
  assert.deepEqual(delta, { x: 1000, y: -3000, z: 2000 });
  // Rueckrichtung: Modelleinheiten -> Meter.
  const viewer = ifcPlacementPointToViewerWorldPoint(
    { x: 1000, y: -3000, z: 2000 },
    0.001,
  );
  assert.deepEqual(viewer, { x: 1, y: 2, z: 3 });
  // Meter-Modelle bleiben unveraendert.
  assert.deepEqual(viewerWorldDeltaToIfcPlacementDelta({ x: 1, y: 2, z: 3 }), {
    x: 1,
    y: -3,
    z: 2,
  });
});

test("addNativeBodyElement writes pre-calibrated world coordinates verbatim in model units", () => {
  // Simuliert einen zentrierten/georeferenzierten Fall: der Builder hat die
  // echte IFC-Weltkoordinate bereits (in Modell-Einheiten) berechnet und
  // markiert sie mit positionInModelUnits, damit sie NICHT erneut skaliert wird.
  const sample = createNativeSampleDocument();
  const mmText = serializeNativeIfcDocument(sample).replace(
    ".LENGTHUNIT.,$,.METRE.",
    ".LENGTHUNIT.,.MILLI.,.METRE.",
  );
  const mmDocument = parseNativeIfcText(mmText, "mm.ifc");
  const storey = mmDocument.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);

  // Große "Realwelt"-Koordinate (Gauß-Krüger-artig, bereits in mm).
  const withBody = addNativeBodyElement(mmDocument, {
    depth: "2",
    height: "1.5",
    name: "Calibrated Body",
    parentId: storey.id,
    placementMode: "world",
    positionInModelUnits: true,
    profile: "rectangle",
    type: "IFCBUILTELEMENT",
    width: "4",
    x: "3480123456",
    y: "5500987654",
    z: "12345",
  });
  const body = withBody.entities.find(
    (entity) => entity.name === "Calibrated Body",
  );
  assert.ok(body);
  const placement = withBody.entityById.get(
    firstStepReference(body.args[5] ?? ""),
  );
  assert.ok(placement);
  const axis = withBody.entityById.get(
    firstStepReference(placement.args[1] ?? ""),
  );
  assert.ok(axis);
  const point = withBody.entityById.get(firstStepReference(axis.args[0] ?? ""));
  // Position UNVERÄNDERT (keine erneute /1000-Skalierung), ...
  assert.equal(point?.args[0], "(3480123456.,5500987654.,12345.)");
  // ... die Abmessungen aber weiterhin Meter -> mm skaliert (4 m -> 4000 mm).
  const profiles = withBody.entities.filter(
    (entity) => entity.type === "IFCRECTANGLEPROFILEDEF",
  );
  const profile = profiles[profiles.length - 1];
  assert.equal(profile?.args[3], "4000.");
  assert.equal(profile?.args[4], "2000.");

  // getNativePlacementWorld liest die große Weltkoordinate wieder zurück.
  const world = getNativePlacementWorld(withBody, body.id);
  assert.ok(world);
  assert.equal(Math.round(world.worldX), 3480123456);
  assert.equal(Math.round(world.worldY), 5500987654);
  assert.equal(Math.round(world.worldZ), 12345);
});

test("picked-element calibration recovers the real IFC world coordinate of the pick", () => {
  // End-to-End-Rechnung der Builder-Kalibrierung ohne UI:
  //   ziel_ifc = O_ifc(Element) + axisUnswap(viewerPunkt - elementScene)/scale
  // Für ein zentriertes Modell (Element real weit weg, im Viewer aber klein)
  // muss der an der Picker-Stelle erzeugte Körper an der ECHTEN IFC-Welt landen.
  const scale = 1; // Meter-Modell
  // Echte IFC-Weltposition des gepickten Elements (weit vom Ursprung):
  const originIfc = { x: 3480100, y: 5500200, z: 300 };
  // Position desselben Elements im zentrierten Viewer (klein):
  const elementScene = { x: 12, y: 300, z: -34 };
  // Der Nutzer pickt einen Punkt 5 m rechts / 2 m höher / 1 m weiter:
  const viewerPick = {
    x: elementScene.x + 5,
    y: elementScene.y + 2,
    z: elementScene.z - 1,
  };
  const deltaIfc = viewerWorldPointToIfcPlacementPoint(
    {
      x: viewerPick.x - elementScene.x,
      y: viewerPick.y - elementScene.y,
      z: viewerPick.z - elementScene.z,
    },
    scale,
  );
  const targetIfc = {
    x: originIfc.x + deltaIfc.x,
    y: originIfc.y + deltaIfc.y,
    z: originIfc.z + deltaIfc.z,
  };
  // Erwartung: Viewer-Delta (5, 2, -1) -> IFC-Delta (x=5, y=-(-1)=1, z=2).
  assert.deepEqual(deltaIfc, { x: 5, y: 1, z: 2 });
  assert.deepEqual(targetIfc, { x: 3480105, y: 5500201, z: 302 });
  // Und zurück in den Viewer ergibt exakt den Pick-Punkt (relativ zum Element).
  const backDelta = ifcPlacementPointToViewerWorldPoint(deltaIfc, scale);
  assert.deepEqual(backDelta, {
    x: viewerPick.x - elementScene.x,
    y: viewerPick.y - elementScene.y,
    z: viewerPick.z - elementScene.z,
  });
});

test("picked body is placed RELATIVE to the georeferenced element with small local coords", () => {
  // Simuliert ein georeferenziertes Modell: ein Element steht weit vom Ursprung
  // (Gauß-Krüger-artig). Ein an einem gepickten Punkt erzeugter Körper muss
  // relativ zur Platzierung dieses Elements liegen (kleine lokale Koordinaten),
  // NICHT als riesige Absolutkoordinate (die float-Präzision verliert).
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  // Element weit weg schieben (echte IFC-Welt) …
  const geo = updateNativePlacement(sample, block.id, {
    x: "3255405.541",
    y: "5792520.659",
    z: "1.678",
  });
  const blockWorld = getNativePlacementWorld(geo, block.id);
  assert.ok(blockWorld);
  assert.equal(Math.round(blockWorld.worldX), 3255406);

  // Nutzer pickt einen Punkt 5 m in +X, 2 m höher, 1 m in +Z relativ zum
  // Element (worldDelta bereits offset-frei aus (Pick − ElementSzene) berechnet).
  const worldDelta = { x: 5, y: -1, z: 2 };
  const localDelta = nativeWorldDeltaInElementFrame(geo, block.id, worldDelta);
  assert.ok(localDelta);
  // Achsen des Elements sind identisch zur Welt → lokaler Versatz == Weltversatz.
  assert.deepEqual(
    {
      x: Math.round(localDelta.x),
      y: Math.round(localDelta.y),
      z: Math.round(localDelta.z),
    },
    { x: 5, y: -1, z: 2 },
  );

  const storey = geo.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  // Der Builder übergibt die ABSOLUTE IFC-Weltkoordinate des Zielpunkts;
  // die Projektion in die Platzierungskette des Bezugselements übernimmt
  // addNativeBodyElement selbst.
  const withBody = addNativeBodyElement(geo, {
    depth: "1",
    height: "1",
    name: "Picked Marker",
    parentId: storey.id,
    placementMode: "world",
    placementRelativeToId: block.id,
    positionInModelUnits: true,
    profile: "marker",
    type: "IFCBUILTELEMENT",
    width: "1",
    x: String(blockWorld.worldX + worldDelta.x),
    y: String(blockWorld.worldY + worldDelta.y),
    z: String(blockWorld.worldZ + worldDelta.z),
  });
  const body = withBody.entities.find(
    (entity) => entity.name === "Picked Marker",
  );
  assert.ok(body);

  // 1) Die IFCLOCALPLACEMENT des Körpers ist RELATIV zur Platzierung des
  //    gepickten Elements (RelativeTo == dessen IFCLOCALPLACEMENT).
  const bodyPlacement = withBody.entityById.get(
    firstStepReference(body.args[5] ?? ""),
  );
  assert.ok(bodyPlacement);
  assert.equal(bodyPlacement.type, "IFCLOCALPLACEMENT");
  assert.equal(bodyPlacement.args[0], block.args[5]);

  // 2) Die gespeicherten lokalen Koordinaten sind KLEIN (kein 3-Mio-Wert).
  const axis = withBody.entityById.get(
    firstStepReference(bodyPlacement.args[1] ?? ""),
  );
  assert.ok(axis);
  const point = withBody.entityById.get(firstStepReference(axis.args[0] ?? ""));
  assert.ok(point);
  const coords = (point.args[0] ?? "")
    .replace(/[()]/g, "")
    .split(",")
    .map((value) => Number(value));
  for (const value of coords) {
    assert.ok(Math.abs(value) < 1000, `lokale Koordinate zu groß: ${value}`);
  }

  // 3) Trotzdem sitzt der Körper an der ECHTEN Weltposition (Element + Versatz).
  const bodyWorld = getNativePlacementWorld(withBody, body.id);
  assert.ok(bodyWorld);
  assert.equal(Math.round(bodyWorld.worldX), Math.round(blockWorld.worldX + 5));
  assert.equal(Math.round(bodyWorld.worldY), Math.round(blockWorld.worldY - 1));
  assert.equal(Math.round(bodyWorld.worldZ), Math.round(blockWorld.worldZ + 2));
});

test("multiple fragment models retain their IFC-world offsets in one scene", () => {
  // Real coordination origins from the Turm (base) and VLRLP IFCs. Fragments
  // uses base - current as model.object translation when autoCoordinate=true.
  const baseCoordinates = new Vector3(
    -32455042.679142058,
    -128.256040609,
    5497783.06572473,
  );
  const modelCoordinates = new Vector3(
    -32454930.38779673,
    -99.604018586,
    5497746.698481041,
  );
  const modelObject = new Object3D();
  modelObject.position.copy(baseCoordinates).sub(modelCoordinates);

  const ifcWorldToModel = new Matrix4().makeTranslation(
    modelCoordinates.x,
    modelCoordinates.y,
    modelCoordinates.z,
  );
  const modelToIfcWorld = ifcWorldToModel.clone().invert();
  const ifcWorldPoint = new Vector3(
    32454988.793381,
    95.426206,
    -5497757.466828,
  );
  const modelPoint = ifcWorldPoint.clone().applyMatrix4(ifcWorldToModel);
  const scenePoint = fragmentModelPointToScene(modelPoint, modelObject);

  // The shared scene is expressed relative to the first model, not relative
  // to each IFC independently.
  const expectedScenePoint = ifcWorldPoint.clone().add(baseCoordinates);
  assert.ok(scenePoint.distanceTo(expectedScenePoint) < 1e-6);
  assert.ok(
    fragmentScenePointToIfcWorld(
      scenePoint,
      modelObject,
      modelToIfcWorld,
    ).distanceTo(ifcWorldPoint) < 1e-6,
  );

  // The grid uses the same object transform. Switching active models must not
  // drop it back into the independently rebased local frame.
  const localGridPoint = new Vector3(0, modelCoordinates.y + 100, 0);
  const sceneGridPoint = fragmentModelPointToScene(localGridPoint, modelObject);
  assert.ok(Math.abs(sceneGridPoint.y - (baseCoordinates.y + 100)) < 1e-9);

  // Even an identity coordination matrix may still receive a scene offset
  // relative to a georeferenced base model; worldToLocal must always run.
  const identityModelObject = new Object3D();
  identityModelObject.position.set(25, -4, 7);
  const identityLocalPoint = new Vector3(1, 2, 3);
  const identityScenePoint = fragmentModelPointToScene(
    identityLocalPoint,
    identityModelObject,
  );
  assert.ok(
    fragmentScenePointToIfcWorld(
      identityScenePoint,
      identityModelObject,
      null,
    ).distanceTo(identityLocalPoint) < 1e-9,
  );
});

test("rebased viewer pick converts back to the exact IFC world position (end-to-end)", async () => {
  // Georeferenziertes Modell: web-ifc rebased die Geometrie bei
  // COORDINATE_TO_ORIGIN an den Ursprung und liefert die dabei angewendete
  // WELT→URSPRUNG-Matrix (dieselben Werte legt der IfcImporter in der
  // Fragments-Datei ab). Der Viewer speichert deren UMKEHRUNG und rechnet
  // Picks aus dem zentrierten Szenenraum in echte IFC-Weltkoordinaten um.
  // Dieser Test bildet die komplette Kette Pick → Builder → Placement nach.
  const sample = createNativeSampleDocument();
  const block = sample.entities.find(
    (entity) => entity.type === "IFCBUILTELEMENT",
  );
  assert.ok(block);
  const geo = updateNativePlacement(sample, block.id, {
    x: "32555405.364",
    y: "5792521.487",
    z: "5",
  });

  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(
    new TextEncoder().encode(serializeNativeIfcDocument(geo)),
    { COORDINATE_TO_ORIGIN: true },
  );
  const rebasedBounds = streamElementWorldBounds(api, modelID, block.id);
  const coordination = api.GetCoordinationMatrix(modelID);
  api.CloseModel(modelID);

  // Szene ist rebased: Element liegt nahe dem Ursprung, nicht bei 32,5 Mio.
  assert.ok(Math.abs(rebasedBounds.min[0]) < 100);
  assert.ok(Math.abs(rebasedBounds.min[2]) < 100);

  // Wie readFragmentCoordination: Position + X-/Y-Achse der Matrix.
  const stored = [
    coordination[12],
    coordination[13],
    coordination[14],
    coordination[0],
    coordination[1],
    coordination[2],
    coordination[4],
    coordination[5],
    coordination[6],
  ];
  // Wie coordinationToMatrix im Viewer: Welt→Modell und Umkehrung.
  const [px, py, pz, xx, xy, xz, yx, yy, yz] = stored;
  const xDir = new Vector3(xx, xy, xz);
  const yDir = new Vector3(yx, yy, yz);
  const zDir = new Vector3().crossVectors(xDir, yDir);
  const worldToModel = new Matrix4().set(
    xDir.x,
    yDir.x,
    zDir.x,
    px,
    xDir.y,
    yDir.y,
    zDir.y,
    py,
    xDir.z,
    yDir.z,
    zDir.z,
    pz,
    0,
    0,
    0,
    1,
  );
  const modelToWorld = worldToModel.clone().invert();

  // Pick: Mitte der Oberseite des Elements im (rebasten) Szenenraum …
  const scenePick = new Vector3(
    (rebasedBounds.min[0] + rebasedBounds.max[0]) / 2,
    rebasedBounds.max[1],
    (rebasedBounds.min[2] + rebasedBounds.max[2]) / 2,
  );
  // … zurück in IFC-Welt (Viewer-Achsen, wie sceneToIfcWorldPoint) …
  const ifcViewerPoint = scenePick.clone().applyMatrix4(modelToWorld);
  // … und in IFC-Placement-Achsen (wie addBodyElement im Workspace).
  const ifcPoint = viewerWorldPointToIfcPlacementPoint(ifcViewerPoint);
  // Block: 4 x 2 m Grundriss zentriert auf der Platzierung, 1.5 m hoch.
  assert.ok(Math.abs(ifcPoint.x - 32555405.364) < 0.01, `x: ${ifcPoint.x}`);
  assert.ok(Math.abs(ifcPoint.y - 5792521.487) < 0.01, `y: ${ifcPoint.y}`);
  assert.ok(Math.abs(ifcPoint.z - 6.5) < 0.01, `z: ${ifcPoint.z}`);

  // Builder: Weltmodus-Körper an der gepickten Stelle unter dem Storey.
  const storey = geo.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withBody = addNativeBodyElement(geo, {
    depth: "1",
    height: "1",
    name: "Rebase Pick Marker",
    parentId: storey.id,
    placementMode: "world",
    positionInModelUnits: true,
    profile: "marker",
    type: "IFCBUILTELEMENT",
    width: "1",
    x: String(ifcPoint.x),
    y: String(ifcPoint.y),
    z: String(ifcPoint.z),
  });
  const body = withBody.entities.find(
    (entity) => entity.name === "Rebase Pick Marker",
  );
  assert.ok(body);
  const bodyWorld = getNativePlacementWorld(withBody, body.id);
  assert.ok(bodyWorld);
  assert.ok(Math.abs(bodyWorld.worldX - ifcPoint.x) < 0.01);
  assert.ok(Math.abs(bodyWorld.worldY - ifcPoint.y) < 0.01);
  assert.ok(Math.abs(bodyWorld.worldZ - ifcPoint.z) < 0.01);
});
