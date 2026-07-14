import type { NativeIfcDocument } from "@/ifc";
import {
  buildNativeGraphNeighborhood,
  type NativeGraphEdge,
  type NativeGraphPreset,
} from "@/ifc/nativeGraph";
import type { RelationshipFlowLayoutMode } from "@/components/relationship-flow.types";
import type { Point } from "@/components/ifc-workspace/types";

interface GraphLayoutNode extends Point {
  id: number;
}

interface GraphLayoutCandidate {
  desiredY: number;
  fixed: boolean;
  id: number;
}

interface GraphLayoutColumnCandidate {
  desiredX: number;
  fixed: boolean;
  id: number;
}

const GRAPH_AGGREGATE_RELATIONSHIP_TYPE = "IFCRELAGGREGATES";
const GRAPH_ORIGIN_X = 44;
const GRAPH_ORIGIN_Y = 46;
const GRAPH_COLUMN_GAP = 340;
const GRAPH_ROW_GAP = 118;
const GRAPH_MIN_ROW_GAP = 104;
const GRAPH_TREE_COLUMN_GAP = 310;
const GRAPH_TREE_LEVEL_GAP = 172;
const GRAPH_TREE_MIN_COLUMN_GAP = 286;
const GRAPH_SIDE_BRANCH_GAP = 340;
const GRAPH_SIDE_BRANCH_ROW_GAP = 112;
const GRAPH_TENSION_ITERATIONS = 72;

export function buildGraph(
  document: NativeIfcDocument,
  selectedId: number,
  pinned: Set<number>,
  expanded: Set<number>,
  collapsed: Set<number>,
  depth: number,
  preset: NativeGraphPreset,
  relationshipTypes: Set<string>,
) {
  return buildNativeGraphNeighborhood(document, {
    collapsed,
    depth,
    expanded,
    pinned,
    preset,
    relationshipTypes,
    selectedId,
  });
}

export function layoutGraph(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
  pinned: Set<number>,
  mode: RelationshipFlowLayoutMode,
): GraphLayoutNode[] {
  const aggregateTree = hasAggregateGraphEdges(edges);
  const layoutLevels = aggregateTree
    ? buildAggregateTreeLevels(nodeIds, edges, levels)
    : levels;
  const initial = aggregateTree
    ? layoutAggregateTreeGraph(nodeIds, layoutLevels, edges, manual)
    : layoutGraphColumns(nodeIds, layoutLevels, edges, manual);
  const positions =
    mode === "tension"
      ? applyTensionLayout(
          initial,
          nodeIds,
          layoutLevels,
          edges,
          manual,
          pinned,
          aggregateTree,
        )
      : initial;
  return nodeIds.flatMap((id) => {
    const point = positions.get(id);
    return point ? [{ id, x: point.x, y: point.y }] : [];
  });
}

function layoutAggregateTreeGraph(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
) {
  const nodeSet = new Set(nodeIds);
  const aggregateParticipants = buildAggregateParticipantSet(edges, nodeSet);
  const sideAttachments = buildSideAttachmentLookup(
    edges,
    nodeSet,
    aggregateParticipants,
  );
  const treeNodeIds = nodeIds.filter((id) => !sideAttachments.targets.has(id));
  const grouped = orderGraphLevels(
    treeNodeIds.length ? treeNodeIds : nodeIds,
    levels,
    edges,
  );
  const parentLookup = buildAggregateParentLookup(edges, nodeSet);
  const positions = new Map<number, Point>();
  for (const [level, ids] of sortedLevelEntries(grouped)) {
    const siblingLookup = buildSiblingLookup(ids, parentLookup, level);
    const candidates = ids.map((id, index) => {
      const existing = manual.get(id);
      const parentIds = parentLookup.get(id) ?? [];
      const parentX = averageDefined(
        parentIds.map(
          (parentId) => positions.get(parentId)?.x ?? manual.get(parentId)?.x,
        ),
      );
      const sibling = siblingLookup.get(id);
      const siblingOffset = sibling
        ? (sibling.index - (sibling.count - 1) / 2) * GRAPH_TREE_COLUMN_GAP
        : 0;
      return {
        desiredX:
          existing?.x ??
          (parentX === undefined
            ? GRAPH_ORIGIN_X + index * GRAPH_TREE_COLUMN_GAP
            : parentX + siblingOffset),
        fixed: Boolean(existing),
        id,
      } satisfies GraphLayoutColumnCandidate;
    });
    const columnPositions = spreadLevelColumns(candidates);
    for (const candidate of candidates) {
      const existing = manual.get(candidate.id);
      positions.set(candidate.id, {
        x:
          existing?.x ??
          columnPositions.get(candidate.id) ??
          candidate.desiredX,
        y: existing?.y ?? GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP,
      });
    }
  }
  placeSideBranches(
    nodeIds,
    levels,
    sideAttachments.sources,
    positions,
    manual,
  );
  for (const id of nodeIds) {
    if (positions.has(id)) {
      continue;
    }
    const existing = manual.get(id);
    const level = levels.get(id) ?? 0;
    positions.set(id, {
      x: existing?.x ?? GRAPH_ORIGIN_X + level * GRAPH_TREE_COLUMN_GAP,
      y: existing?.y ?? GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP,
    });
  }
  return positions;
}

function layoutGraphColumns(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
) {
  const grouped = orderGraphLevels(nodeIds, levels, edges);
  const nodeSet = new Set(nodeIds);
  const parentLookup = buildDirectedParentLookup(edges, nodeSet, levels);
  const positions = new Map<number, Point>();
  for (const [level, ids] of sortedLevelEntries(grouped)) {
    const siblingLookup = buildSiblingLookup(ids, parentLookup, level);
    const candidates = ids.map((id, index) => {
      const existing = manual.get(id);
      const parentIds = parentLookup.get(id) ?? [];
      const parentY = averageDefined(
        parentIds.map(
          (parentId) => positions.get(parentId)?.y ?? manual.get(parentId)?.y,
        ),
      );
      const sibling = siblingLookup.get(id);
      const siblingOffset = sibling
        ? (sibling.index - (sibling.count - 1) / 2) * GRAPH_ROW_GAP
        : 0;
      return {
        desiredY:
          existing?.y ??
          (parentY === undefined
            ? GRAPH_ORIGIN_Y + index * GRAPH_ROW_GAP
            : parentY + siblingOffset),
        fixed: Boolean(existing),
        id,
      } satisfies GraphLayoutCandidate;
    });
    const rowPositions = spreadLevelRows(candidates);
    for (const candidate of candidates) {
      const existing = manual.get(candidate.id);
      const levelValue = levels.get(candidate.id) ?? level;
      positions.set(candidate.id, {
        x: existing?.x ?? GRAPH_ORIGIN_X + levelValue * GRAPH_COLUMN_GAP,
        y: existing?.y ?? rowPositions.get(candidate.id) ?? candidate.desiredY,
      });
    }
  }
  return positions;
}

function applyTensionLayout(
  initial: Map<number, Point>,
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
  pinned: Set<number>,
  aggregateTree: boolean,
) {
  const nodeSet = new Set(nodeIds);
  const fixed = new Set<number>();
  for (const id of manual.keys()) {
    if (nodeSet.has(id)) {
      fixed.add(id);
    }
  }
  for (const id of pinned) {
    if (nodeSet.has(id)) {
      fixed.add(id);
    }
  }
  const grouped = groupNodeIdsByLevel(nodeIds, levels);
  const neighborLookup = buildUndirectedNeighborLookup(edges, nodeSet);
  let positions = new Map(initial);
  for (
    let iteration = 0;
    iteration < GRAPH_TENSION_ITERATIONS;
    iteration += 1
  ) {
    const nextPositions = new Map(positions);
    for (const id of nodeIds) {
      if (fixed.has(id)) {
        continue;
      }
      const position = positions.get(id);
      if (!position) {
        continue;
      }
      const level = levels.get(id) ?? 0;
      let forceX = aggregateTree
        ? 0
        : (GRAPH_ORIGIN_X + level * GRAPH_COLUMN_GAP - position.x) * 0.12;
      let forceY = aggregateTree
        ? (GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP - position.y) * 0.12
        : 0;
      for (const neighborId of neighborLookup.get(id) ?? []) {
        const neighborPosition = positions.get(neighborId);
        if (!neighborPosition) {
          continue;
        }
        const neighborLevel = levels.get(neighborId) ?? level;
        if (aggregateTree) {
          const targetY =
            neighborPosition.y + (level - neighborLevel) * GRAPH_TREE_LEVEL_GAP;
          forceX += (neighborPosition.x - position.x) * 0.045;
          forceY += (targetY - position.y) * 0.018;
        } else {
          const targetX =
            neighborPosition.x + (level - neighborLevel) * GRAPH_COLUMN_GAP;
          forceX += (targetX - position.x) * 0.018;
          forceY += (neighborPosition.y - position.y) * 0.045;
        }
      }
      for (const peerId of grouped.get(level) ?? []) {
        if (peerId === id) {
          continue;
        }
        const peerPosition = positions.get(peerId);
        if (!peerPosition) {
          continue;
        }
        const distance = aggregateTree
          ? position.x - peerPosition.x
          : position.y - peerPosition.y;
        const absoluteDistance = Math.abs(distance);
        const minimumGap = aggregateTree
          ? GRAPH_TREE_MIN_COLUMN_GAP
          : GRAPH_MIN_ROW_GAP;
        if (absoluteDistance < minimumGap) {
          const direction =
            distance === 0 ? (id > peerId ? 1 : -1) : Math.sign(distance);
          if (aggregateTree) {
            forceX += direction * (minimumGap - absoluteDistance) * 0.09;
          } else {
            forceY += direction * (minimumGap - absoluteDistance) * 0.09;
          }
        }
      }
      nextPositions.set(id, {
        x: position.x + clampValue(forceX, -34, 34),
        y: position.y + clampValue(forceY, -34, 34),
      });
    }
    positions = aggregateTree
      ? spreadFlexibleColumns(nextPositions, grouped, fixed)
      : spreadFlexibleRows(nextPositions, grouped, fixed);
  }
  if (aggregateTree) {
    const aggregateParticipants = buildAggregateParticipantSet(edges, nodeSet);
    const sideAttachments = buildSideAttachmentLookup(
      edges,
      nodeSet,
      aggregateParticipants,
    );
    for (const target of sideAttachments.targets) {
      if (!manual.has(target)) {
        positions.delete(target);
      }
    }
    placeSideBranches(
      nodeIds,
      levels,
      sideAttachments.sources,
      positions,
      manual,
    );
  }
  return positions;
}

function groupNodeIdsByLevel(nodeIds: number[], levels: Map<number, number>) {
  const grouped = new Map<number, number[]>();
  for (const id of nodeIds) {
    const level = levels.get(id) ?? 0;
    const ids = grouped.get(level);
    if (ids) {
      ids.push(id);
    } else {
      grouped.set(level, [id]);
    }
  }
  return grouped;
}

/**
 * Reorders each level by the average position of its neighbors on the adjacent
 * level. Alternating top-down and bottom-up sweeps is a small, deterministic
 * Sugiyama-style crossing reduction and gives much cleaner IFC relationship
 * diagrams than sorting siblings by Express ID alone.
 */
function orderGraphLevels(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
) {
  const grouped = groupNodeIdsByLevel(nodeIds, levels);
  const nodeSet = new Set(nodeIds);
  const neighbors = buildUndirectedNeighborLookup(edges, nodeSet);
  const levelEntries = sortedLevelEntries(grouped);
  if (levelEntries.length < 2) {
    return grouped;
  }

  for (let pass = 0; pass < 4; pass += 1) {
    const topDown = pass % 2 === 0;
    const entries = topDown ? levelEntries : [...levelEntries].reverse();
    for (const [level, ids] of entries) {
      const currentOrder = new Map(ids.map((id, index) => [id, index]));
      const ranks = new Map<number, number>();
      for (const [, rankedIds] of levelEntries) {
        rankedIds.forEach((id, index) => ranks.set(id, index));
      }
      ids.sort((leftId, rightId) => {
        const leftScore = adjacentLevelBarycenter(
          leftId,
          level,
          topDown,
          neighbors,
          levels,
          ranks,
        );
        const rightScore = adjacentLevelBarycenter(
          rightId,
          level,
          topDown,
          neighbors,
          levels,
          ranks,
        );
        if (leftScore !== undefined || rightScore !== undefined) {
          if (leftScore === undefined) return 1;
          if (rightScore === undefined) return -1;
          if (leftScore !== rightScore) return leftScore - rightScore;
        }
        return (
          (currentOrder.get(leftId) ?? 0) -
            (currentOrder.get(rightId) ?? 0) ||
          leftId - rightId
        );
      });
    }
  }
  return grouped;
}

function adjacentLevelBarycenter(
  id: number,
  level: number,
  topDown: boolean,
  neighbors: Map<number, number[]>,
  levels: Map<number, number>,
  ranks: Map<number, number>,
) {
  const adjacentRanks = (neighbors.get(id) ?? []).flatMap((neighborId) => {
    const neighborLevel = levels.get(neighborId) ?? level;
    const relevant = topDown ? neighborLevel < level : neighborLevel > level;
    const rank = ranks.get(neighborId);
    return relevant && rank !== undefined ? [rank] : [];
  });
  if (!adjacentRanks.length) {
    return undefined;
  }
  return (
    adjacentRanks.reduce((total, rank) => total + rank, 0) /
    adjacentRanks.length
  );
}

function sortedLevelEntries(grouped: Map<number, number[]>) {
  return [...grouped.entries()].sort(
    ([leftLevel], [rightLevel]) => leftLevel - rightLevel,
  );
}

function buildDirectedParentLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
  levels: Map<number, number>,
) {
  const parents = new Map<number, number[]>();
  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      continue;
    }
    const sourceLevel = levels.get(edge.source) ?? 0;
    const targetLevel = levels.get(edge.target) ?? 0;
    const parentId = sourceLevel <= targetLevel ? edge.source : edge.target;
    const childId = sourceLevel <= targetLevel ? edge.target : edge.source;
    if (parentId === childId) {
      continue;
    }
    const parentIds = parents.get(childId);
    if (parentIds) {
      if (!parentIds.includes(parentId)) {
        parentIds.push(parentId);
      }
    } else {
      parents.set(childId, [parentId]);
    }
  }
  return parents;
}

function buildAggregateParentLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
) {
  const parents = new Map<number, number[]>();
  for (const edge of edges) {
    if (
      !isAggregateGraphEdge(edge) ||
      !nodeSet.has(edge.source) ||
      !nodeSet.has(edge.target) ||
      edge.source === edge.target
    ) {
      continue;
    }
    const parentIds = parents.get(edge.target);
    if (parentIds) {
      if (!parentIds.includes(edge.source)) {
        parentIds.push(edge.source);
      }
    } else {
      parents.set(edge.target, [edge.source]);
    }
  }
  return parents;
}

function buildAggregateParticipantSet(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
) {
  const participants = new Set<number>();
  for (const edge of edges) {
    if (
      isAggregateGraphEdge(edge) &&
      nodeSet.has(edge.source) &&
      nodeSet.has(edge.target)
    ) {
      participants.add(edge.source);
      participants.add(edge.target);
    }
  }
  return participants;
}

function buildSideAttachmentLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
  aggregateParticipants: Set<number>,
) {
  const targetToSource = new Map<number, number>();
  for (const edge of edges) {
    if (
      isAggregateGraphEdge(edge) ||
      !nodeSet.has(edge.source) ||
      !nodeSet.has(edge.target) ||
      aggregateParticipants.has(edge.target) ||
      edge.source === edge.target
    ) {
      continue;
    }
    const currentSource = targetToSource.get(edge.target);
    if (
      currentSource === undefined ||
      (!aggregateParticipants.has(currentSource) &&
        aggregateParticipants.has(edge.source))
    ) {
      targetToSource.set(edge.target, edge.source);
    }
  }
  const sources = new Map<number, number[]>();
  for (const [target, source] of targetToSource) {
    const targets = sources.get(source);
    if (targets) {
      targets.push(target);
    } else {
      sources.set(source, [target]);
    }
  }
  for (const targets of sources.values()) {
    targets.sort((leftId, rightId) => leftId - rightId);
  }
  return { sources, targets: new Set(targetToSource.keys()) };
}

function placeSideBranches(
  nodeIds: number[],
  levels: Map<number, number>,
  sideSources: Map<number, number[]>,
  positions: Map<number, Point>,
  manual: Map<number, Point>,
) {
  const nodeSet = new Set(nodeIds);
  for (let pass = 0; pass < nodeIds.length; pass += 1) {
    let placed = false;
    for (const [source, targets] of sideSources) {
      const sourcePosition = positions.get(source);
      if (!sourcePosition) {
        continue;
      }
      const visibleTargets = targets.filter((target) => nodeSet.has(target));
      visibleTargets.forEach((target, index) => {
        if (positions.has(target)) {
          return;
        }
        const existing = manual.get(target);
        const offset =
          (index - (visibleTargets.length - 1) / 2) * GRAPH_SIDE_BRANCH_ROW_GAP;
        positions.set(target, {
          x: existing?.x ?? sourcePosition.x + GRAPH_SIDE_BRANCH_GAP,
          y: existing?.y ?? sourcePosition.y + offset,
        });
        placed = true;
      });
    }
    if (!placed) {
      break;
    }
  }
  spreadRelativeSideBranches(positions, sideSources, manual);
  for (const target of [...sideSources.values()].flat()) {
    if (positions.has(target)) {
      continue;
    }
    const existing = manual.get(target);
    const level = levels.get(target) ?? 0;
    positions.set(target, {
      x: existing?.x ?? GRAPH_ORIGIN_X + (level + 1) * GRAPH_SIDE_BRANCH_GAP,
      y: existing?.y ?? GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP,
    });
  }
}

function spreadRelativeSideBranches(
  positions: Map<number, Point>,
  sideSources: Map<number, number[]>,
  manual: Map<number, Point>,
) {
  for (const [source, targets] of sideSources) {
    const sourcePosition = positions.get(source);
    if (!sourcePosition) {
      continue;
    }
    const placedTargets = targets
      .filter((target) => positions.has(target) && !manual.has(target))
      .sort((leftId, rightId) => leftId - rightId);
    placedTargets.forEach((target, index) => {
      const position = positions.get(target);
      if (!position) {
        return;
      }
      const offset =
        (index - (placedTargets.length - 1) / 2) * GRAPH_SIDE_BRANCH_ROW_GAP;
      positions.set(target, {
        x: position.x,
        y: sourcePosition.y + offset,
      });
    });
  }
}

function buildAggregateTreeLevels(
  nodeIds: number[],
  edges: NativeGraphEdge[],
  fallbackLevels: Map<number, number>,
) {
  const nodeSet = new Set(nodeIds);
  const aggregateParticipants = buildAggregateParticipantSet(edges, nodeSet);
  const children = new Map<number, number[]>();
  const hasParent = new Set<number>();
  for (const edge of edges) {
    if (
      !isAggregateGraphEdge(edge) ||
      !nodeSet.has(edge.source) ||
      !nodeSet.has(edge.target) ||
      edge.source === edge.target
    ) {
      continue;
    }
    const sourceChildren = children.get(edge.source);
    if (sourceChildren) {
      if (!sourceChildren.includes(edge.target)) {
        sourceChildren.push(edge.target);
      }
    } else {
      children.set(edge.source, [edge.target]);
    }
    hasParent.add(edge.target);
  }
  const levels = new Map<number, number>();
  const roots = nodeIds
    .filter((id) => !hasParent.has(id))
    .sort((leftId, rightId) =>
      compareGraphOrder(leftId, rightId, fallbackLevels),
    );
  const queue = roots.map((id) => ({ id, level: 0 }));
  for (const root of roots) {
    levels.set(root, 0);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const child of children
      .get(current.id)
      ?.sort((leftId, rightId) =>
        compareGraphOrder(leftId, rightId, fallbackLevels),
      ) ?? []) {
      const childLevel = current.level + 1;
      if ((levels.get(child) ?? -1) >= childLevel) {
        continue;
      }
      levels.set(child, childLevel);
      queue.push({ id: child, level: childLevel });
    }
  }
  let changed = true;
  for (let pass = 0; pass < nodeIds.length && changed; pass += 1) {
    changed = false;
    for (const edge of edges) {
      if (
        isAggregateGraphEdge(edge) ||
        !nodeSet.has(edge.source) ||
        !nodeSet.has(edge.target) ||
        aggregateParticipants.has(edge.target)
      ) {
        continue;
      }
      const sourceLevel = levels.get(edge.source);
      if (
        sourceLevel === undefined ||
        levels.get(edge.target) === sourceLevel
      ) {
        continue;
      }
      levels.set(edge.target, sourceLevel);
      changed = true;
    }
  }
  for (const id of nodeIds) {
    if (!levels.has(id)) {
      levels.set(id, fallbackLevels.get(id) ?? 0);
    }
  }
  return levels;
}

function compareGraphOrder(
  leftId: number,
  rightId: number,
  fallbackLevels: Map<number, number>,
) {
  return (
    (fallbackLevels.get(leftId) ?? 0) - (fallbackLevels.get(rightId) ?? 0) ||
    leftId - rightId
  );
}

function buildUndirectedNeighborLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
) {
  const neighbors = new Map<number, number[]>();
  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      continue;
    }
    pushUniqueNeighbor(neighbors, edge.source, edge.target);
    pushUniqueNeighbor(neighbors, edge.target, edge.source);
  }
  return neighbors;
}

function pushUniqueNeighbor(
  neighbors: Map<number, number[]>,
  id: number,
  neighborId: number,
) {
  const current = neighbors.get(id);
  if (current) {
    if (!current.includes(neighborId)) {
      current.push(neighborId);
    }
  } else {
    neighbors.set(id, [neighborId]);
  }
}

function buildSiblingLookup(
  ids: number[],
  parentLookup: Map<number, number[]>,
  level: number,
) {
  const groups = new Map<string, number[]>();
  for (const id of ids) {
    const parentId = parentLookup.get(id)?.[0];
    const groupKey =
      parentId === undefined ? `level-${level}` : String(parentId);
    const group = groups.get(groupKey);
    if (group) {
      group.push(id);
    } else {
      groups.set(groupKey, [id]);
    }
  }
  const siblings = new Map<number, { count: number; index: number }>();
  for (const group of groups.values()) {
    group.forEach((id, index) => {
      siblings.set(id, { count: group.length, index });
    });
  }
  return siblings;
}

function spreadFlexibleRows(
  positions: Map<number, Point>,
  grouped: Map<number, number[]>,
  fixed: Set<number>,
) {
  const next = new Map(positions);
  for (const [, ids] of sortedLevelEntries(grouped)) {
    const candidates = ids.flatMap((id) => {
      const position = positions.get(id);
      return position
        ? [
            {
              desiredY: position.y,
              fixed: fixed.has(id),
              id,
            } satisfies GraphLayoutCandidate,
          ]
        : [];
    });
    const rowPositions = spreadLevelRows(candidates);
    for (const candidate of candidates) {
      if (candidate.fixed) {
        continue;
      }
      const position = positions.get(candidate.id);
      const nextY = rowPositions.get(candidate.id);
      if (position && nextY !== undefined) {
        next.set(candidate.id, { x: position.x, y: nextY });
      }
    }
  }
  return next;
}

function spreadFlexibleColumns(
  positions: Map<number, Point>,
  grouped: Map<number, number[]>,
  fixed: Set<number>,
) {
  const next = new Map(positions);
  for (const [, ids] of sortedLevelEntries(grouped)) {
    const candidates = ids.flatMap((id) => {
      const position = positions.get(id);
      return position
        ? [
            {
              desiredX: position.x,
              fixed: fixed.has(id),
              id,
            } satisfies GraphLayoutColumnCandidate,
          ]
        : [];
    });
    const columnPositions = spreadLevelColumns(candidates);
    for (const candidate of candidates) {
      if (candidate.fixed) {
        continue;
      }
      const position = positions.get(candidate.id);
      const nextX = columnPositions.get(candidate.id);
      if (position && nextX !== undefined) {
        next.set(candidate.id, { x: nextX, y: position.y });
      }
    }
  }
  return next;
}

function spreadLevelRows(candidates: GraphLayoutCandidate[]) {
  const sorted = [...candidates].sort(
    (left, right) => left.desiredY - right.desiredY || left.id - right.id,
  );
  const rows = new Map<number, number>();
  let cursor = GRAPH_ORIGIN_Y - GRAPH_MIN_ROW_GAP;
  for (const candidate of sorted) {
    const nextY = candidate.fixed
      ? candidate.desiredY
      : Math.max(candidate.desiredY, cursor + GRAPH_MIN_ROW_GAP);
    rows.set(candidate.id, nextY);
    cursor = Math.max(cursor, nextY);
  }
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const candidate = sorted[index];
    const nextCandidate = sorted[index + 1];
    const currentY = rows.get(candidate.id);
    const nextY = rows.get(nextCandidate.id);
    if (
      currentY === undefined ||
      nextY === undefined ||
      candidate.fixed ||
      currentY <= nextY - GRAPH_MIN_ROW_GAP
    ) {
      continue;
    }
    rows.set(candidate.id, nextY - GRAPH_MIN_ROW_GAP);
  }
  return rows;
}

function spreadLevelColumns(candidates: GraphLayoutColumnCandidate[]) {
  const sorted = [...candidates].sort(
    (left, right) => left.desiredX - right.desiredX || left.id - right.id,
  );
  const columns = new Map<number, number>();
  let cursor = GRAPH_ORIGIN_X - GRAPH_TREE_MIN_COLUMN_GAP;
  for (const candidate of sorted) {
    const nextX = candidate.fixed
      ? candidate.desiredX
      : Math.max(candidate.desiredX, cursor + GRAPH_TREE_MIN_COLUMN_GAP);
    columns.set(candidate.id, nextX);
    cursor = Math.max(cursor, nextX);
  }
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const candidate = sorted[index];
    const nextCandidate = sorted[index + 1];
    const currentX = columns.get(candidate.id);
    const nextX = columns.get(nextCandidate.id);
    if (
      currentX === undefined ||
      nextX === undefined ||
      candidate.fixed ||
      currentX <= nextX - GRAPH_TREE_MIN_COLUMN_GAP
    ) {
      continue;
    }
    columns.set(candidate.id, nextX - GRAPH_TREE_MIN_COLUMN_GAP);
  }
  return columns;
}

function hasAggregateGraphEdges(edges: NativeGraphEdge[]) {
  return edges.some(isAggregateGraphEdge);
}

function isAggregateGraphEdge(edge: NativeGraphEdge) {
  return edge.type.trim().toUpperCase() === GRAPH_AGGREGATE_RELATIONSHIP_TYPE;
}

function averageDefined(values: Array<number | undefined>) {
  const defined = values.filter(
    (value): value is number => value !== undefined,
  );
  if (!defined.length) {
    return undefined;
  }
  return defined.reduce((total, value) => total + value, 0) / defined.length;
}

export function retainPinnedPositions(
  positions: Map<number, Point>,
  pinned: Set<number>,
) {
  const retained = new Map<number, Point>();
  for (const [id, point] of positions) {
    if (pinned.has(id)) {
      retained.set(id, point);
    }
  }
  return retained;
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
