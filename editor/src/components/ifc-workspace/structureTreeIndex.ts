import type { FileTreePreparedInput } from "@pierre/trees";

interface DirectoryRange {
  path: string;
  start: number;
  end: number;
}

/** All ancestors must be explicit, as in the workspace's structure model. */
export function createStructureTreeIndex(preparedInput: FileTreePreparedInput) {
  // Use the renderer's own ordering, including directories before leaves.
  // Sharing this input also avoids sorting the full tree a second time.
  const indexByPath = new Map<string, number>();
  const directories: DirectoryRange[] = [];
  const stack: DirectoryRange[] = [];
  preparedInput.paths.forEach((path, index) => {
    while (stack.length && !path.startsWith(stack.at(-1)!.path)) {
      stack.pop()!.end = index;
    }
    indexByPath.set(path, index);
    if (path.endsWith("/")) {
      const directory = { path, start: index, end: preparedInput.paths.length };
      directories.push(directory);
      stack.push(directory);
    }
  });
  return { preparedInput, indexByPath, directories };
}

/** Resolve an unmounted row without visiting the leaves of other branches. */
export function getVisibleStructureIndex(
  tree: ReturnType<typeof createStructureTreeIndex>,
  path: string,
  isExpanded: (path: string) => boolean,
) {
  const index = tree.indexByPath.get(path);
  if (index === undefined) return -1;
  let hiddenRows = 0;
  let skipUntil = -1;
  for (const directory of tree.directories) {
    if (directory.start >= index) break;
    if (directory.start < skipUntil || isExpanded(directory.path)) continue;
    if (index < directory.end) return -1;
    hiddenRows += directory.end - directory.start - 1;
    skipUntil = directory.end;
  }
  return index - hiddenRows;
}
