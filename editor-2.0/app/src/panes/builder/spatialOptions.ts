/**
 * Auswahlliste der räumlichen Elternknoten (Geschosse, Räume, Gebäude …)
 * aus dem Strukturbaum der Sitzung. Geschosse stehen an erster Stelle,
 * weil Bauteile in aller Regel dorthin gehören.
 */
import type { ModelSession } from "../../core/session";
import type { SpatialTreeNode } from "../../core/model/spatial";

export interface SpatialOption {
  expressId: number;
  label: string;
  /** Einrückungstiefe im Baum */
  depth: number;
  isStorey: boolean;
}

function walk(
  node: SpatialTreeNode,
  depth: number,
  out: SpatialOption[],
): void {
  const isStorey = node.type.toUpperCase() === "IFCBUILDINGSTOREY";
  out.push({
    expressId: node.expressId,
    label: `${" ".repeat(depth * 2)}${node.name || node.type} · #${node.expressId}`,
    depth,
    isStorey,
  });
  for (const child of node.children) walk(child, depth + 1, out);
}

export function spatialOptions(session: ModelSession): SpatialOption[] {
  const root = session.spatialTree();
  if (!root) return [];
  const out: SpatialOption[] = [];
  walk(root, 0, out);
  return out;
}

/** Voreinstellung: erstes Geschoss, sonst der erste räumliche Knoten. */
export function defaultParent(options: SpatialOption[]): number | null {
  return (
    options.find((option) => option.isStorey)?.expressId ??
    options[0]?.expressId ??
    null
  );
}
