import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { addNativePropertyToSet, mergeNativePropertySetValues, batchNativeDocument, parseNativeIfcText, updateNativePropertyValue } from "../src/ifc/nativeDocument";
import { createRandomIfcGuid } from "../src/ifc/builder";

// Same 100,000-entity model for both paths; fixture construction is outside the timer.
const lines: string[] = [];
for (let id = 1; id <= 100_000; id += 4) {
  lines.push(
    `#${id}=IFCWALL('${createRandomIfcGuid()}',$,'Wall ${id}',$,$,$,$,$,.NOTDEFINED.);`,
    `#${id + 1}=IFCPROPERTYSINGLEVALUE('Value',$,IFCLABEL('old'),$);`,
    `#${id + 2}=IFCPROPERTYSET('${createRandomIfcGuid()}',$,'Pset_Test',$,(#${id + 1}));`,
    `#${id + 3}=IFCRELDEFINESBYPROPERTIES('${createRandomIfcGuid()}',$,$,$,(#${id}),#${id + 2});`,
  );
}
const document = parseNativeIfcText(`ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;${lines.join("\n")}ENDSEC;END-ISO-10303-21;`, "benchmark.ifc");
for (const count of process.argv.includes("--merge") ? [] : [100, 1000]) {
  const edit = (base: typeof document) => {
    let next = base;
    for (let i = 0; i < count; i++) next = updateNativePropertyValue(next, i * 4 + 2, { value: `changed ${i}` });
    return next;
  };
  const start = performance.now();
  const sequential = edit(document);
  const sequentialMs = performance.now() - start;
  const batchStart = performance.now();
  const batched = batchNativeDocument(document, edit);
  const batchMs = performance.now() - batchStart;
  assert.deepEqual(batched.entities, sequential.entities);
  assert.deepEqual(batched.propertySetsByEntity, sequential.propertySetsByEntity);
  assert.equal(document.entityById.get(2)?.args[2], "IFCLABEL('old')");
  console.log(JSON.stringify({ entities: document.entities.length, edits: count, sequentialMs: Math.round(sequentialMs), batchMs: Math.round(batchMs), speedup: Number((sequentialMs / batchMs).toFixed(1)) }));
}

if (process.argv.includes("--merge")) {
  const properties = Array.from({ length: 1000 }, (_, index) => ({ name: "Added " + index, value: String(index), valueType: "IFCINTEGER" }));
  const start = performance.now();
  let sequential = document;
  for (const property of properties) {
    sequential = addNativePropertyToSet(sequential, 3, property.name, property.value, property.valueType);
  }
  const sequentialMs = performance.now() - start;
  const bulkStart = performance.now();
  const merged = mergeNativePropertySetValues(document, 1, "Pset_Test", properties);
  const bulkMs = performance.now() - bulkStart;
  assert.deepEqual(merged.entities, sequential.entities);
  assert.deepEqual(merged.propertySetsByEntity, sequential.propertySetsByEntity);
  assert.equal(document.propertySetsByEntity.get(1)![0].values.length, 1);
  console.log(JSON.stringify({ entities: document.entities.length, addedProperties: properties.length, sequentialMs: Math.round(sequentialMs), bulkMs: Math.round(bulkMs), speedup: Number((sequentialMs / bulkMs).toFixed(1)) }));
}
