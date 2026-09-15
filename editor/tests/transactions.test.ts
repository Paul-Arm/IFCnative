import assert from "node:assert/strict";
import test from "node:test";
import {
  addNativePropertySet, addNativePropertySetValues, addNativeEmptyPropertySet,
  addNativeQuantitySet, mergeNativePropertySetValues, addNativePropertyToSet, batchNativeDocument,
  createNativeSampleDocument, getNativePlacement, getNativePlacementWorldFrame,
  parseNativeIfcText, readReferences, removeNativePropertySet, serializeNativeIfcDocument,
  splitNativeBodyByPlane,
  assignNativeMaterial, canAssignNativeMaterial, createNativeMaterial, updateNativeMaterial,
  updateNativeEntity, updateNativePlacement, updateNativePlacementRotation, updateNativePropertyValue,
  type NativeIfcDocument,
} from "../src/ifc/nativeDocument";
import {
  acknowledgeDocumentSave, captureDocumentSave, commitDocumentTransaction,
  createDocumentTransaction, createWorkspaceDocumentSession, restoreDocumentTransaction,
  readDocumentText, refreshDocumentViewer, requestDocumentViewerLoad,
} from "../src/components/ifc-workspace/documentTransaction";
import { saveIfcFile } from "../src/desktop/saveIfc";
import { pickFiles } from "../src/desktop/pickFiles";
import { readIfcBytes, toExactArrayBuffer } from "../src/ifc/ifcBytes";
import { previewEntityAwareDiffLines, summarizeEntityAwareDiff } from "../src/ifc/entityDiff";
import { loadWorkspaceDocument, loadWorkspaceDocuments } from "../src/components/ifc-workspace/documentLoading";
import { scanStepEntities, splitStepArguments } from "../src/ifc/stepScanner";

const ifc = (body: string, schema = "IFC4") => `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('${schema}'));\nENDSEC;\nDATA;\n${body}\nENDSEC;\nEND-ISO-10303-21;`;
const parse = (body: string, schema?: string) => parseNativeIfcText(ifc(body, schema), "regression.ifc");
const sharedPlacement = () => parse(`
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCLOCALPLACEMENT($,#2);
#4=IFCWALL('0000000000000000000001',$,'A',$,$,#3,$,$,.NOTDEFINED.);
#5=IFCWALL('0000000000000000000002',$,'B',$,$,#3,$,$,.NOTDEFINED.);`);

test("material library creates and edits schema-correct standalone materials with STEP escaping", () => {
  for (const schema of ["IFC4", "IFC2X3"]) {
    const base = parse("#1=IFCCARTESIANPOINT((0.,0.,0.));", schema);
    const draft = { name: "Béton O'Brien", description: "Dämmung", category: "Beton" };
    const created = createNativeMaterial(base, draft);
    assert.equal(created.document.entitiesByType.get("IFCRELASSOCIATESMATERIAL"), undefined);
    const material = created.document.entityById.get(created.materialId)!;
    assert.equal(material.name, draft.name);
    assert.equal(material.args.length, schema === "IFC2X3" ? 1 : 3);
    const edited = updateNativeMaterial(created.document, material.id, { ...draft, name: "Stahl", category: "Metall" });
    const reopened = parseNativeIfcText(serializeNativeIfcDocument(edited), "materials.ifc");
    assert.equal(reopened.entityById.get(material.id)?.name, "Stahl");
    assert.equal(reopened.entityById.get(material.id)?.description, schema === "IFC2X3" ? "" : draft.description);
    assert.equal(material.name, draft.name, "editing never mutates shared source data");
    const session = createWorkspaceDocumentSession(created.document);
    const committed = commitDocumentTransaction(session, createDocumentTransaction(created.document, edited, "Edit material"));
    assert.equal(committed.hasUnexportedChanges, true);
    assert.deepEqual(committed.pendingViewerChanges, []);
    assertIndexes(reopened);
  }
});

const sharedMaterials = () => parse(`
#1=IFCWALL('0000000000000000000001',$,'A',$,$,$,$,$,.NOTDEFINED.);
#2=IFCWALL('0000000000000000000002',$,'B',$,$,$,$,$,.NOTDEFINED.);
#3=IFCWALL('0000000000000000000003',$,'C',$,$,$,$,$,.NOTDEFINED.);
#10=IFCMATERIAL('Beton',$,'Beton');
#11=IFCMATERIAL('Stahl',$,'Metall');
#12=IFCMATERIALLAYER(#10,0.2,$,$,$,$,$);
#13=IFCMATERIALLAYERSET((#12),'Wand',$);
#20=IFCRELASSOCIATESMATERIAL('0000000000000000000020',$,$,$,(#1,#2),#13);
#21=IFCRELASSOCIATESMATERIAL('0000000000000000000021',$,$,$,(#3),#11);`);

test("material assignment replaces only selected members of a shared layer-set relation", () => {
  const base = sharedMaterials();
  const next = assignNativeMaterial(base, [1, 1, 10, 999], 11);
  assert.deepEqual(readReferences(next.entityById.get(20)!.args[4]), [2]);
  assert.deepEqual(readReferences(next.entityById.get(21)!.args[4]), [3, 1]);
  assert.equal(next.entityById.get(12), base.entityById.get(12));
  assert.equal(next.entityById.get(13), base.entityById.get(13));
  assert.deepEqual(readReferences(base.entityById.get(20)!.args[4]), [1, 2]);
  assert.equal(canAssignNativeMaterial(base, 10), false);
  assert.equal(canAssignNativeMaterial(base, 20), false);
  assert.equal(assignNativeMaterial(next, [1, 3], 11), next, "reassigning same material is a no-op");
  assert.equal(assignNativeMaterial(base, [1], 999), base);
  assertIndexes(next);
});

test("bulk material assignment round trips, removes empty relations and is one undoable transaction", () => {
  const base = sharedMaterials();
  const next = assignNativeMaterial(base, [1, 2, 3], 10);
  const relations = next.entitiesByType.get("IFCRELASSOCIATESMATERIAL")!;
  assert.equal(relations.length, 1);
  assert.deepEqual(readReferences(relations[0].args[4]), [1, 2, 3]);
  assert.equal(relations[0].args[5], "#10");
  const session = createWorkspaceDocumentSession(base);
  const committed = commitDocumentTransaction(session, createDocumentTransaction(base, next, "Assign material"), { refreshViewer: true });
  assert.equal(committed.undoStack.length, 1);
  assert.equal(committed.viewerModelText, captureDocumentSave(committed).text);
  const reopened = parseNativeIfcText(captureDocumentSave(committed).text, "materials.ifc");
  assert.ok(!reopened.diagnostics.some((message) => message.includes("references missing")));
  assertIndexes(reopened);
  const undone = restoreDocumentTransaction(committed, "undo");
  assert.equal(serializeNativeIfcDocument(undone.document), serializeNativeIfcDocument(base));
  assert.equal(serializeNativeIfcDocument(restoreDocumentTransaction(undone, "redo").document), serializeNativeIfcDocument(next));
});
function assertIndexes(document: NativeIfcDocument) {
  assert.equal(new Set(document.entities.map((entity) => entity.id)).size, document.entities.length);
  for (const entity of document.entities) {
    assert.equal(document.entityById.get(entity.id), entity);
    assert.ok(document.entitiesByType.get(entity.type)?.includes(entity));
    const refs = [...new Set(entity.args.flatMap(readReferences))];
    assert.deepEqual(document.outgoingRefs.get(entity.id), refs);
    for (const ref of refs) assert.ok(document.incomingRefs.get(ref)?.includes(entity));
  }
  for (const incoming of document.incomingRefs.values()) {
    for (const entity of incoming) assert.equal(document.entityById.get(entity.id), entity);
  }
}

test("STEP whitespace, block comments and quoted entity-like text round trip", () => {
  const text = `/* #90=IFCMATERIAL('comment',$,$); */
#1 /* id */ = IFCMATERIAL('literal #92=IFCWALL(''x''); /* text */','desc','category') \n ;
#2=IFCPROPERTYSINGLEVALUE('reference #999',$,IFCLABEL('O''Brien (#700)'),#1) ;`;
  const document = parse(text);
  assert.equal(document.entities.length, 2);
  assert.deepEqual(document.outgoingRefs.get(1), []);
  assert.deepEqual(document.outgoingRefs.get(2), [1]);
  const restored = parseNativeIfcText(serializeNativeIfcDocument(document), "roundtrip.ifc");
  assert.deepEqual(restored.entities, document.entities);
});

test("STEP import aborts on malformed or duplicate entities instead of losing records", () => {
  for (const malformed of [
    "#1=IFCMATERIAL('ok',$,$); #2=IFCWALL('broken'); #2=IFCWALL('duplicate');",
    "#1=IFCMATERIAL('ok',$,$); #2=IFCWALL('unfinished',",
    "#1=IFCMATERIAL('ok',$,$); #2=IFCWALL('unclosed);",
    "#1=IFCMATERIAL('ok',$,$) #2=IFCMATERIAL('next',$,$);",
    "#1=IFCMATERIAL('ok',$,$); /* unclosed",
  ]) assert.throws(() => parse(malformed));
});

test("STEP scanner retains nested geometry, string delimiters and entity offsets", () => {
  const coordinates = `(${Array.from({ length: 20_000 }, (_,i) => `(${i}.,-1.2E-3,0.)`).join(",")})`;
  const scan = scanStepEntities(ifc(`#1=IFCCARTESIANPOINTLIST3D(${coordinates});
#2=IFCTRIANGULATEDFACESET(#1,$,.T.,((1,2,3),(3,2,1)),$);
#3=IFCPROPERTYSINGLEVALUE('O''Brien /* #99 */ ,);',$,IFCLABEL('(#999);'),#2/* #88 */);`));
  assert.equal(scan.entities.length, 3);
  assert.deepEqual(scan.entities[0].args, [coordinates]);
  assert.deepEqual(scan.entities[1].args, ["#1", "$", ".T.", "((1,2,3),(3,2,1))", "$"]);
  assert.deepEqual(scan.entities[2].args, ["'O''Brien /* #99 */ ,);'", "$", "IFCLABEL('(#999);')", "#2"]);
  assert.deepEqual(readReferences(scan.entities[2].args.join(",")), [2]);
  assert.deepEqual(readReferences(coordinates), []);
  for (const entity of scan.entities) {
    const source = scan.text.slice(entity.start, entity.end);
    assert.ok(source.startsWith(`#${entity.id}=`));
    assert.ok(source.endsWith(");"));
    assert.deepEqual(splitStepArguments(source.slice(source.indexOf("(") + 1, -2)), entity.args);
  }
  assert.deepEqual(splitStepArguments(""), []);
  for (const malformed of ["((1,2)", "(1,2))", "'unterminated", "/* unterminated"]) {
    assert.throws(() => splitStepArguments(malformed));
  }
  for (const malformed of ["#1=IFCTEST(((1,2));", "#1=IFCTEST((1,2)));", "#1=IFCTEST();#1=IFCTEST();"]) {
    assert.throws(() => scanStepEntities(malformed));
  }
});

test("inspector edits respect material and property attribute layouts in each schema", () => {
  const document = parse("#1=IFCMATERIAL('Steel','Material description','Metal'); #2=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(12.),$);");
  const renamed = updateNativeEntity(document, 1, { name: "Concrete", description: "New description" });
  assert.deepEqual(renamed.entityById.get(1)?.args, ["'Concrete'", "'New description'", "'Metal'"]);
  const property = updateNativeEntity(document, 2, { name: "Height", description: "Property description" });
  assert.deepEqual(property.entityById.get(2)?.args, ["'Height'", "'Property description'", "IFCLENGTHMEASURE(12.)", "$"]);
  const older = updateNativeEntity(parse("#1=IFCMATERIAL('Steel');", "IFC2X3"), 1, { name: "Concrete", description: "Unsupported" });
  assert.deepEqual(older.entityById.get(1)?.args, ["'Concrete'"]);
  assert.equal(document.entityById.get(1)?.name, "Steel");
});

test("raw attribute edits stay authoritative and never mutate caller arguments", () => {
  const document = parse("#1=IFCMATERIAL('Steel','Description','Metal');");
  const args = ["'Raw name'", "'Raw description'", "'Raw category'"];
  const edited = updateNativeEntity(document, 1, { args });
  assert.deepEqual(edited.entityById.get(1)?.args, args);
  assert.equal(edited.entityById.get(1)?.name, "Raw name");
  const overridden = updateNativeEntity(document, 1, { args, name: "Explicit" });
  assert.equal(overridden.entityById.get(1)?.name, "Explicit");
  assert.equal(args[0], "'Raw name'");
});

test("new roots receive independent IFC GlobalIds across branches with identical STEP IDs", () => {
  const base = sharedPlacement();
  const branches = Array.from({ length: 30 }, () => addNativePropertySet(base, 4, "Pset_Test", "Value", "x"));
  const guids = branches.flatMap((document) => document.entities.filter((entity) => !base.entityById.has(entity.id) && (entity.type === "IFCPROPERTYSET" || entity.type.startsWith("IFCREL"))).map((entity) => {
    assert.match(entity.globalId, /^[0-3][0-9A-Za-z_$]{21}$/);
    assert.equal(entity.args[0], `'${entity.globalId}'`);
    return entity.globalId;
  }));
  assert.equal(guids.length, 60);
  assert.equal(new Set(guids).size, guids.length);
});

test("moving a product detaches a shared local placement and preserves its sibling", () => {
  const base = sharedPlacement();
  const before = serializeNativeIfcDocument(base);
  const next = updateNativePlacement(base, 4, { x: 12, y: 3 });
  assert.equal(getNativePlacement(next, 4)?.x, 12);
  assert.equal(getNativePlacement(next, 5)?.x, 0);
  assert.notEqual(next.entityById.get(4)?.args[5], next.entityById.get(5)?.args[5]);
  assert.equal(serializeNativeIfcDocument(base), before);
  assertIndexes(next);
});

test("rotating a product detaches shared placement without rotating its sibling", () => {
  const base = sharedPlacement();
  const sibling = getNativePlacementWorldFrame(base, 5);
  const next = updateNativePlacementRotation(base, 4, { axis: { x: 0, y: 0, z: 1 }, refDirection: { x: 0, y: 1, z: 0 } });
  assert.deepEqual(getNativePlacementWorldFrame(next, 5), sibling);
  assert.notDeepEqual(getNativePlacementWorldFrame(next, 4), getNativePlacementWorldFrame(base, 4));
  assertIndexes(next);
});

test("batch edits isolate the base, update derived properties and commit coherent indexes", () => {
  const base = addNativePropertySet(sharedPlacement(), 4, "Pset_Test", "Value", "old");
  const before = serializeNativeIfcDocument(base);
  const propertyId = base.entities.find((entity) => entity.type === "IFCPROPERTYSINGLEVALUE")!.id;
  const setId = base.entities.find((entity) => entity.type === "IFCPROPERTYSET")!.id;
  const next = batchNativeDocument(base, (draft) => {
    let current = updateNativePropertyValue(draft, propertyId, { value: "new" });
    assert.equal(serializeNativeIfcDocument(base), before);
    current = addNativePropertyToSet(current, setId, "Second", "2", "IFCINTEGER");
    current = batchNativeDocument(current, (nested) => addNativePropertySet(nested, 5, "Pset_Other", "Other", "value"));
    return updateNativePlacement(current, 4, { x: 42 });
  });
  assert.equal(serializeNativeIfcDocument(base), before);
  assertIndexes(base);
  assertIndexes(next);
  const restored = parseNativeIfcText(serializeNativeIfcDocument(next), "roundtrip.ifc");
  assert.deepEqual(next.propertySetsByEntity, restored.propertySetsByEntity);
  assert.equal(getNativePlacement(next, 4)?.x, 42);
  assert.equal(next.propertySetsByEntity.get(4)?.[0].values.length, 2);
});

test("failed batch rolls back additions, derived summaries and value changes", () => {
  const base = addNativePropertySet(sharedPlacement(), 4, "Pset_Test", "Value", "old");
  const before = serializeNativeIfcDocument(base);
  const propertyId = base.entities.find((entity) => entity.type === "IFCPROPERTYSINGLEVALUE")!.id;
  assert.throws(() => batchNativeDocument(base, (draft) => {
    const next = updateNativePropertyValue(draft, propertyId, { value: "changed" });
    addNativePropertySet(next, 5, "Pset_New", "Added", "value");
    throw new Error("rollback");
  }), /rollback/);
  assert.equal(serializeNativeIfcDocument(base), before);
  assertIndexes(base);
  assert.equal(base.propertySetsByEntity.get(5), undefined);
});

test("batch no-ops preserve document identity and mixed removals do not reuse live IDs", () => {
  const base = sharedPlacement();
  assert.equal(batchNativeDocument(base, (draft) => draft), base);
  const result = batchNativeDocument(base, (draft) => {
    let next = addNativePropertySet(draft, 4, "Pset_A", "A", "a");
    const setId = next.entities.find((entity) => entity.type === "IFCPROPERTYSET")!.id;
    next = removeNativePropertySet(next, 4, setId);
    next = addNativePropertySet(next, 5, "Pset_B", "B", "b");
    return { document: next, count: 1 };
  });
  assert.equal(result.count, 1);
  assertIndexes(result.document);
  assert.equal(result.document.propertySetsByEntity.get(4)?.length ?? 0, 0);
  assert.equal(result.document.propertySetsByEntity.get(5)?.[0].name, "Pset_B");
});

test("metadata transaction and undo/redo preserve the viewer snapshot and pending geometry", () => {
  const base = sharedPlacement();
  const initial = createWorkspaceDocumentSession(base);
  initial.pendingViewerChanges = [{ key: "older", label: "Earlier geometry edit" }];
  const next = updateNativeEntity(base, 4, { name: "Renamed" });
  const transaction = createDocumentTransaction(base, next, "Rename");
  assert.equal(transaction.affectsGeometry, false);
  const edited = commitDocumentTransaction(initial, transaction);
  assert.equal(edited.undoStack.length, 1);
  assert.equal(edited.documentRevision, 1);
  assert.equal(edited.hasUnexportedChanges, true);
  const undone = restoreDocumentTransaction(edited, "undo");
  const redone = restoreDocumentTransaction(undone, "redo");
  assert.equal(undone.document.entityById.get(4)?.name, "A");
  assert.equal(redone.document.entityById.get(4)?.name, "Renamed");
  for (const session of [edited, undone, redone]) {
    assert.equal(session.viewerModelRevision, initial.viewerModelRevision);
    assert.equal(session.viewerModelText, initial.viewerModelText);
    assert.deepEqual(session.pendingViewerChanges, initial.pendingViewerChanges);
  }
  assert.equal(redone.documentRevision, 3);
});

test("geometry transactions coalesce viewer invalidation and restore geometry through history", () => {
  const initial = createWorkspaceDocumentSession(sharedPlacement());
  const next = updateNativePlacement(initial.document, 4, { x: 8 });
  const edited = commitDocumentTransaction(initial, createDocumentTransaction(initial.document, next, "Move"), { pendingKey: "move:4" });
  assert.equal(edited.pendingViewerChanges.length, 1);
  assert.equal(edited.undoStack[0].affectsGeometry, true);
  const second = commitDocumentTransaction(edited, createDocumentTransaction(next, updateNativePlacement(next, 4, { x: 9 }), "Move again"), { pendingKey: "move:4" });
  assert.equal(second.pendingViewerChanges.length, 1);
  const undone = restoreDocumentTransaction(second, "undo");
  assert.equal(getNativePlacement(undone.document, 4)?.x, 8);
  assert.equal(undone.viewerModelRevision, second.viewerModelRevision + 1);
  assert.equal(undone.viewerModelText, serializeNativeIfcDocument(undone.document));
  assert.equal(undone.pendingViewerChanges.length, 0);
});

test("no-op transactions do not dirty documents or create history entries", () => {
  const initial = createWorkspaceDocumentSession(createNativeSampleDocument());
  assert.equal(commitDocumentTransaction(initial, createDocumentTransaction(initial.document, initial.document, "Nothing")), initial);
});

test("concurrent disjoint edits rebase while conflicting edits leave the session intact", () => {
  const initial = createWorkspaceDocumentSession(sharedPlacement());
  const base = initial.document;
  const first = commitDocumentTransaction(initial, createDocumentTransaction(base, updateNativeEntity(base, 4, { name: "First" }), "First"));
  const second = commitDocumentTransaction(first, createDocumentTransaction(base, updateNativeEntity(base, 5, { name: "Second" }), "Second"));
  assert.equal(second.document.entityById.get(4)?.name, "First");
  assert.equal(second.document.entityById.get(5)?.name, "Second");
  assert.equal(restoreDocumentTransaction(second, "undo").document.entityById.get(4)?.name, "First");
  assert.throws(() => commitDocumentTransaction(first, createDocumentTransaction(base, updateNativeEntity(base, 4, { name: "Conflict" }), "Conflict")), /inzwischen/);
  assert.equal(first.document.entityById.get(4)?.name, "First");
});

test("save acknowledgement only clears the exact captured revision, including after undo", () => {
  const initial = createWorkspaceDocumentSession(sharedPlacement());
  const edited = commitDocumentTransaction(initial, createDocumentTransaction(initial.document, updateNativeEntity(initial.document, 4, { name: "Saved" }), "Rename"));
  const snapshot = captureDocumentSave(edited);
  const concurrent = commitDocumentTransaction(edited, createDocumentTransaction(edited.document, updateNativeEntity(edited.document, 5, { name: "Unsaved" }), "Later edit"));
  assert.equal(acknowledgeDocumentSave(concurrent, snapshot), concurrent);
  assert.equal(acknowledgeDocumentSave(restoreDocumentTransaction(concurrent, "undo"), snapshot).hasUnexportedChanges, true);
  const saved = acknowledgeDocumentSave(edited, snapshot);
  assert.equal(saved.hasUnexportedChanges, false);
  assert.equal(saved.documentTextDirty, false);
  assert.equal(saved.documentText, serializeNativeIfcDocument(saved.document));
  const other = createWorkspaceDocumentSession(edited.document);
  assert.equal(acknowledgeDocumentSave(other, snapshot), other);
});

test("property additions keep their GlobalIds through transaction undo/redo", () => {
  const initial = createWorkspaceDocumentSession(sharedPlacement());
  const next = addNativePropertySet(initial.document, 4, "Pset_Test", "Value", "x");
  const edited = commitDocumentTransaction(initial, createDocumentTransaction(initial.document, next, "Add properties"));
  assert.equal(edited.undoStack[0].affectsGeometry, false);
  const redone = restoreDocumentTransaction(restoreDocumentTransaction(edited, "undo"), "redo");
  assert.equal(serializeNativeIfcDocument(redone.document), serializeNativeIfcDocument(next));
});

test("file save waits for close, reports cancellation and aborts failed writes", async () => {
  const globals = globalThis as typeof globalThis & { showSaveFilePicker?: unknown };
  const original = globals.showSaveFilePicker;
  const events: string[] = [];
  try {
    globals.showSaveFilePicker = async () => ({ createWritable: async () => ({
      write: async (blob: Blob) => { events.push(await blob.text()); },
      close: async () => { await Promise.resolve(); events.push("closed"); },
      abort: async () => { events.push("aborted"); },
    }) });
    assert.deepEqual(await saveIfcFile("test.ifc", "contents"), { status: "saved" });
    assert.deepEqual(events, ["contents", "closed"]);
    globals.showSaveFilePicker = async () => { throw new DOMException("cancelled", "AbortError"); };
    assert.deepEqual(await saveIfcFile("test.ifc", "contents"), { status: "cancelled" });
    globals.showSaveFilePicker = async () => ({ createWritable: async () => ({
      write: async () => {}, close: async () => { throw new Error("disk full"); },
      abort: async () => { events.push("aborted"); },
    }) });
    await assert.rejects(saveIfcFile("test.ifc", "contents"), /disk full/);
    assert.equal(events.at(-1), "aborted");
  } finally {
    if (original === undefined) delete globals.showSaveFilePicker;
    else globals.showSaveFilePicker = original;
  }
});

test("bulk property merge preserves existing values, deduplicates names and keeps indexes coherent", () => {
  const base = addNativePropertySet(sharedPlacement(), 4, "Pset_Test", "Keep", "original");
  const snapshot = serializeNativeIfcDocument(base);
  const properties = Array.from({ length: 1000 }, (_, index) => ({ name: `Field${index}`, value: String(index), valueType: "IFCINTEGER" }));
  const next = mergeNativePropertySetValues(base, 4, " pset_test ", [
    { name: "KEEP", value: "do not overwrite" }, { name: " ", value: "blank" },
    ...properties, { name: " field1 ", value: "duplicate" },
  ]);
  const set = next.propertySetsByEntity.get(4)![0];
  assert.equal(next.propertySetsByEntity.get(4)!.length, 1);
  assert.equal(set.values.length, 1001);
  assert.equal(next.entityById.get(set.values[0].id)?.args[2], "IFCLABEL('original')");
  assert.equal(serializeNativeIfcDocument(base), snapshot);
  assert.equal(mergeNativePropertySetValues(next, 4, "Pset_Test", properties), next);
  assertIndexes(next);
  const roundTrip = parseNativeIfcText(serializeNativeIfcDocument(next), "bulk.ifc");
  assert.deepEqual(next.propertySetsByEntity, roundTrip.propertySetsByEntity);
  assert.deepEqual(next.relationshipsByEntity, roundTrip.relationshipsByEntity);
});

test("property creation distinguishes empty input from an intentionally empty set", () => {
  const base = sharedPlacement();
  assert.equal(addNativePropertySetValues(base, 4, "Pset_Empty", []), base);
  assert.equal(mergeNativePropertySetValues(base, 4, "Pset_Empty", [{ name: " ", value: "x" }]), base);
  const empty = addNativeEmptyPropertySet(base, 4, "Pset_Empty");
  assert.deepEqual(empty.propertySetsByEntity.get(4)![0].values, []);
  const merged = mergeNativePropertySetValues(base, 4, "Pset_New", [{ name: "One", value: "a" }, { name: "one", value: "b" }]);
  assert.equal(merged.propertySetsByEntity.get(4)![0].values.length, 1);
  assertIndexes(empty);
  assertIndexes(merged);
});

test("bulk quantity merge shares construction without changing quantity types or base indexes", () => {
  const base = addNativeQuantitySet(sharedPlacement(), 4, "Qto_Test", "Length", "2");
  const next = mergeNativePropertySetValues(base, 4, "Qto_Test", [
    { name: "Area", value: "12.5", valueType: "IFCQUANTITYAREA" },
    { name: "Volume", value: "30", valueType: "IFCQUANTITYVOLUME" },
  ]);
  const set = next.propertySetsByEntity.get(4)![0];
  assert.equal(set.values.length, 3);
  assert.deepEqual(set.values.map((value) => next.entityById.get(value.id)!.type), ["IFCQUANTITYLENGTH", "IFCQUANTITYAREA", "IFCQUANTITYVOLUME"]);
  assert.equal(base.propertySetsByEntity.get(4)![0].values.length, 1);
  assertIndexes(base);
  assertIndexes(next);
  assert.deepEqual(next.propertySetsByEntity, parseNativeIfcText(serializeNativeIfcDocument(next), "quantity.ifc").propertySetsByEntity);
});

test("entity diff shares import lexical rules and preserves significant string whitespace", () => {
  const before = ifc("#1=IFCMATERIAL('Two spaces','description','Metal'); #2=IFCPROPERTYSINGLEVALUE('literal #99',$,IFCLABEL('O''Brien'),$);");
  const formatted = ifc("/* #700=IFCMATERIAL('ignored'); */\n#1 = IFCMATERIAL(\n 'Two spaces',\n 'description', 'Metal'\n) ;\n#2 = IFCPROPERTYSINGLEVALUE( 'literal #99', $, IFCLABEL('O''Brien'), $ ) ;");
  const summary = summarizeEntityAwareDiff(before, formatted);
  assert.equal(summary.changedEntities, 0);
  assert.equal(summary.addedEntities, 0);
  assert.equal(summary.removedEntities, 0);
  assert.deepEqual(previewEntityAwareDiffLines(before, formatted), [{ kind: "context", text: "No textual IFC changes detected." }]);
  const changed = formatted.replace("Two spaces", "Two  spaces");
  assert.equal(summarizeEntityAwareDiff(before, changed).changedEntities, 1);
  assert.ok(previewEntityAwareDiffLines(before, changed).some((line) => line.text.includes("IFCMATERIAL 'Two  spaces' changed")));
});

test("placement diff follows actual references and ignores IDs embedded in strings", () => {
  const before = ifc("#1=IFCCARTESIANPOINT((0.,0.,0.)); #2=IFCAXIS2PLACEMENT3D(#1,$,$); #3=IFCLOCALPLACEMENT($,#2); #4=IFCWALL('g',$,'Moved',$,$,#3,$,$,.NOTDEFINED.); #5=IFCWALL('h',$,'Text #3',$,$,'#3',$,$,.NOTDEFINED.);");
  const diff = summarizeEntityAwareDiff(before, before.replace("(0.,0.,0.)", "(2.,0.,0.)"));
  assert.equal(diff.placementChanges.length, 1);
  assert.deepEqual(diff.placementChanges[0].affectedProducts.map((entity) => entity.id), [4]);
  assert.deepEqual(diff.placementChanges[0].delta, [2, 0, 0]);
});

test("viewer refresh and saving use the same revision without acknowledging unsaved changes", () => {
  const initial = createWorkspaceDocumentSession(sharedPlacement());
  const next = updateNativePlacement(initial.document, 4, { x: 7 });
  const edited = commitDocumentTransaction(initial, createDocumentTransaction(initial.document, next, "Move"));
  const text = readDocumentText(edited);
  assert.equal(edited.documentTextDirty, true);
  assert.equal(edited.hasUnexportedChanges, true);
  const refreshed = refreshDocumentViewer(edited);
  assert.equal(refreshed.documentText, text);
  assert.equal(refreshed.viewerModelText, text);
  assert.equal(captureDocumentSave(refreshed).text, text);
  assert.equal(refreshed.documentTextDirty, false);
  assert.equal(refreshed.hasUnexportedChanges, true);
  assert.equal(refreshed.documentRevision, edited.documentRevision);
  assert.equal(refreshed.viewerModelRevision, edited.viewerModelRevision + 1);
  assert.equal(refreshed.pendingViewerChanges.length, 0);
  const movedAgain = commitDocumentTransaction(refreshed, createDocumentTransaction(next, updateNativePlacement(next, 4, { x: 9 }), "Move again"));
  assert.notEqual(readDocumentText(movedAgain), text);
  assert.equal(readDocumentText(refreshed), text);
});

test("splitting refreshes the committed viewer snapshot including earlier edits and preserves undo", () => {
  const base = createNativeSampleDocument();
  const id = base.entities.find((entity) => entity.type === "IFCBUILTELEMENT")!.id;
  const initial = createWorkspaceDocumentSession(base);
  const moved = updateNativePlacement(base, id, { x: 100, y: 200, z: 30 });
  const edited = commitDocumentTransaction(initial, createDocumentTransaction(base, moved, "Move"));
  const split = splitNativeBodyByPlane(moved, id, {
    point: { x: 100, y: 200, z: 30 }, normal: { x: 1, y: 0, z: 0 },
  });
  assert.ok(split);
  const committed = commitDocumentTransaction(edited, createDocumentTransaction(moved, split.document, "Split"), {
    selectedId: split.partIds[0], refreshViewer: true,
  });
  assert.equal(committed.viewerModelText, captureDocumentSave(committed).text);
  assert.equal(committed.viewerModelRevision, edited.viewerModelRevision + 1);
  assert.equal(committed.viewerModelBytes, null);
  assert.equal(committed.viewerModelFile, null);
  assert.deepEqual(committed.pendingViewerChanges, []);
  assert.equal(committed.hasUnexportedChanges, true);
  const shown = parseNativeIfcText(committed.viewerModelText!, "viewer.ifc");
  assert.equal(shown.entityById.has(id), false);
  for (const partId of split.partIds) {
    assert.deepEqual(getNativePlacementWorldFrame(shown, partId), getNativePlacementWorldFrame(moved, id));
  }
  const undone = restoreDocumentTransaction(committed, "undo");
  assert.equal(serializeNativeIfcDocument(undone.document), serializeNativeIfcDocument(moved));
  assert.equal(undone.viewerModelText, captureDocumentSave(undone).text);
  const redone = restoreDocumentTransaction(undone, "redo");
  assert.equal(redone.viewerModelText, committed.viewerModelText);
});

test("viewer loading retains original file sources until geometry actually requires refresh", () => {
  const text = serializeNativeIfcDocument(sharedPlacement()) + "\n/* original formatting */";
  const bytes = new TextEncoder().encode(text).buffer;
  const file = new File([bytes], "original.ifc");
  const initial = createWorkspaceDocumentSession(sharedPlacement(), { bytes, file, viewerModelLoadRequested: false });
  assert.equal(readDocumentText(initial), text);
  const edited = commitDocumentTransaction(initial, createDocumentTransaction(initial.document, updateNativeEntity(initial.document, 4, { name: "Renamed" }), "Rename"));
  const requested = requestDocumentViewerLoad(edited);
  assert.equal(requested.viewerModelBytes, bytes);
  assert.equal(requested.viewerModelFile, file);
  assert.equal(requested.viewerModelLoadRequested, true);
  assert.equal(requested.documentTextDirty, true);
  const stale = requestDocumentViewerLoad({ ...edited, viewerModelTextStale: true });
  assert.equal(stale.viewerModelBytes, null);
  assert.equal(stale.viewerModelFile, null);
  assert.equal(stale.viewerModelText, readDocumentText(edited));
  assert.equal(stale.hasUnexportedChanges, true);
});

test("shared byte conversion respects source precedence and transfers only the requested view", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  assert.equal(toExactArrayBuffer(bytes), bytes.buffer);
  assert.deepEqual([...new Uint8Array(toExactArrayBuffer(bytes.subarray(1, 3)))], [2, 3]);
  assert.deepEqual([...new Uint8Array(toExactArrayBuffer(bytes.subarray(0, 0)))], []);
  assert.deepEqual([...await readIfcBytes({ bytes: bytes.buffer, text: "ignored" })], [1, 2, 3, 4]);
  assert.equal(new TextDecoder().decode(await readIfcBytes({ file: new File(["file"], "source.ifc"), bytes: bytes.buffer, text: "ignored" })), "file");
  assert.equal(new TextDecoder().decode(await readIfcBytes({ text: "Größe" })), "Größe");
});

test("file selection handles multiple files, cancellation, errors and listener cleanup", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const files = [new File(["a"], "a.ifc"), new File(["b"], "b.ifc")];
  let outcome: "change" | "cancel" | "error" | "throw" = "change";
  const inputs: Array<{ onchange: (() => void) | null; oncancel: (() => void) | null; onerror: (() => void) | null; removed: boolean; accept: string; multiple: boolean }> = [];
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
      const input = { accept: "", multiple: false, files, removed: false,
        onchange: null as (() => void) | null, oncancel: null as (() => void) | null, onerror: null as (() => void) | null,
        click() { if (outcome === "throw") throw new Error("cannot open"); this[`on${outcome}`]?.(); },
        remove() { this.removed = true; },
      };
      inputs.push(input);
      return input;
    } } });
    assert.deepEqual(await pickFiles(".ifc", true), files);
    assert.equal(inputs[0].accept, ".ifc");
    assert.equal(inputs[0].multiple, true);
    outcome = "cancel";
    assert.deepEqual(await pickFiles(".ids"), []);
    outcome = "error";
    await assert.rejects(pickFiles(".xlsx"), /File picker failed/);
    outcome = "throw";
    await assert.rejects(pickFiles(".ifc"), /cannot open/);
    for (const input of inputs) {
      assert.equal(input.removed, true);
      assert.equal(input.onchange, null);
      assert.equal(input.oncancel, null);
      assert.equal(input.onerror, null);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("document loading retains file sources and Hub provenance through the common session path", async () => {
  const text = serializeNativeIfcDocument(sharedPlacement());
  const file = new File([text], "local.ifc");
  const local = await loadWorkspaceDocument({ file });
  assert.equal(local.session.sourceIfcFile, file);
  assert.equal(local.session.document.fileName, file.name);
  assert.equal(readDocumentText(local.session), text);
  const origin = { projectSlug: "p", projectName: "Project", modelSlug: "m", modelName: "Model", branch: "main", commitId: "commit" };
  const loaded = await loadWorkspaceDocuments([{ file }, { text, fileName: "hub.ifc", origin }]);
  assert.deepEqual(loaded.map(({ session }) => session.document.fileName), ["local.ifc", "hub.ifc"]);
  assert.notEqual(loaded[0].session.id, loaded[1].session.id);
  assert.equal(loaded[1].session.documentText, text);
  assert.equal(loaded[1].session.vcsOrigin, origin);
  assert.equal(loaded[1].session.hasUnexportedChanges, false);
  assert.deepEqual(await loadWorkspaceDocuments([]), []);
});

test("failed grouped document loading never publishes a partial result", async () => {
  const text = serializeNativeIfcDocument(sharedPlacement());
  let published = false;
  await assert.rejects(loadWorkspaceDocuments([
    { text, fileName: "valid.ifc" },
    { text: ifc("#1=IFCWALL('unfinished',"), fileName: "invalid.ifc" },
  ]).then(() => { published = true; }), /Nicht abgeschlossene/);
  assert.equal(published, false);
});
