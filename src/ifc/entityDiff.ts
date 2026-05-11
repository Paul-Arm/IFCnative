export type IfcDiffLineKind = 'context' | 'add' | 'remove';

export interface IfcDiffLine {
  kind: IfcDiffLineKind;
  text: string;
}

export interface IfcEntityAwareDiffSummary {
  changedEntities: number;
  addedEntities: number;
  removedEntities: number;
  relationshipChanges: IfcRelationshipDiffSummary[];
  placementChanges: IfcPlacementDiffSummary[];
}

export interface IfcRelationshipDiffSummary {
  action: 'added' | 'removed' | 'changed';
  id: number;
  type: string;
  before?: string;
  after?: string;
}

export interface IfcPlacementDiffSummary {
  pointId: number;
  before: [number, number, number];
  after: [number, number, number];
  delta: [number, number, number];
  affectedProducts: IfcPlacementProductSummary[];
}

export interface IfcPlacementProductSummary {
  id: number;
  type: string;
  name?: string;
  placementId: number;
}

interface StepEntityLine {
  id: number;
  type: string;
  text: string;
  args: string[];
  name?: string;
}

interface ParsedStepText {
  entities: Map<number, StepEntityLine>;
  order: number[];
  nonEntityLines: string[];
}

const MAX_ENTITY_DIFF_LINES = 800;

export function summarizeEntityAwareDiff(beforeText: string, afterText: string): IfcEntityAwareDiffSummary {
  const before = parseStepText(beforeText);
  const after = parseStepText(afterText);
  const ids = uniqueNumbers([...before.order, ...after.order]);
  const relationshipChanges: IfcRelationshipDiffSummary[] = [];
  const placementChanges: IfcPlacementDiffSummary[] = [];
  let changedEntities = 0;
  let addedEntities = 0;
  let removedEntities = 0;

  for (const id of ids) {
    const beforeEntity = before.entities.get(id);
    const afterEntity = after.entities.get(id);
    if (!beforeEntity && afterEntity) {
      addedEntities += 1;
      if (isRelationshipEntity(afterEntity)) {
        relationshipChanges.push({
          action: 'added',
          after: describeRelationship(afterEntity),
          id,
          type: afterEntity.type,
        });
      }
      continue;
    }
    if (beforeEntity && !afterEntity) {
      removedEntities += 1;
      if (isRelationshipEntity(beforeEntity)) {
        relationshipChanges.push({
          action: 'removed',
          before: describeRelationship(beforeEntity),
          id,
          type: beforeEntity.type,
        });
      }
      continue;
    }
    if (!beforeEntity || !afterEntity || normalizeStepLine(beforeEntity.text) === normalizeStepLine(afterEntity.text)) {
      continue;
    }

    changedEntities += 1;
    if (isRelationshipEntity(beforeEntity) || isRelationshipEntity(afterEntity)) {
      relationshipChanges.push({
        action: 'changed',
        after: describeRelationship(afterEntity),
        before: describeRelationship(beforeEntity),
        id,
        type: afterEntity.type,
      });
    }

    if (beforeEntity.type === 'IFCCARTESIANPOINT' && afterEntity.type === 'IFCCARTESIANPOINT') {
      const beforePoint = readCartesianPoint(beforeEntity);
      const afterPoint = readCartesianPoint(afterEntity);
      if (beforePoint && afterPoint && !samePoint(beforePoint, afterPoint)) {
        placementChanges.push({
          affectedProducts: traceProductsForPlacementPoint(after, id),
          after: afterPoint,
          before: beforePoint,
          delta: [
            roundDiff(afterPoint[0] - beforePoint[0]),
            roundDiff(afterPoint[1] - beforePoint[1]),
            roundDiff(afterPoint[2] - beforePoint[2]),
          ],
          pointId: id,
        });
      }
    }
  }

  return {
    addedEntities,
    changedEntities,
    placementChanges,
    relationshipChanges,
    removedEntities,
  };
}

export function previewEntityAwareDiffLines(beforeText: string, afterText: string, limit = MAX_ENTITY_DIFF_LINES): IfcDiffLine[] {
  const before = parseStepText(beforeText);
  const after = parseStepText(afterText);
  const result: IfcDiffLine[] = [];

  addFileFrameDiff(result, before.nonEntityLines, after.nonEntityLines);

  const ids = uniqueNumbers([...before.order, ...after.order]);
  const added: StepEntityLine[] = [];
  const removed: StepEntityLine[] = [];
  const changed: Array<{ before: StepEntityLine; after: StepEntityLine }> = [];

  for (const id of ids) {
    const beforeEntity = before.entities.get(id);
    const afterEntity = after.entities.get(id);
    if (!beforeEntity && afterEntity) {
      added.push(afterEntity);
    } else if (beforeEntity && !afterEntity) {
      removed.push(beforeEntity);
    } else if (beforeEntity && afterEntity && normalizeStepLine(beforeEntity.text) !== normalizeStepLine(afterEntity.text)) {
      changed.push({ before: beforeEntity, after: afterEntity });
    }
  }

  if (changed.length || added.length || removed.length) {
    result.push({
      kind: 'context',
      text: `--- Entity-aware STEP diff: ${changed.length} changed / ${added.length} added / ${removed.length} removed ---`,
    });
  }

  for (const pair of changed) {
    result.push({ kind: 'context', text: entityHeading(pair.after, 'changed') });
    result.push({ kind: 'remove', text: pair.before.text });
    result.push({ kind: 'add', text: pair.after.text });
    if (result.length >= limit) {
      return truncateDiff(result, limit);
    }
  }

  for (const entity of added) {
    result.push({ kind: 'context', text: entityHeading(entity, 'added') });
    result.push({ kind: 'add', text: entity.text });
    if (result.length >= limit) {
      return truncateDiff(result, limit);
    }
  }

  for (const entity of removed) {
    result.push({ kind: 'context', text: entityHeading(entity, 'removed') });
    result.push({ kind: 'remove', text: entity.text });
    if (result.length >= limit) {
      return truncateDiff(result, limit);
    }
  }

  return result.length ? result.slice(0, limit) : [{ kind: 'context', text: 'No textual IFC changes detected.' }];
}

function parseStepText(text: string): ParsedStepText {
  const entities = new Map<number, StepEntityLine>();
  const order: number[] = [];
  const nonEntityLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const match = line.match(/^#(\d+)\s*=\s*([A-Z0-9_]+)\((.*)\);\s*$/i);
    if (!match) {
      if (line.trim()) {
        nonEntityLines.push(line);
      }
      continue;
    }
    const entity = {
      args: splitTopLevelArgs(match[3]),
      id: Number(match[1]),
      name: readEntityName(match[3]),
      text: line,
      type: match[2].toUpperCase(),
    };
    entities.set(entity.id, entity);
    order.push(entity.id);
  }

  return { entities, nonEntityLines, order };
}

function addFileFrameDiff(result: IfcDiffLine[], before: string[], after: string[]) {
  if (before.join('\n') === after.join('\n')) {
    return;
  }
  result.push({ kind: 'context', text: '--- STEP header/frame changed ---' });
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const line of before) {
    if (!afterSet.has(line)) {
      result.push({ kind: 'remove', text: line });
    }
  }
  for (const line of after) {
    if (!beforeSet.has(line)) {
      result.push({ kind: 'add', text: line });
    }
  }
}

function readEntityName(argsText: string) {
  const args = splitTopLevelArgs(argsText);
  const raw = args[2];
  const match = raw?.match(/^'([\s\S]*)'$/);
  return match?.[1]?.replace(/''/g, "'");
}

function isRelationshipEntity(entity: StepEntityLine) {
  return entity.type.startsWith('IFCREL');
}

function describeRelationship(entity: StepEntityLine) {
  const refs = entity.text.match(/#\d+/g) ?? [];
  const uniqueRefs = [...new Set(refs)].slice(0, 8).join(' → ');
  const suffix = refs.length > 8 ? ' …' : '';
  return uniqueRefs ? `${entity.type} ${uniqueRefs}${suffix}` : entity.type;
}

function traceProductsForPlacementPoint(step: ParsedStepText, pointId: number): IfcPlacementProductSummary[] {
  const axisPlacementIds = new Set<number>();
  const localPlacementIds = new Set<number>();

  for (const entity of step.entities.values()) {
    if (entity.type === 'IFCAXIS2PLACEMENT3D' && readReferences(entity.args[0]).includes(pointId)) {
      axisPlacementIds.add(entity.id);
    }
  }

  for (const entity of step.entities.values()) {
    if (entity.type === 'IFCLOCALPLACEMENT' && readReferences(entity.args[1]).some((id) => axisPlacementIds.has(id))) {
      localPlacementIds.add(entity.id);
    }
  }

  return [...step.entities.values()]
    .filter((entity) => isPlacedProduct(entity) && readReferences(entity.args[5]).some((id) => localPlacementIds.has(id)))
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      placementId: readReferences(entity.args[5]).find((id) => localPlacementIds.has(id)) ?? 0,
      type: entity.type,
    }))
    .sort((left, right) => left.id - right.id);
}

function isPlacedProduct(entity: StepEntityLine) {
  return entity.args.length > 5 && !entity.type.startsWith('IFCREL') && readReferences(entity.args[5]).length > 0;
}

function readReferences(value = '') {
  return [...value.matchAll(/#(\d+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
}

function readCartesianPoint(entity: StepEntityLine): [number, number, number] | undefined {
  const coordinates = entity.args[0]?.match(/^\((.*)\)$/)?.[1];
  if (!coordinates) {
    return undefined;
  }
  const values = splitTopLevelArgs(coordinates).map(parseStepNumber).filter((value) => value !== undefined);
  if (values.length < 2) {
    return undefined;
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function parseStepNumber(value: string) {
  const normalized = value.trim().replace(/D/i, 'E');
  if (!normalized || normalized === '$' || normalized === '*') {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function samePoint(left: [number, number, number], right: [number, number, number]) {
  return left.every((value, index) => Math.abs(value - right[index]) < 1e-9);
}

function roundDiff(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function splitTopLevelArgs(value: string) {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (!inString) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth = Math.max(0, depth - 1);
      } else if (char === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function entityHeading(entity: StepEntityLine, action: string) {
  const label = entity.name ? ` '${entity.name}'` : '';
  return `--- #${entity.id} ${entity.type}${label} ${action} ---`;
}

function normalizeStepLine(line: string) {
  return line.replace(/\s+/g, ' ').trim();
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function truncateDiff(lines: IfcDiffLine[], limit: number) {
  return [
    ...lines.slice(0, Math.max(0, limit - 1)),
    { kind: 'context' as const, text: `--- Diff truncated at ${limit} lines ---` },
  ];
}
