import { scanStepEntities, readStepReferences as readReferences, splitStepArguments as splitTopLevelArgs, stepStringEnd } from "./stepScanner";
import { getNativeIdentityAttributeIndexes } from "./entityIdentity";
import { unquoteStepString } from "./stepEncoding";

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
  geometryChanges: IfcGeometryDiffSummary[];
  placementChanges: IfcPlacementDiffSummary[];
}

export interface IfcRelationshipDiffSummary {
  action: 'added' | 'removed' | 'changed';
  id: number;
  type: string;
  before?: string;
  after?: string;
  beforeSources?: IfcRelationshipEndpointSummary[];
  beforeTargets?: IfcRelationshipEndpointSummary[];
  afterSources?: IfcRelationshipEndpointSummary[];
  afterTargets?: IfcRelationshipEndpointSummary[];
}

export interface IfcRelationshipEndpointSummary {
  id: number;
  type: string;
  name?: string;
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

export interface IfcGeometryDiffSummary {
  action: 'added' | 'removed' | 'changed';
  id: number;
  type: string;
  before?: string;
  after?: string;
  affectedProducts: IfcGeometryProductSummary[];
}

export interface IfcGeometryProductSummary {
  id: number;
  type: string;
  name?: string;
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
  incomingRefs: Map<number, number[]>;
}

const MAX_ENTITY_DIFF_LINES = 800;

export function summarizeEntityAwareDiff(beforeText: string, afterText: string): IfcEntityAwareDiffSummary {
  const before = parseStepText(beforeText);
  const after = parseStepText(afterText);
  const ids = uniqueNumbers([...before.order, ...after.order]);
  const relationshipChanges: IfcRelationshipDiffSummary[] = [];
  const geometryChanges: IfcGeometryDiffSummary[] = [];
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
        const afterRelationship = summarizeRelationship(afterEntity, after);
        relationshipChanges.push({
          action: 'added',
          after: afterRelationship.text,
          afterSources: afterRelationship.sources,
          afterTargets: afterRelationship.targets,
          id,
          type: afterEntity.type,
        });
      }
      if (isGeometryEntity(afterEntity)) {
        geometryChanges.push({
          action: 'added',
          after: describeGeometry(afterEntity, after),
          affectedProducts: traceProductsForGeometry(after, id),
          id,
          type: afterEntity.type,
        });
      }
      continue;
    }
    if (beforeEntity && !afterEntity) {
      removedEntities += 1;
      if (isRelationshipEntity(beforeEntity)) {
        const beforeRelationship = summarizeRelationship(beforeEntity, before);
        relationshipChanges.push({
          action: 'removed',
          before: beforeRelationship.text,
          beforeSources: beforeRelationship.sources,
          beforeTargets: beforeRelationship.targets,
          id,
          type: beforeEntity.type,
        });
      }
      if (isGeometryEntity(beforeEntity)) {
        geometryChanges.push({
          action: 'removed',
          affectedProducts: traceProductsForGeometry(before, id),
          before: describeGeometry(beforeEntity, before),
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
      const beforeRelationship = summarizeRelationship(beforeEntity, before);
      const afterRelationship = summarizeRelationship(afterEntity, after);
      relationshipChanges.push({
        action: 'changed',
        after: afterRelationship.text,
        afterSources: afterRelationship.sources,
        afterTargets: afterRelationship.targets,
        before: beforeRelationship.text,
        beforeSources: beforeRelationship.sources,
        beforeTargets: beforeRelationship.targets,
        id,
        type: afterEntity.type,
      });
    }

    if (isGeometryEntity(beforeEntity) || isGeometryEntity(afterEntity)) {
      geometryChanges.push({
        action: 'changed',
        after: describeGeometry(afterEntity, after),
        affectedProducts: traceProductsForGeometry(after, id),
        before: describeGeometry(beforeEntity, before),
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
    geometryChanges,
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

function parseStepText(input: string): ParsedStepText {
  const { text, entities: records } = scanStepEntities(input);
  const entities = new Map<number, StepEntityLine>();
  const incomingRefs = new Map<number, number[]>();
  const frame: string[] = [];
  const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "IFC4";
  let previousEnd = 0;
  for (const record of records) {
    frame.push(text.slice(previousEnd, record.start));
    previousEnd = record.end;
    const { id, type, args } = record;
    const nameIndex = getNativeIdentityAttributeIndexes(record, schema).name;
    const entity = { id, type, args, name: nameIndex == null ? undefined : unquoteStepString(args[nameIndex]), text: text.slice(record.start, record.end) };
    entities.set(id, entity);
    for (const ref of new Set(args.flatMap(readReferences))) {
      const incoming = incomingRefs.get(ref);
      if (incoming) incoming.push(id);
      else incomingRefs.set(ref, [id]);
    }
  }
  frame.push(text.slice(previousEnd));
  return { entities, incomingRefs, order: records.map((record) => record.id), nonEntityLines: frame.join("\n").split(/\r?\n/).map((line) => line.trim()).filter(Boolean) };
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



function isRelationshipEntity(entity: StepEntityLine) {
  return entity.type.startsWith('IFCREL');
}

function isGeometryEntity(entity: StepEntityLine) {
  return GEOMETRY_ENTITY_TYPES.has(entity.type);
}

const GEOMETRY_ENTITY_TYPES = new Set([
  'IFCPRODUCTDEFINITIONSHAPE',
  'IFCSHAPEREPRESENTATION',
  'IFCMAPPEDITEM',
  'IFCREPRESENTATIONMAP',
  'IFCSTYLEDITEM',
  'IFCEXTRUDEDAREASOLID',
  'IFCRECTANGLEPROFILEDEF',
  'IFCCIRCLEPROFILEDEF',
  'IFCARBITRARYCLOSEDPROFILEDEF',
  'IFCPOLYLINE',
  'IFCINDEXEDPOLYCURVE',
  'IFCPOLYGONALFACESET',
  'IFCINDEXEDPOLYGONALFACE',
  'IFCBOUNDINGBOX',
]);

function summarizeRelationship(entity: StepEntityLine, step: ParsedStepText) {
  const { sources, targets } = relationshipEndpoints(entity, step);
  if (!sources.length && !targets.length) {
    return { sources, targets, text: describeRelationshipFallback(entity) };
  }
  const sourceText = sources.length ? sources.map(formatEndpoint).join(', ') : '∅';
  const targetText = targets.length ? targets.map(formatEndpoint).join(', ') : '∅';
  return {
    sources,
    targets,
    text: `${entity.type} ${sourceText} → ${targetText}`,
  };
}

function relationshipEndpoints(entity: StepEntityLine, step: ParsedStepText) {
  const direct = (index: number) => endpointSummaries(step, readReferences(entity.args[index] ?? ''));
  switch (entity.type) {
    case 'IFCRELAGGREGATES':
    case 'IFCRELNESTS':
      return { sources: direct(4), targets: direct(5) };
    case 'IFCRELCONTAINEDINSPATIALSTRUCTURE':
    case 'IFCRELREFERENCEDINSPATIALSTRUCTURE':
      return { sources: direct(5), targets: direct(4) };
    case 'IFCRELDEFINESBYPROPERTIES':
    case 'IFCRELDEFINESBYTYPE':
      return { sources: direct(5), targets: direct(4) };
    case 'IFCRELASSIGNSTOGROUP':
    case 'IFCRELASSIGNSTOPROCESS':
    case 'IFCRELASSIGNSTOCONTROL':
    case 'IFCRELASSIGNSTOPRODUCT':
    case 'IFCRELASSOCIATESMATERIAL':
    case 'IFCRELASSOCIATESCLASSIFICATION':
    case 'IFCRELASSOCIATESDOCUMENT':
    case 'IFCRELASSOCIATESLIBRARY':
      return { sources: direct(5), targets: direct(4) };
    case 'IFCRELCONNECTSELEMENTS':
    case 'IFCRELCONNECTSPORTS':
    case 'IFCRELCONNECTSPORTTOELEMENT':
    case 'IFCRELVOIDSELEMENT':
    case 'IFCRELFILLSELEMENT':
    case 'IFCRELSEQUENCE':
      return { sources: direct(4), targets: direct(5) };
    default: {
      const refs = endpointSummaries(step, readReferences(entity.text));
      return { sources: refs.slice(0, 1), targets: refs.slice(1) };
    }
  }
}

function endpointSummaries(step: ParsedStepText, ids: number[]): IfcRelationshipEndpointSummary[] {
  return uniqueNumbers(ids)
    .map((id) => {
      const entity = step.entities.get(id);
      return {
        id,
        name: entity?.name,
        type: entity?.type ?? 'UNKNOWN',
      };
    });
}

function formatEndpoint(endpoint: IfcRelationshipEndpointSummary) {
  return `#${endpoint.id} ${endpoint.type}${endpoint.name ? ` '${endpoint.name}'` : ''}`;
}

function describeRelationshipFallback(entity: StepEntityLine) {
  const refs = entity.text.match(/#\d+/g) ?? [];
  const uniqueRefs = [...new Set(refs)].slice(0, 8).join(' → ');
  const suffix = refs.length > 8 ? ' …' : '';
  return uniqueRefs ? `${entity.type} ${uniqueRefs}${suffix}` : entity.type;
}

function describeGeometry(entity: StepEntityLine, step?: ParsedStepText): string {
  const profileDescription = describeProfileGeometry(entity);
  if (profileDescription) {
    return `${entity.type} ${profileDescription}`;
  }
  if (entity.type === 'IFCEXTRUDEDAREASOLID') {
    const profileId = readReferences(entity.args[0] ?? '')[0];
    const profile = profileId ? step?.entities.get(profileId) : undefined;
    const profileText = profile ? `${describeGeometry(profile, step)} (#${profile.id})` : `profile ${entity.args[0] ?? '?'}`;
    return `${entity.type} ${profileText} depth ${entity.args[3] ?? '?'}`;
  }
  if (entity.type === 'IFCSHAPEREPRESENTATION') {
    const items = readReferences(entity.args[3] ?? '')
      .map((id) => step?.entities.get(id))
      .filter((item): item is StepEntityLine => Boolean(item))
      .map((item) => `#${item.id} ${describeGeometry(item, step)}`)
      .slice(0, 3);
    const itemText = items.length ? ` items ${items.join(', ')}` : ` ${entity.args[3] ?? ''}`;
    return `${entity.type} ${entity.args[2] ?? ''}${itemText}`.trim();
  }
  const refs = entity.text.match(/#\d+/g) ?? [];
  const uniqueRefs = [...new Set(refs)].slice(0, 6).join(' → ');
  const suffix = refs.length > 6 ? ' …' : '';
  return uniqueRefs ? `${entity.type} ${uniqueRefs}${suffix}` : entity.type;
}

function describeProfileGeometry(entity: StepEntityLine) {
  if (entity.type === 'IFCRECTANGLEPROFILEDEF') {
    return `rectangle ${entity.args[3] ?? '?'} × ${entity.args[4] ?? '?'}`;
  }
  if (entity.type === 'IFCCIRCLEPROFILEDEF') {
    return `circle radius ${entity.args[3] ?? '?'}`;
  }
  if (entity.type === 'IFCBOUNDINGBOX') {
    return `box ${entity.args[3] ?? '?'} × ${entity.args[4] ?? '?'} × ${entity.args[5] ?? '?'}`;
  }
  return undefined;
}

function traceProductsForGeometry(step: ParsedStepText, geometryId: number): IfcGeometryProductSummary[] {
  const reachable = new Set<number>([geometryId]);
  const queue = [geometryId];
  for (let cursor = 0; cursor < queue.length && cursor < 200; cursor += 1) {
    const current = queue[cursor];
    for (const parent of step.incomingRefs.get(current) ?? []) {
      if (!reachable.has(parent)) {
        reachable.add(parent);
        queue.push(parent);
      }
    }
  }

  return [...reachable].map((id) => step.entities.get(id)!).filter(Boolean)
    .filter((entity) => isPlacedProduct(entity) && readReferences(entity.args[6]).some((id) => reachable.has(id)))
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
    }))
    .sort((left, right) => left.id - right.id);
}

function traceProductsForPlacementPoint(step: ParsedStepText, pointId: number): IfcPlacementProductSummary[] {
  const axisPlacementIds = new Set<number>();
  const localPlacementIds = new Set<number>();

  for (const id of step.incomingRefs.get(pointId) ?? []) {
    const entity = step.entities.get(id)!;
    if (entity.type === 'IFCAXIS2PLACEMENT3D' && readReferences(entity.args[0]).includes(pointId)) {
      axisPlacementIds.add(entity.id);
    }
  }

  for (const axisId of axisPlacementIds) {
    for (const id of step.incomingRefs.get(axisId) ?? []) {
      const entity = step.entities.get(id)!;
      if (entity.type === 'IFCLOCALPLACEMENT' && readReferences(entity.args[1]).includes(axisId)) {
        localPlacementIds.add(id);
      }
    }
  }

  const candidates = new Set([...localPlacementIds].flatMap((id) => step.incomingRefs.get(id) ?? []));
  return [...candidates].map((id) => step.entities.get(id)!)
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



function entityHeading(entity: StepEntityLine, action: string) {
  const label = entity.name ? ` '${entity.name}'` : '';
  return `--- #${entity.id} ${entity.type}${label} ${action} ---`;
}

function normalizeStepLine(line: string) {
  const parts: string[] = [];
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "'") {
      const end = stepStringEnd(line, index);
      parts.push(line.slice(index, end));
      index = end - 1;
    } else if (!/\s/.test(line[index])) parts.push(line[index]);
  }
  return parts.join("");
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
