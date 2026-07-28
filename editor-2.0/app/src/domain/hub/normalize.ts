/**
 * Defensive Umwandlung der Hub-Antworten in die Typen aus `types.ts`.
 *
 * Der Hub entsteht parallel: Feldnamen können in Details abweichen und
 * optionale Angaben fehlen. Statt die JSON-Antwort blind zu casten (ein
 * `undefined` landet sonst als „undefined" in der UI oder lässt eine Liste
 * beim Rendern auflaufen) werden hier Aliase akzeptiert, Zahlen geprüft und
 * fehlende Pflichtfelder als klarer Formatfehler gemeldet.
 */
import { HubError } from "./error";
import type {
  HubDiff,
  HubDiffElement,
  HubHealth,
  HubModel,
  HubProject,
  HubVersion,
} from "./types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Erster Schlüssel mit einem nicht-leeren String- oder Zahlenwert. */
function text(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/** Erster Schlüssel mit einer endlichen Zahl (auch als Zahlen-String). */
function count(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function formatError(what: string): HubError {
  return new HubError(
    `Unerwartete Antwort des Hubs: ${what}.`,
    "format",
  );
}

/**
 * Listen-Antwort auspacken — akzeptiert das nackte Array ebenso wie die
 * üblichen Umhüllungen (`{items:[…]}`, `{projects:[…]}` …).
 */
function toArray(value: unknown, what: string): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  if (source) {
    for (const key of ["items", "projects", "models", "versions", "data"]) {
      const inner = source[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  throw formatError(`${what} ist keine Liste`);
}

export function toHealth(value: unknown): HubHealth {
  const source = record(value);
  if (!source) throw formatError("Health-Antwort ist kein Objekt");
  return {
    ok: source["ok"] !== false,
    version: text(source, "version") || "unbekannt",
  };
}

export function toProject(value: unknown): HubProject {
  const source = record(value);
  const id = source ? text(source, "id", "projectId", "pid") : "";
  if (!source || !id) throw formatError("Projekt ohne Id");
  return { id, name: text(source, "name", "title") || id };
}

export function toModel(value: unknown): HubModel {
  const source = record(value);
  const id = source ? text(source, "id", "modelId", "mid") : "";
  if (!source || !id) throw formatError("Modell ohne Id");
  return { id, name: text(source, "name", "title") || id };
}

export function toVersion(value: unknown): HubVersion {
  const source = record(value);
  const id = source ? text(source, "id", "versionId", "vid") : "";
  if (!source || !id) throw formatError("Stand ohne Id");
  return {
    id,
    message: text(source, "message", "comment"),
    author: text(source, "author", "user"),
    createdAt: text(source, "createdAt", "created_at", "created"),
    schema: text(source, "schema", "schemaVersion"),
    entityCount: count(source, "entityCount", "entities"),
    byteSize: count(source, "byteSize", "size", "bytes"),
    blobHash: text(source, "blobHash", "hash"),
  };
}

export function toProjects(value: unknown): HubProject[] {
  return toArray(value, "Projektliste").map(toProject);
}

export function toModels(value: unknown): HubModel[] {
  return toArray(value, "Modellliste").map(toModel);
}

export function toVersions(value: unknown): HubVersion[] {
  return toArray(value, "Versionsliste").map(toVersion);
}

/** Diff-Elemente ohne GlobalId sind für die Auswahl wertlos und fallen heraus. */
function toDiffElements(value: unknown): HubDiffElement[] {
  if (value === undefined || value === null) return [];
  const elements: HubDiffElement[] = [];
  for (const entry of toArray(value, "Vergleichsliste")) {
    const source = record(entry);
    if (!source) continue;
    const globalId = text(source, "globalId", "GlobalId", "guid");
    if (!globalId) continue;
    const element: HubDiffElement = { globalId };
    const expressId = source["expressId"] ?? source["expressID"];
    if (typeof expressId === "number" && Number.isFinite(expressId)) {
      element.expressId = expressId;
    }
    const label = text(source, "label", "name", "type");
    if (label) element.label = label;
    elements.push(element);
  }
  return elements;
}

export function toDiff(value: unknown): HubDiff {
  const source = record(value);
  if (!source) throw formatError("Vergleichsantwort ist kein Objekt");
  const added = toDiffElements(source["added"]);
  const removed = toDiffElements(source["removed"]);
  const modified = toDiffElements(source["modified"]);
  const summary = record(source["summary"]);
  return {
    added,
    removed,
    modified,
    summary: summary
      ? {
          added: count(summary, "added"),
          removed: count(summary, "removed"),
          modified: count(summary, "modified"),
        }
      : {
          added: added.length,
          removed: removed.length,
          modified: modified.length,
        },
  };
}
