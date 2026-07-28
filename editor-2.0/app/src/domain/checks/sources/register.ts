/**
 * Anmeldung der Prüfquellen beim Prüfzentrum (M6).
 *
 * Der Registry-Punkt `registerCheckSource(id, runner)` in `../store.ts` ist
 * parallel entstanden; diese Datei bleibt deshalb bewusst defensiv:
 *
 *  - der Import von `../store` läuft dynamisch und in `try/catch`. Fehlt das
 *    Modul oder exportiert es (noch) keinen Registry-Punkt, meldet
 *    `registerCheckSources()` schlicht `false`, statt zu werfen — das
 *    Prüfzentrum zeigt dann nur die Quellen, die sich eintragen konnten,
 *  - die Runner-Signatur wird lokal beschrieben (`CheckRunner`), damit hier
 *    keine harte Typkante zu `../store.ts` entsteht.
 *
 * Die Prüfquellen selbst hängen NICHT an dieser Datei: jede exportiert ein
 * `run(session)` und wird von den Tests direkt aufgerufen.
 */
import type { ModelSession } from "../../../core/session";
import type { CheckRunResult, CheckSourceId } from "../types";
import { run as runClash } from "./clash";
import { run as runDiagnostics } from "./diagnostics";
import { run as runObjectInfo } from "./objectInfo";

export type CheckRunner = (session: ModelSession) => Promise<CheckRunResult>;

/** Alle in diesem Verzeichnis implementierten Quellen (IDS liegt daneben). */
export const CHECK_SOURCES: ReadonlyArray<
  readonly [CheckSourceId, CheckRunner]
> = [
  ["diagnostics", runDiagnostics],
  ["object-info", runObjectInfo],
  ["clash", (session) => runClash(session)],
];

interface CheckStoreModule {
  registerCheckSource?: (id: CheckSourceId, runner: CheckRunner) => void;
}

/**
 * Quellen beim Prüfzentrum anmelden. Gibt `true` zurück, wenn die Registry
 * erreichbar war, sonst `false` (kein Fehler — der Aufrufer kann es später
 * erneut versuchen).
 */
export async function registerCheckSources(): Promise<boolean> {
  try {
    const module = (await import("../store")) as unknown as CheckStoreModule;
    const register = module?.registerCheckSource;
    if (typeof register !== "function") return false;
    for (const [id, runner] of CHECK_SOURCES) register(id, runner);
    return true;
  } catch {
    return false;
  }
}
