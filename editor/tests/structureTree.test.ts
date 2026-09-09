import assert from "node:assert/strict";
import test from "node:test";
import { createStructureTreeIndex, getVisibleStructureIndex } from "../src/components/ifc-workspace/structureTreeIndex";

test("structure reveal follows the renderer's order for every expansion state", async () => {
  const { preloadFileTree, prepareFileTreeInput } = await import("@pierre/trees");
  const paths = [
    "Projekt/z wall", "Projekt/", "Projekt/B/", "Projekt/B/1 wall",
    "Projekt/A/", "Projekt/A/z wall", "Projekt/A/a wall",
    "Projekt/A/Inner/", "Projekt/A/Inner/child", "Projekt/.marker",
    "Freie Objekte/", "Freie Objekte/Ä wall", "Freie Objekte/2 wall",
    "Projekt/A/a wall #42", "Projekt/A/A wall",
  ];
  const tree = createStructureTreeIndex(prepareFileTreeInput(paths));
  const directories = paths.filter((path) => path.endsWith("/"));
  for (let mask = 0; mask < 2 ** directories.length; mask++) {
    const expanded = new Set(directories.filter((_, index) => mask & (1 << index)));
    const rendered = new Map<string, number>();
    const expandedRows = new Set<string>();
    preloadFileTree({
      preparedInput: tree.preparedInput,
      initialExpandedPaths: [...expanded],
      flattenEmptyDirectories: false,
      initialVisibleRowCount: paths.length,
      renderRowDecoration: ({ row }) => {
        rendered.set(row.path, row.index);
        if (row.isExpanded) expandedRows.add(row.path);
        return null;
      },
    });
    for (const path of paths) {
      assert.equal(
        getVisibleStructureIndex(tree, path, (directory) => expandedRows.has(directory)),
        rendered.get(path) ?? -1,
        `${path}, expansion mask ${mask}`,
      );
    }
  }
});

test("structure reveal skips collapsed branches without visiting their leaves", async () => {
  const { prepareFileTreeInput } = await import("@pierre/trees");
  const paths = ["Projekt/", "Projekt/Z/", "Projekt/Z/Ziel", "Projekt/A/"];
  for (let index = 99_999; index >= 0; index--) {
    paths.push(`Projekt/A/Element ${String(index).padStart(6, "0")}`);
  }
  const tree = createStructureTreeIndex(prepareFileTreeInput(paths));
  let lookups = 0;
  const resolve = (collapsed: boolean) => getVisibleStructureIndex(tree, "Projekt/Z/Ziel", (path) => {
    lookups++;
    return !collapsed || path !== "Projekt/A/";
  });
  assert.equal(resolve(false), 100_003);
  assert.equal(resolve(true), 3);
  assert.equal(lookups, 6, "only the three directory states are needed per reveal");
  assert.equal(getVisibleStructureIndex(tree, "missing", () => true), -1);
});
