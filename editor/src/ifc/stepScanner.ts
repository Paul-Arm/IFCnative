/** Shared lexical rules for STEP strings, comments, arguments and references. */
export function stepStringEnd(text: string, start: number): number {
  let cursor = start + 1;
  for (;;) {
    const end = text.indexOf("'", cursor);
    if (end < 0) throw new Error(`Nicht abgeschlossener STEP-String bei Zeichen ${start}.`);
    if (text[end + 1] !== "'") return end + 1;
    cursor = end + 2;
  }
}

export function stripStepComments(text: string): string {
  const parts: string[] = [];
  let copied = 0;
  // Jump over numeric geometry payloads instead of visiting every character.
  const tokens = /'|\/\*/g;
  for (let match; (match = tokens.exec(text));) {
    const i = match.index;
    if (match[0] === "'") {
      tokens.lastIndex = stepStringEnd(text, i);
    } else {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error(`Nicht abgeschlossener STEP-Kommentar bei Zeichen ${i}.`);
      parts.push(text.slice(copied, i), " ");
      copied = end + 2;
      tokens.lastIndex = copied;
    }
  }
  if (!parts.length) return text;
  parts.push(text.slice(copied));
  return parts.join("");
}

export function splitStepArguments(input: string): string[] {
  return scanArguments(stripStepComments(input), 0).args;
}

/** The entity scanner also splits arguments, so large coordinate lists are read once. */
function scanArguments(text: string, start: number, entityId?: number) {
  const parts: string[] = [];
  const baseDepth = entityId === undefined ? 0 : 1;
  let depth = baseDepth;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "'") i = stepStringEnd(text, i) - 1;
    else if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      if (--depth < baseDepth) {
        if (entityId === undefined) throw new Error("Unerwartete schließende STEP-Klammer.");
        const last = text.slice(start, i).trim();
        if (last) parts.push(last);
        return { args: parts, end: i + 1 };
      }
    } else if (text[i] === "," && depth === baseDepth) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (text[i] === ";" && entityId !== undefined) {
      throw new Error(`Nicht abgeschlossene STEP-Entity #${entityId}.`);
    }
  }
  if (entityId !== undefined) throw new Error(`Nicht abgeschlossene STEP-Entity #${entityId}.`);
  if (depth !== 0) throw new Error("Nicht abgeschlossene STEP-Klammer.");
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return { args: parts, end: text.length };
}

export function readStepReferences(input = ""): number[] {
  const text = stripStepComments(input);
  const refs: number[] = [];
  const tokens = /'|#(\d+)/g;
  for (let match; (match = tokens.exec(text));) {
    if (match[0] === "'") tokens.lastIndex = stepStringEnd(text, match.index);
    else refs.push(Number(match[1]));
  }
  return refs;
}

export interface StepEntityRecord { id: number; type: string; args: string[]; start: number; end: number }

export function scanStepEntities(input: string) {
  const text = stripStepComments(input);
  const entities: StepEntityRecord[] = [];
  const ids = new Set<number>();
  for (let position = 0; position < text.length; position++) {
    if (text[position] === "'") {
      position = stepStringEnd(text, position) - 1;
      continue;
    }
    if (text[position] !== "#") continue;
    const head = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/i.exec(text.slice(position));
    if (!head) throw new Error(`Ungültige STEP-Entity bei Zeichen ${position}. Import abgebrochen.`);
    const id = Number(head[1]);
    if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error(`Ungültige oder doppelte STEP-ID #${head[1]}.`);
    const { args, end } = scanArguments(text, position + head[0].length, id);
    let cursor = end;
    while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
    if (text[cursor] !== ";") throw new Error(`Fehlendes Semikolon nach STEP-Entity #${id}.`);
    const type = head[2].toUpperCase();
    entities.push({ args, id, type, start: position, end: cursor + 1 });
    ids.add(id);
    position = cursor;
  }
  return { text, entities };
}
