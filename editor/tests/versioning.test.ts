import assert from "node:assert/strict";
import test from "node:test";

import { parseNativeIfcText } from "../src/ifc/nativeDocument";
import {
  buildVersionManifest,
  diffIfcText,
} from "../src/ifc/versioning/entityDiffByGuid";

// A valid IFC GlobalId is 22 chars over [0-9A-Za-z_$].
function guid(seed: string): string {
  const base = `3t2$${seed}`;
  return (base + "0".repeat(22)).slice(0, 22);
}

const W1 = guid("wallA");
const P1 = guid("psetA");
const R1 = guid("relAA");
const W2 = guid("wallB");

interface ModelOptions {
  wallName?: string;
  height?: string;
  extraWall?: boolean;
}

function model(opts: ModelOptions = {}): string {
  const wallName = opts.wallName ?? "Wall A";
  const height = opts.height ?? "3000.";
  const lines = [
    `#1= IFCWALL('${W1}',$,'${wallName}',$,$,$,$,$,$);`,
    `#2= IFCPROPERTYSINGLEVALUE('Height',$,IFCREAL(${height}),$);`,
    `#3= IFCPROPERTYSET('${P1}',$,'Pset_WallCommon',$,(#2));`,
    `#4= IFCRELDEFINESBYPROPERTIES('${R1}',$,$,$,(#1),#3);`,
  ];
  if (opts.extraWall) {
    lines.push(`#5= IFCWALL('${W2}',$,'Wall B',$,$,$,$,$,$);`);
  }
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('test.ifc','',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

/** Re-number every STEP express id (simulating a web-ifc re-export). */
function renumber(text: string, offset: number): string {
  return text.replace(/#(\d+)/g, (_match, digits: string) => {
    return `#${Number(digits) + offset}`;
  });
}

test("manifest only tracks entities with real IFC GlobalIds", () => {
  const manifest = buildVersionManifest(parseNativeIfcText(model()));
  // Wall, Pset, Rel are rooted; IFCPROPERTYSINGLEVALUE('Height',...) is excluded.
  assert.equal(manifest.entityCount, 3);
  assert.ok(manifest.entries.has(W1));
  assert.ok(manifest.entries.has(P1));
  assert.ok(manifest.entries.has(R1));
});

test("manifest hash is deterministic across parses", () => {
  const a = buildVersionManifest(parseNativeIfcText(model()));
  const b = buildVersionManifest(parseNativeIfcText(model()));
  assert.equal(a.manifestHash, b.manifestHash);
});

test("re-numbered (re-exported) file produces an empty semantic diff", () => {
  const before = model();
  const after = renumber(before, 5000);
  const diff = diffIfcText(before, after);
  assert.equal(diff.identical, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.modified.length, 0);
  assert.equal(diff.unchanged, 3);
});

test("changing a property value modifies exactly the owning property set", () => {
  const diff = diffIfcText(model(), model({ height: "3200." }));
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.modified.length, 1);
  assert.equal(diff.modified[0].globalId, P1);
  assert.equal(diff.modified[0].type, "IFCPROPERTYSET");
  assert.equal(diff.identical, false);
});

test("renaming a wall modifies exactly that wall", () => {
  const diff = diffIfcText(model(), model({ wallName: "Wall Renamed" }));
  assert.equal(diff.modified.length, 1);
  assert.equal(diff.modified[0].globalId, W1);
  assert.equal(diff.modified[0].type, "IFCWALL");
});

test("adding an element shows up as a single addition", () => {
  const diff = diffIfcText(model(), model({ extraWall: true }));
  assert.equal(diff.modified.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].globalId, W2);
});

test("removing an element shows up as a single removal", () => {
  const diff = diffIfcText(model({ extraWall: true }), model());
  assert.equal(diff.modified.length, 0);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].globalId, W2);
});
