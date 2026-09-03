import assert from "node:assert/strict";
import test from "node:test";

import { diffOverview, diffPage } from "../src/domain/diffView";
import type { GuidDiffEntry, GuidDiffSummary } from "../src/ifc";

function entry(
  status: GuidDiffEntry["status"],
  type: string,
  name: string,
  index: number,
): GuidDiffEntry {
  return {
    globalId: `${type.slice(3, 6)}${String(index).padStart(19, "0")}`,
    type,
    name,
    status,
  };
}

function bigSummary(): GuidDiffSummary {
  const added: GuidDiffEntry[] = [];
  const modified: GuidDiffEntry[] = [];
  for (let index = 0; index < 1500; index += 1) {
    added.push(entry("added", "IFCWALL", `Wand ${index % 7}`, index));
  }
  for (let index = 0; index < 300; index += 1) {
    added.push(entry("added", "IFCDOOR", `Tür ${index}`, 5000 + index));
  }
  for (let index = 0; index < 40; index += 1) {
    modified.push(entry("modified", "IFCWALL", `Wand ${index}`, 9000 + index));
  }
  return {
    added,
    modified,
    removed: [entry("removed", "IFCSLAB", "Decke", 1)],
    unchanged: 12_345,
    beforeManifestHash: "a",
    afterManifestHash: "b",
    identical: false,
  };
}

test("diffOverview: Zähler je Status und Typ, absteigend sortiert", () => {
  const overview = diffOverview(bigSummary());
  assert.equal(overview.added.count, 1800);
  assert.deepEqual(overview.added.types, [
    { type: "IFCWALL", count: 1500 },
    { type: "IFCDOOR", count: 300 },
  ]);
  assert.equal(overview.modified.count, 40);
  assert.equal(overview.removed.count, 1);
  assert.equal(overview.unchanged, 12_345);
  assert.equal(overview.identical, false);
});

test("diffPage: blättert je Status/Typ mit stabilem Offset", () => {
  const summary = bigSummary();
  const first = diffPage(summary, {
    status: "added",
    type: "IFCWALL",
    offset: 0,
    limit: 200,
  });
  assert.equal(first.total, 1500);
  assert.equal(first.entries.length, 200);
  assert.ok(first.entries.every((e) => e.type === "IFCWALL" && e.status === "added"));

  const last = diffPage(summary, {
    status: "added",
    type: "IFCWALL",
    offset: 1400,
    limit: 200,
  });
  assert.equal(last.entries.length, 100);
  assert.equal(last.entries[0]!.globalId, first.entries[0]!.globalId.replace(/\d+$/, (d) => String(1400).padStart(d.length, "0")));

  // Limit wird nach oben begrenzt, Offset nie negativ.
  const capped = diffPage(summary, { status: "added", offset: -5, limit: 99_999 });
  assert.equal(capped.offset, 0);
  assert.equal(capped.limit, 1000);
  assert.equal(capped.entries.length, 1000);
});

test("diffPage: Volltext über alle Status, Treffer tragen ihren Status", () => {
  const summary = bigSummary();
  const hits = diffPage(summary, { q: "wand 3", offset: 0, limit: 50 });
  // added: "Wand 3" bei index % 7 === 3 -> 1500/7 aufgerundet; modified: "Wand 3", "Wand 30".."Wand 39"
  const expectedAdded = summary.added.filter((e) => e.name.toLowerCase().includes("wand 3")).length;
  const expectedModified = summary.modified.filter((e) => e.name.toLowerCase().includes("wand 3")).length;
  assert.equal(hits.total, expectedAdded + expectedModified);
  assert.equal(hits.entries.length, 50);
  assert.ok(hits.entries.every((e) => e.name.toLowerCase().includes("wand 3")));

  const byGuid = diffPage(summary, { q: summary.removed[0]!.globalId, offset: 0, limit: 10 });
  assert.equal(byGuid.total, 1);
  assert.equal(byGuid.entries[0]!.status, "removed");
});
