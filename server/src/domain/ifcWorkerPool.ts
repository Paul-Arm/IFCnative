import { cpus } from "node:os";
import { Worker, type TransferListItem } from "node:worker_threads";

import type { EntityFieldDiff } from "../ifc";
import type {
  AnalyzeResult,
  EntityDiffResult,
  FragmentsResult,
  ValidateIdsResult,
  WorkerRequest,
  WorkerResponse,
  WorkerTask,
} from "./ifcWorkerProtocol";

/**
 * Kleiner Pool von Worker-Threads für CPU-lastige IFC-Arbeiten (siehe
 * ifcWorker.ts). Der Hauptthread bleibt frei für HTTP, DB und Blob-I/O.
 *
 * - Jeder Worker hat eine eigene FIFO-Warteschlange und arbeitet eine
 *   Aufgabe nach der anderen ab; neue Aufgaben gehen an den Worker mit der
 *   kürzesten Schlange.
 * - Aufgaben mit `affinity` (Feld-Diffs desselben Commit-Paars) landen immer
 *   beim selben Worker, damit dessen Parse-Cache greift.
 * - Stürzt ein Worker ab (z. B. Out-of-Memory bei einer Riesendatei),
 *   schlagen nur seine laufenden Aufgaben fehl; er wird beim nächsten
 *   Auftrag neu gestartet.
 * - Worker sind `unref()`t: Der Prozess (und die Tests) enden nicht an ihnen.
 */

interface PendingTask {
  request: WorkerRequest;
  transfer: TransferListItem[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker | null;
  queue: PendingTask[];
  active: PendingTask | null;
  /** Commit-Ids, deren Dokument der Worker laut letzter Antwort gecacht hat. */
  cachedIds: Set<string>;
}

export interface IfcWorkerPoolOptions {
  /** Anzahl Worker (Standard: IFC_WORKERS, sonst 2, max. CPUs-1). */
  size?: number;
}

let sharedPool: IfcWorkerPool | null = null;

/**
 * Prozessweiter Standard-Pool. Services, die keinen eigenen Pool bekommen
 * (Tests, Skripte), teilen sich diesen — statt je Instanz neue Worker.
 */
export function defaultIfcWorkerPool(): IfcWorkerPool {
  if (!sharedPool) {
    sharedPool = new IfcWorkerPool();
  }
  return sharedPool;
}

function defaultSize(): number {
  const fromEnv = Number(process.env.IFC_WORKERS);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) {
    return Math.floor(fromEnv);
  }
  return Math.max(1, Math.min(2, cpus().length - 1));
}

export class IfcWorkerPool {
  private readonly slots: Slot[];
  private nextId = 1;
  private closed = false;

  constructor(options: IfcWorkerPoolOptions = {}) {
    const size = Math.max(1, options.size ?? defaultSize());
    this.slots = Array.from({ length: size }, () => ({
      worker: null,
      queue: [],
      active: null,
      cachedIds: new Set<string>(),
    }));
  }

  get size(): number {
    return this.slots.length;
  }

  /** STEP parsen + GlobalId-Manifest hashen (Commit-Anlage). */
  analyze(bytes: Uint8Array): Promise<AnalyzeResult> {
    return this.run<AnalyzeResult>({ type: "analyze", bytes });
  }

  /** IFC -> ThatOpen-Fragments (3D-Vorschau). */
  async convertFragments(bytes: Uint8Array): Promise<Uint8Array> {
    const result = await this.run<FragmentsResult>({ type: "fragments", bytes });
    return result.bytes;
  }

  /** IDS-Validierung eines Commits. */
  validateIds(
    idsXml: string,
    idsFileName: string,
    bytes: Uint8Array,
  ): Promise<ValidateIdsResult> {
    return this.run<ValidateIdsResult>({
      type: "validateIds",
      idsXml,
      idsFileName,
      bytes,
    });
  }

  /**
   * Feld-Diff einer Entity zwischen zwei Commits. Die Bytes werden nur
   * geladen und mitgeschickt, wenn der zuständige Worker das Dokument nicht
   * schon im Cache hat; meldet er es dennoch als fehlend (Cache verdrängt,
   * Neustart), folgt genau ein Versuch mit Bytes.
   */
  async entityDiff(
    from: string,
    to: string,
    globalId: string,
    loadBytes: (commitId: string) => Promise<Uint8Array>,
  ): Promise<EntityFieldDiff> {
    const slotIndex = this.affinitySlot(`${from}:${to}`);
    const slot = this.slots[slotIndex];
    const attempt = async (force: Set<string>) => {
      const need = (id: string) => force.has(id) || !slot.cachedIds.has(id);
      const [fromBytes, toBytes] = await Promise.all([
        need(from) ? loadBytes(from) : undefined,
        need(to) ? loadBytes(to) : undefined,
      ]);
      return this.run<EntityDiffResult>(
        {
          type: "entityDiff",
          from: { id: from, bytes: fromBytes },
          to: { id: to, bytes: toBytes },
          globalId,
        },
        { slotIndex },
      );
    };
    let result = await attempt(new Set());
    if (result.missing) {
      result = await attempt(new Set(result.missing));
    }
    if (result.missing || !result.detail) {
      throw new Error("Feld-Diff: Dokumente konnten nicht geladen werden");
    }
    slot.cachedIds = new Set(result.cachedIds);
    return result.detail;
  }

  /** Alle Worker beenden (Tests, Shutdown). Offene Aufgaben schlagen fehl. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      this.slots.map(async (slot) => {
        const worker = slot.worker;
        slot.worker = null;
        this.failAll(slot, new Error("Worker-Pool geschlossen"));
        await worker?.terminate();
      }),
    );
  }

  // ---- intern -----------------------------------------------------------

  private affinitySlot(key: string): number {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % this.slots.length;
  }

  private run<T>(
    task: WorkerTask,
    options: { slotIndex?: number; transfer?: TransferListItem[] } = {},
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Worker-Pool geschlossen"));
    }
    const slot =
      options.slotIndex !== undefined
        ? this.slots[options.slotIndex]
        : this.slots.reduce((best, candidate) =>
            candidate.queue.length + (candidate.active ? 1 : 0) <
            best.queue.length + (best.active ? 1 : 0)
              ? candidate
              : best,
          );
    return new Promise<T>((resolve, reject) => {
      slot.queue.push({
        request: { id: this.nextId++, task },
        transfer: options.transfer ?? [],
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump(slot);
    });
  }

  private pump(slot: Slot): void {
    if (slot.active || slot.queue.length === 0) {
      return;
    }
    const next = slot.queue.shift()!;
    slot.active = next;
    try {
      const worker = this.ensureWorker(slot);
      worker.postMessage(next.request, next.transfer);
      // Ein beschäftigter Worker hält den Prozess am Leben (Skripte, Tests
      // warten auf ihr Ergebnis); ein untätiger nicht.
      worker.ref();
    } catch (error) {
      slot.active = null;
      next.reject(error instanceof Error ? error : new Error(String(error)));
      this.pump(slot);
    }
  }

  private ensureWorker(slot: Slot): Worker {
    if (slot.worker) {
      return slot.worker;
    }
    const worker = new Worker(new URL("./ifcWorker.ts", import.meta.url));
    slot.worker = worker;
    slot.cachedIds = new Set();

    worker.on("message", (response: WorkerResponse) => {
      const active = slot.active;
      if (!active || active.request.id !== response.id) {
        return;
      }
      slot.active = null;
      if (response.ok) {
        active.resolve(response.result);
      } else {
        active.reject(new Error(response.error));
      }
      this.pump(slot);
      if (!slot.active) {
        worker.unref();
      }
    });

    const onGone = (reason: string) => {
      if (slot.worker !== worker) {
        return;
      }
      slot.worker = null;
      slot.cachedIds = new Set();
      const active = slot.active;
      slot.active = null;
      active?.reject(new Error(reason));
      // Wartende Aufgaben bekommen einen frischen Worker.
      this.pump(slot);
    };
    worker.on("error", (error: unknown) => {
      onGone(
        `IFC-Worker abgestürzt: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        onGone(`IFC-Worker beendet (Code ${code})`);
      } else {
        onGone("IFC-Worker beendet");
      }
    });
    // Erst NACH den Listenern: ein message-Listener ref-t den Port wieder.
    // pump() ref-t den Worker, solange er eine Aufgabe bearbeitet.
    worker.unref();
    return worker;
  }

  private failAll(slot: Slot, error: Error): void {
    const active = slot.active;
    slot.active = null;
    active?.reject(error);
    for (const pending of slot.queue.splice(0)) {
      pending.reject(error);
    }
  }
}
