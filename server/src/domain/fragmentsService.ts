import type { Commit } from "../repository/types";
import type { ObjectStore } from "../storage/objectStore";
import { IfcWorkerPool, defaultIfcWorkerPool } from "./ifcWorkerPool";

/**
 * IFC -> Fragments (ThatOpen) für die 3D-Vorschau der Web-UI.
 *
 * Die Konvertierung (web-ifc-WASM-Parsing + Geometrieaufbau) ist der teure
 * Schritt — sie läuft im IfcWorkerPool und das Ergebnis wird im Object Store
 * neben der IFC abgelegt (gleicher Key mit .frag statt .ifc). Commits sind
 * unveränderlich, der Cache veraltet also nie: konvertiert wird höchstens
 * einmal pro Commit, gleichzeitige Erst-Anfragen teilen sich denselben
 * Konvertierungslauf.
 *
 * Die HTTP-Schicht muss auf eine laufende Konvertierung nicht warten:
 * `start()` stößt sie an und liefert sofort den Zustand, die UI fragt per
 * Polling nach (202 Accepted), bis die Datei im Store liegt.
 */

export type FragmentsState =
  | { state: "idle" }
  | { state: "ready" }
  | { state: "converting"; startedAt: string; elapsedMs: number }
  | { state: "error"; message: string };

interface Job {
  promise: Promise<Buffer>;
  startedAt: number;
}

interface FailedJob {
  message: string;
  at: number;
}

/** So lange bleibt ein Fehler sichtbar, bevor ein neuer Versuch startet. */
const ERROR_TTL_MS = 60_000;

export class FragmentsService {
  private readonly workers: IfcWorkerPool;

  constructor(
    private readonly store: ObjectStore,
    workers?: IfcWorkerPool,
  ) {
    this.workers = workers ?? defaultIfcWorkerPool();
  }

  private readonly inflight = new Map<string, Job>();
  private readonly failed = new Map<string, FailedJob>();

  /**
   * Format-Generation des Caches: v2 = mit allen Attributen/Relationen
   * (Psets für die Info-Anzeige im Viewer). Bei Format-Änderungen hochzählen
   * — alte Einträge werden einfach neu konvertiert.
   */
  static fragKey(blobKey: string): string {
    return `${blobKey.replace(/\.ifc$/i, "")}.v2.frag`;
  }

  /** Alle Cache-Generationen zu einem Blob (fürs Aufräumen beim Löschen). */
  static allFragKeys(blobKey: string): string[] {
    const base = blobKey.replace(/\.ifc$/i, "");
    return [`${base}.frag`, `${base}.v2.frag`];
  }

  /** Wartet auf die Fragments (konvertiert bei Bedarf). */
  async getFragments(commit: Commit): Promise<Buffer> {
    const key = FragmentsService.fragKey(commit.blobKey);
    if (await this.store.exists(key)) {
      return this.store.get(key);
    }
    return this.startJob(commit, key).promise;
  }

  /** Aktueller Zustand ohne Nebenwirkung (kein Konvertierungsstart). */
  async status(commit: Commit): Promise<FragmentsState> {
    const key = FragmentsService.fragKey(commit.blobKey);
    if (await this.store.exists(key)) {
      return { state: "ready" };
    }
    return this.jobState(key);
  }

  /**
   * Stößt die Konvertierung an (falls nicht schon unterwegs oder gerade
   * fehlgeschlagen) und liefert sofort den Zustand.
   */
  async start(commit: Commit): Promise<FragmentsState> {
    const key = FragmentsService.fragKey(commit.blobKey);
    if (await this.store.exists(key)) {
      return { state: "ready" };
    }
    const current = this.jobState(key);
    if (current.state === "error") {
      return current;
    }
    this.startJob(commit, key);
    return this.jobState(key);
  }

  private jobState(key: string): FragmentsState {
    const job = this.inflight.get(key);
    if (job) {
      return {
        state: "converting",
        startedAt: new Date(job.startedAt).toISOString(),
        elapsedMs: Date.now() - job.startedAt,
      };
    }
    const failure = this.failed.get(key);
    if (failure && Date.now() - failure.at < ERROR_TTL_MS) {
      return { state: "error", message: failure.message };
    }
    this.failed.delete(key);
    return { state: "idle" };
  }

  private startJob(commit: Commit, key: string): Job {
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    this.failed.delete(key);
    const job: Job = {
      startedAt: Date.now(),
      promise: this.convert(commit, key)
        .catch((error: unknown) => {
          this.failed.set(key, {
            message: error instanceof Error ? error.message : String(error),
            at: Date.now(),
          });
          throw error;
        })
        .finally(() => {
          this.inflight.delete(key);
        }),
    };
    // Fehler werden über `failed` gemeldet; ein Aufrufer ohne await darf
    // keine unhandled rejection auslösen.
    job.promise.catch(() => undefined);
    this.inflight.set(key, job);
    return job;
  }

  private async convert(commit: Commit, key: string): Promise<Buffer> {
    const ifc = await this.store.get(commit.blobKey);
    const bytes = await this.workers.convertFragments(new Uint8Array(ifc));
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    await this.store.put(key, buffer, "application/octet-stream");
    return buffer;
  }
}
