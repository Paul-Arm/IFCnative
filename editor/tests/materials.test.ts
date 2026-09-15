import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as WebIFC from "web-ifc";
import { createNativeMaterial, createNativeSampleDocument, parseNativeIfcText, serializeNativeIfcDocument, assignNativeMaterial, duplicateNativeBodyElement, combineNativeBodyElements } from "../src/ifc/nativeDocument";
import { assignMaterialWithAppearance, readMaterialAppearances, updateMaterialAppearance, readMaterialPropertySets, saveMaterialProperty } from "../src/ifc/materialEditing";
import { createDocumentTransaction, commitDocumentTransaction, createWorkspaceDocumentSession, restoreDocumentTransaction } from "../src/components/ifc-workspace/documentTransaction";

const appearance = { color: "#d42a80", transparency: 0.25, reflectance: "PHONG", roughness: 0.4, specular: 0.7 };
const material = () => createNativeMaterial(createNativeSampleDocument(), { name: "Material", category: "", description: "" });
const parse = (data: string, schema = "IFC4") => parseNativeIfcText(`ISO-10303-21;HEADER;FILE_SCHEMA(('${schema}'));ENDSEC;DATA;${data}ENDSEC;END-ISO-10303-21;`, "material.ifc");

test("material colour replaces the imported orange geometry style on borehole 914 without recolouring neighbours", async () => {
  const source = parseNativeIfcText(readFileSync(new URL("./fixtures/attribution/diagnostik-einzelergebnisse.ifc", import.meta.url), "utf8"), "diagnostik.ifc");
  const created = createNativeMaterial(source, { name: "test", category: "holz", description: "" });
  const assigned = assignNativeMaterial(created.document, [914], created.materialId);
  const next = updateMaterialAppearance(assigned, created.materialId, undefined, { color: "#0b82cb", transparency: 0, reflectance: "PHONG" });
  const api = new WebIFC.IfcAPI(); await api.Init();
  const originalId = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(source)));
  const newId = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(next)));
  try {
    const target = api.GetFlatMesh(newId, 914);
    assert.ok(target.geometries.size() > 0);
    for (let i = 0; i < target.geometries.size(); i++) {
      const geometry = target.geometries.get(i);
      assert.ok(Math.abs(geometry.color.x - 11 / 255) < 0.001, JSON.stringify(geometry.color));
      assert.ok(Math.abs(geometry.color.y - 130 / 255) < 0.001);
      assert.ok(Math.abs(geometry.color.z - 203 / 255) < 0.001);
      assert.deepEqual(geometry.flatTransformation, api.GetFlatMesh(originalId, 914).geometries.get(i).flatTransformation);
    }
    assert.deepEqual(api.GetFlatMesh(newId, 692).geometries.get(0).color, api.GetFlatMesh(originalId, 692).geometries.get(0).color);
    assert.equal(next.entityById.get(242), source.entityById.get(242), "shared original orange style is untouched");
    assert.ok(!parseNativeIfcText(serializeNativeIfcDocument(next), "saved.ifc").diagnostics.some((line) => line.includes("references missing")));
  } finally { api.CloseModel(originalId); api.CloseModel(newId); }
});

test("material appearance writes a renderable IFC style with RGB and transparency", async () => {
  const created = material();
  const sourceId = created.document.entitiesByType.get("IFCBUILTELEMENT")![0].id;
  const assigned = assignNativeMaterial(created.document, [sourceId], created.materialId);
  const next = updateMaterialAppearance(assigned, created.materialId, undefined, appearance);
  const [style] = readMaterialAppearances(next, created.materialId);
  assert.equal(style.color, appearance.color);
  assert.equal(style.transparency, 0.25);
  assert.equal(style.roughness, 0.4);
  assert.equal(style.specular, 0.7);
  const text = serializeNativeIfcDocument(next);
  assert.ok(!parseNativeIfcText(text, "roundtrip.ifc").diagnostics.some((line) => line.includes("references missing")));
  const api = new WebIFC.IfcAPI(); await api.Init();
  const id = api.OpenModel(new TextEncoder().encode(text));
  try {
    const mesh = api.GetFlatMesh(id, sourceId);
    assert.ok(mesh.geometries.size() > 0);
    const color = mesh.geometries.get(0).color;
    assert.ok(Math.abs(color.x - 212 / 255) < 0.001, JSON.stringify(color));
    assert.ok(Math.abs(color.y - 42 / 255) < 0.001, JSON.stringify(color));
    assert.ok(Math.abs(color.w - 0.75) < 0.001, JSON.stringify(color));
  } finally { api.CloseModel(id); }
});

test("assigning an existing coloured material isolates shared geometry, supports subsequent edits and undo", async () => {
  const source = parseNativeIfcText(readFileSync(new URL("./fixtures/attribution/diagnostik-einzelergebnisse.ifc", import.meta.url), "utf8"), "diagnostik.ifc");
  const duplicated = duplicateNativeBodyElement(source, 914)!;
  assert.ok(duplicated);
  assert.equal(duplicated.document.entityById.get(914)!.args[6], duplicated.document.entityById.get(duplicated.productId)!.args[6]);
  const material = createNativeMaterial(duplicated.document, { name: "Blue", category: "", description: "" });
  const styled = updateMaterialAppearance(material.document, material.materialId, undefined, { color: "#0000ff", transparency: 0.2, reflectance: "PHONG" });
  const assigned = assignMaterialWithAppearance(styled, [duplicated.productId], material.materialId);
  assert.notEqual(assigned.entityById.get(914)!.args[6], assigned.entityById.get(duplicated.productId)!.args[6]);
  assert.equal(assignMaterialWithAppearance(assigned, [duplicated.productId], material.materialId), assigned, "same assignment does not clone again");
  const edited = updateMaterialAppearance(assigned, material.materialId, readMaterialAppearances(assigned, material.materialId)[0].id, { color: "#00ff00", transparency: 0.4, reflectance: "PHONG" });
  const api = new WebIFC.IfcAPI(); await api.Init();
  for (const [doc, expected] of [[assigned, { r: 0, g: 0, b: 1, alpha: 0.8 }], [edited, { r: 0, g: 1, b: 0, alpha: 0.6 }]] as const) {
    const id = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(doc)));
    try {
      const color = api.GetFlatMesh(id, duplicated.productId).geometries.get(0).color;
      assert.deepEqual([color.x, color.y, color.z, color.w], [expected.r, expected.g, expected.b, expected.alpha]);
      assert.ok(Math.abs(api.GetFlatMesh(id, 914).geometries.get(0).color.x - 0.882352941176471) < 0.001);
    } finally { api.CloseModel(id); }
  }
  const committed = commitDocumentTransaction(createWorkspaceDocumentSession(styled), createDocumentTransaction(styled, assigned, "Material assignment"), { refreshViewer: true });
  const undone = restoreDocumentTransaction(committed, "undo");
  assert.equal(serializeNativeIfcDocument(undone.document), serializeNativeIfcDocument(styled));
  assert.equal(serializeNativeIfcDocument(restoreDocumentTransaction(undone, "redo").document), serializeNativeIfcDocument(assigned));
});

test("material assignment follows mapped geometry without moving it or recolouring its source products", async () => {
  const source = parseNativeIfcText(readFileSync(new URL("./fixtures/attribution/diagnostik-einzelergebnisse.ifc", import.meta.url), "utf8"), "diagnostik.ifc");
  const combined = combineNativeBodyElements(source, [914, 692], { removeSources: false });
  assert.ok(combined);
  const created = createNativeMaterial(combined.document, { name: "Blue", category: "", description: "" });
  const styled = updateMaterialAppearance(created.document, created.materialId, undefined, { color: "#0000ff", transparency: 0, reflectance: "PHONG" });
  const assigned = assignMaterialWithAppearance(styled, [combined.productId], created.materialId);
  const api = new WebIFC.IfcAPI(); await api.Init();
  const before = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(styled)));
  const after = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(assigned)));
  try {
    const original = api.GetFlatMesh(before, combined.productId);
    const updated = api.GetFlatMesh(after, combined.productId);
    assert.ok(updated.geometries.size() >= 2);
    assert.equal(updated.geometries.size(), original.geometries.size());
    for (let i = 0; i < updated.geometries.size(); i++) {
      assert.deepEqual(updated.geometries.get(i).color, { x: 0, y: 0, z: 1, w: 1 });
      assert.deepEqual(updated.geometries.get(i).flatTransformation, original.geometries.get(i).flatTransformation);
    }
    for (const id of [914, 692]) assert.deepEqual(api.GetFlatMesh(after, id).geometries.get(0).color, api.GetFlatMesh(before, id).geometries.get(0).color);
  } finally { api.CloseModel(before); api.CloseModel(after); }
});

test("editing a shared surface style isolates its material and preserves names, textures and other rendering fields", () => {
  const source = parse(`
#1=IFCMATERIAL('A',$,$); #2=IFCMATERIAL('B',$,$);
#3=IFCCOLOURRGB($,0.1,0.2,0.3);
#4=IFCSURFACESTYLERENDERING(#3,0.,$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.6),IFCSPECULAREXPONENT(12.),.PHONG.);
#5=IFCSURFACESTYLE('Shared #4',.BOTH.,(#4,#10));
#6=IFCSTYLEDITEM($,(#5),'Shared'); #7=IFCSTYLEDREPRESENTATION(#20,'Style','Material',(#6));
#8=IFCMATERIALDEFINITIONREPRESENTATION('A',$,(#7),#1);
#9=IFCMATERIALDEFINITIONREPRESENTATION('B',$,(#7),#2);
#10=IFCSURFACESTYLEWITHTEXTURES((#11)); #11=IFCIMAGETEXTURE(.T.,.T.,$,$,$,'texture.png');
#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#21,$);
#21=IFCAXIS2PLACEMENT3D(#22,$,$); #22=IFCCARTESIANPOINT((0.,0.,0.));`);
  const next = updateMaterialAppearance(source, 1, 4, { color: "#00ff00", transparency: 0.1, reflectance: "PHONG" });
  assert.equal(readMaterialAppearances(next, 1)[0].color, "#00ff00");
  assert.equal(readMaterialAppearances(next, 2)[0].color, "#1a334d");
  assert.equal(next.entityById.get(4), source.entityById.get(4));
  assert.equal(next.entityById.get(9), source.entityById.get(9));
  const updated = next.entityById.get(readMaterialAppearances(next, 1)[0].id)!;
  assert.equal(updated.args[7], "IFCSPECULAREXPONENT(12.)");
  assert.ok(next.entities.some((entity) => entity.id > 22 && entity.type === "IFCSURFACESTYLE" && entity.args[0] === "'Shared #4'" && entity.args[2].includes("#10")));
});

test("material properties use numeric measure values, retain units and round trip through IFC2X3/IFC4", async () => {
  const api = new WebIFC.IfcAPI(); await api.Init();
  for (const schema of ["IFC2X3", "IFC4"]) {
    const source = parse(schema === "IFC2X3" ? "#1=IFCMATERIAL('A');" : "#1=IFCMATERIAL('A',$,$);", schema);
    const next = saveMaterialProperty(source, 1, { setName: "Pset_MaterialCommon", name: "MassDensity", value: "2400.5", valueType: "IFCMASSDENSITYMEASURE" });
    const [set] = readMaterialPropertySets(next, 1);
    assert.equal(set.legacy, schema === "IFC2X3");
    assert.equal(set.properties[0].args[2], "IFCMASSDENSITYMEASURE(2400.5)");
    const id = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(next)));
    try {
      const prop = api.GetLine(id, set.properties[0].id);
      assert.equal(prop.NominalValue.value, 2400.5);
      assert.equal(api.GetLine(id, set.id).Material.value, 1);
    } finally { api.CloseModel(id); }
  }
});

test("editing shared properties preserves other materials, descriptions, units and complex properties", () => {
  const source = parse(`#1=IFCMATERIAL('A',$,$); #2=IFCMATERIAL('B',$,$);
#3=IFCPROPERTYSINGLEVALUE('Density','Description',IFCMASSDENSITYMEASURE(1000.),#8);
#4=IFCPROPERTYLISTVALUE('Layers',$,(IFCLABEL('A'),IFCLABEL('B')),$);
#5=IFCMATERIALPROPERTIES('Common',$,(#3,#4),#1); #6=IFCMATERIALPROPERTIES('Common',$,(#3),#2);
#8=IFCDERIVEDUNIT((),.MASSDENSITYUNIT.,$);`);
  const next = saveMaterialProperty(source, 1, { setId: 5, propertyId: 3, setName: "Common", name: "Density", valueType: "IFCMASSDENSITYMEASURE", value: "2400", unitId: 8 });
  assert.equal(next.entityById.get(3), source.entityById.get(3));
  assert.equal(readMaterialPropertySets(next, 2)[0].properties[0].args[2], "IFCMASSDENSITYMEASURE(1000.)");
  const properties = readMaterialPropertySets(next, 1)[0].properties;
  assert.deepEqual(properties[0].args.slice(1), ["'Description'", "IFCMASSDENSITYMEASURE(2400)", "#8"]);
  assert.equal(properties[1], source.entityById.get(4));
  const committed = commitDocumentTransaction(createWorkspaceDocumentSession(source), createDocumentTransaction(source, next, "Material property"));
  assert.deepEqual(committed.pendingViewerChanges, []);
  assert.equal(serializeNativeIfcDocument(restoreDocumentTransaction(committed, "undo").document), serializeNativeIfcDocument(source));
});

test("material property validation rejects bad values and unrelated resources without partial writes", () => {
  const source = material();
  const draft = { setName: "Common", name: "Density", valueType: "IFCMASSDENSITYMEASURE", value: "oops" };
  assert.throws(() => saveMaterialProperty(source.document, source.materialId, draft));
  assert.throws(() => saveMaterialProperty(source.document, source.materialId, { ...draft, value: "4", unitId: source.materialId }));
  assert.throws(() => updateMaterialAppearance(source.document, source.materialId, 999, appearance));
  assert.throws(() => updateMaterialAppearance(source.document, source.materialId, undefined, { ...appearance, transparency: 2 }));
});

test("IFC2X3 appearance creates a presentation assignment and reuses existing material definitions", async () => {
  const source = parse(`#1=IFCMATERIAL('A');
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#3,$);
#3=IFCAXIS2PLACEMENT3D(#4,$,$); #4=IFCCARTESIANPOINT((0.,0.,0.));
#5=IFCSURFACESTYLE('Texture',.BOTH.,(#6)); #6=IFCSURFACESTYLEWITHTEXTURES((#7));
#7=IFCIMAGETEXTURE(.T.,.T.,$,$,'texture.png');
#8=IFCPRESENTATIONSTYLEASSIGNMENT((#5)); #9=IFCSTYLEDITEM($,(#8),$);
#10=IFCSTYLEDREPRESENTATION(#2,'Style','Material',(#9));
#11=IFCMATERIALDEFINITIONREPRESENTATION($,$,(#10),#1);`, "IFC2X3");
  const next = updateMaterialAppearance(source, 1, undefined, appearance);
  assert.equal(next.entitiesByType.get("IFCMATERIALDEFINITIONREPRESENTATION")?.length, 1);
  assert.equal(next.entitiesByType.get("IFCPRESENTATIONSTYLEASSIGNMENT")?.length, 2);
  assert.equal(next.entityById.get(5), source.entityById.get(5));
  const [style] = readMaterialAppearances(next, 1);
  const api = new WebIFC.IfcAPI(); await api.Init();
  const id = api.OpenModel(new TextEncoder().encode(serializeNativeIfcDocument(next)));
  try {
    const rendering = api.GetLine(id, style.id);
    assert.equal(rendering.Transparency.value, 0.25);
    assert.equal(rendering.ReflectanceMethod.value, "PHONG");
  } finally { api.CloseModel(id); }
});
