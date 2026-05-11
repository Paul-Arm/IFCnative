export type IfcDiffLineKind = 'context' | 'add' | 'remove';

export interface IfcDiffLine {
  kind: IfcDiffLineKind;
  text: string;
}

interface StepEntityLine {
  id: number;
  type: string;
  text: string;
  name?: string;
}

interface ParsedStepText {
  entities: Map<number, StepEntityLine>;
  order: number[];
  nonEntityLines: string[];
}

const MAX_ENTITY_DIFF_LINES = 800;

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
