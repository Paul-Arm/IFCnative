/**
 * Prüfzentrum-Store (M5): aktivierte Quellen, letzte Ergebnisse und
 * Lauf-Status — je Dokument.
 *
 * REGISTRY-MUSTER (verbindlich für alle Prüfquellen)
 * -------------------------------------------------
 * Diese Datei kennt KEINE einzelne Quelle. Jede Quelle liegt in einem
 * eigenen Modul und trägt sich beim Laden selbst ein:
 *
 *   // src/domain/checks/sources/diagnostics.ts
 *   import { registerCheckSource } from "../store";
 *   registerCheckSource("diagnostics", (session) => run(session));
 *
 * Der Runner hat überall dieselbe Signatur `run(session): Promise<CheckRunResult>`.
 * Damit kann das Prüfzentrum parallel entwickelt werden: `store.ts` importiert
 * nichts aus `sources/**` und `idsSource.ts` nichts aus `sources/**` — es gibt
 * keine Importkante zwischen den Quellen. Wirksam wird eine Quelle, sobald ihr
 * Modul irgendwo importiert wird (die Pane importiert die Module, die sie
 * anbietet); nicht eingetragene Quellen erscheinen in der UI gar nicht erst
 * (`registeredCheckSources()`), statt als Fehler aufzuschlagen.
 *
 * `runChecks` führt die registrierten UND aktivierten Quellen nacheinander aus
 * (nicht parallel: alle lesen dieselbe Sitzung und die UI soll den Fortschritt
 * quellenweise zeigen). Eine geworfene Quelle beendet den Lauf nicht, sondern
 * wird zu einem eigenen Befund `kind: "source-error"`.
 */
import { create } from "zustand";

import { useCommands } from "../../commands/pipeline";
import type { ModelSession } from "../../core/session";
import {
  SOURCE_LABELS,
  type CheckFinding,
  type CheckRunResult,
  type CheckSeverity,
  type CheckSourceId,
} from "./types";

/** Einheitliche Signatur aller Prüfquellen. */
export type CheckSourceRunner = (session: ModelSession) => Promise<CheckRunResult>;

/** Anzeige-/Ausführungsreihenfolge der Quellen. */
export const SOURCE_ORDER = Object.keys(SOURCE_LABELS) as CheckSourceId[];

const REGISTRY = new Map<CheckSourceId, CheckSourceRunner>();

/** Eintrag in die Quellen-Registry (siehe Dateikopf). */
export function registerCheckSource(
  id: CheckSourceId,
  runner: CheckSourceRunner,
): void {
  REGISTRY.set(id, runner);
}

/** Alle eingetragenen Quellen in fester Reihenfolge. */
export function registeredCheckSources(): CheckSourceId[] {
  return SOURCE_ORDER.filter((id) => REGISTRY.has(id));
}

export type CheckSourceStatus = "idle" | "running" | "done" | "error";

export interface DocChecks {
  /** Vom Benutzer angehakte Quellen (Standard: alle an). */
  enabled: Readonly<Record<CheckSourceId, boolean>>;
  results: Readonly<Partial<Record<CheckSourceId, CheckRunResult>>>;
  status: Readonly<Record<CheckSourceId, CheckSourceStatus>>;
  /** Dokument-Revision zum Zeitpunkt des Laufs; null = noch nie geprüft. */
  ranAtRevision: number | null;
  running: boolean;
}

const ALL_ENABLED = Object.fromEntries(
  SOURCE_ORDER.map((id) => [id, true]),
) as Record<CheckSourceId, boolean>;

const ALL_IDLE = Object.fromEntries(
  SOURCE_ORDER.map((id) => [id, "idle"]),
) as Record<CheckSourceId, CheckSourceStatus>;

/** Konstante Referenz — sonst erzeugt der Selektor bei jedem Render neu. */
export const EMPTY_DOC_CHECKS: DocChecks = {
  enabled: ALL_ENABLED,
  results: {},
  status: ALL_IDLE,
  ranAtRevision: null,
  running: false,
};

interface ChecksState {
  byDocument: Record<string, DocChecks>;
  setSourceEnabled(docId: string, source: CheckSourceId, enabled: boolean): void;
  runChecks(docId: string, session: ModelSession): Promise<void>;
  clearResults(docId: string): void;
}

/** Revision aus derselben Quelle, aus der `useDocRevision` liest. */
function currentRevision(docId: string): number {
  return useCommands.getState().byDocument[docId]?.audit.length ?? 0;
}

function sourceErrorResult(
  source: CheckSourceId,
  error: unknown,
  durationMs: number,
): CheckRunResult {
  const finding: CheckFinding = {
    id: `${source}:source-error:0:0`,
    source,
    kind: "source-error",
    severity: "error",
    message: `Prüfquelle „${SOURCE_LABELS[source]}" ist fehlgeschlagen`,
    entityIds: [],
    detail: error instanceof Error ? error.message : String(error),
  };
  return { source, findings: [finding], durationMs, checkedCount: 0 };
}

export const useChecks = create<ChecksState>((set, get) => ({
  byDocument: {},

  setSourceEnabled(docId, source, enabled) {
    set((state) => {
      const doc = state.byDocument[docId] ?? EMPTY_DOC_CHECKS;
      return {
        byDocument: {
          ...state.byDocument,
          [docId]: { ...doc, enabled: { ...doc.enabled, [source]: enabled } },
        },
      };
    });
  },

  async runChecks(docId, session) {
    const before = get().byDocument[docId] ?? EMPTY_DOC_CHECKS;
    if (before.running) return;
    const sources = registeredCheckSources().filter((id) => before.enabled[id]);
    const revision = currentRevision(docId);

    // Startzustand: alte Ergebnisse fallen weg, damit die Zähler nie einen
    // Mischstand aus zwei Läufen zeigen.
    const patch = (update: (doc: DocChecks) => DocChecks): void => {
      set((state) => ({
        byDocument: {
          ...state.byDocument,
          [docId]: update(state.byDocument[docId] ?? EMPTY_DOC_CHECKS),
        },
      }));
    };
    patch((doc) => ({
      ...doc,
      running: true,
      results: {},
      status: {
        ...ALL_IDLE,
        ...Object.fromEntries(sources.map((id) => [id, "running" as const])),
      },
    }));

    for (const source of sources) {
      const runner = REGISTRY.get(source);
      if (!runner) continue;
      const started =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      let result: CheckRunResult;
      let status: CheckSourceStatus = "done";
      try {
        result = await runner(session);
      } catch (error) {
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        result = sourceErrorResult(source, error, now - started);
        status = "error";
      }
      patch((doc) => ({
        ...doc,
        results: { ...doc.results, [source]: result },
        status: { ...doc.status, [source]: status },
      }));
    }

    patch((doc) => ({ ...doc, running: false, ranAtRevision: revision }));
  },

  clearResults(docId) {
    set((state) => {
      const doc = state.byDocument[docId];
      if (!doc) return {};
      return {
        byDocument: {
          ...state.byDocument,
          [docId]: {
            ...doc,
            results: {},
            status: ALL_IDLE,
            ranAtRevision: null,
            running: false,
          },
        },
      };
    });
  },
}));

/** Prüfzustand eines Dokuments (stabile Leerreferenz statt undefined). */
export function useDocChecks(docId: string | null): DocChecks {
  return useChecks((s) =>
    docId ? (s.byDocument[docId] ?? EMPTY_DOC_CHECKS) : EMPTY_DOC_CHECKS,
  );
}

/** Alle Befunde des letzten Laufs, in Quellenreihenfolge. */
export function allFindings(doc: DocChecks): CheckFinding[] {
  return SOURCE_ORDER.flatMap((id) => doc.results[id]?.findings ?? []);
}

/** Anzahl geprüfter Objekte über alle Quellen des letzten Laufs. */
export function checkedCount(doc: DocChecks): number {
  return SOURCE_ORDER.reduce(
    (sum, id) => sum + (doc.results[id]?.checkedCount ?? 0),
    0,
  );
}

/** Zähler je Schweregrad. */
export function severityCounts(
  findings: readonly CheckFinding[],
): Record<CheckSeverity, number> {
  const counts: Record<CheckSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
